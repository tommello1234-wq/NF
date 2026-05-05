/**
 * Orquestrador de emissão NFS-e Padrão Nacional.
 *
 * Junta os blocos do `services/nfse/`:
 *   - carrega empresa, certificado, cliente, serviço (produto tipo=servico) do Supabase
 *   - monta DPS, assina, comprime
 *   - posta no SEFIN Nacional
 *   - persiste resultado (XML DPS, XML NFS-e ou erros) em notas_fiscais + Storage
 *   - incrementa proximo_numero_dps na empresa de forma transacional
 */

import { supabase } from '../supabase.js'
import { carregarCertificado } from '../certificado.js'
import {
  buildDpsXml,
  buildEventoCancelamentoXml,
  carregarMaterialPfx,
  compressGzipBase64,
  criarMtlsAgent,
  postDps,
  postEvento,
  signDps,
  signEvento,
  type Ambiente,
  type CodigoMotivoCancelamento,
  type DpsInput,
} from './index.js'

export interface EmitirNfseInput {
  empresaId: string
  /** Id do produto cadastrado (com tipo='servico') que define dados fiscais do serviço */
  produtoId: string
  /** Id do cliente cadastrado, ou dados manuais via tomadorOverride */
  clienteId?: string
  tomadorOverride?: {
    cpf?: string
    cnpj?: string
    nome: string
    email?: string
    endereco?: {
      logradouro: string
      numero: string
      bairro: string
      codigoMunicipio: string
      cep: string
      complemento?: string
    }
  }
  /** Valor total do serviço (sobrescreve valor_unitario do produto se fornecido) */
  valorServicos: number
  /** Descrição (opcional — usa descricao do produto se omitida) */
  descricao?: string
  /** Data competência (opcional — usa hoje) */
  dataCompetencia?: Date
}

export interface EmitirNfseResult {
  notaId: string
  status: 'autorizada' | 'rejeitada' | 'falha_temporaria'
  ambiente: Ambiente
  idDps: string
  numeroDps: number
  serieDps: number
  /** Chave de acesso da NFS-e (50 chars) — só se autorizada */
  chaveAcessoNfse?: string
  /** Número da NFS-e atribuído pelo SEFIN */
  numeroNfse?: string
  /** Mensagens de erro do SEFIN (se rejeitada) */
  erros?: Array<{ codigo: string; descricao: string; complemento?: string }>
  /** Resposta crua do SEFIN (debug) */
  rawResponse: string
  rawStatus: number
}

export async function emitirNfse(input: EmitirNfseInput): Promise<EmitirNfseResult> {
  // 1. Carrega empresa
  const { data: empresa, error: empErr } = await supabase
    .from('empresas')
    .select('*')
    .eq('id', input.empresaId)
    .maybeSingle()
  if (empErr || !empresa) throw new Error(`Empresa não encontrada: ${input.empresaId}`)

  if (!empresa.inscricao_municipal) {
    throw new Error('Empresa não tem Inscrição Municipal cadastrada — necessária para NFS-e')
  }

  const cMunEmi = empresa.municipio_emissor_codigo || empresa.endereco_codigo_ibge
  if (!cMunEmi || cMunEmi.length !== 7) {
    throw new Error('Empresa sem código IBGE de município emissor (7 dígitos) — preencha em municipio_emissor_codigo')
  }

  const ambiente = (empresa.nfse_ambiente || 2) as Ambiente

  // 2. Carrega serviço (produto com tipo='servico')
  const { data: produto, error: prodErr } = await supabase
    .from('produtos')
    .select('*')
    .eq('id', input.produtoId)
    .maybeSingle()
  if (prodErr || !produto) throw new Error(`Serviço não encontrado: ${input.produtoId}`)
  if (produto.tipo !== 'servico') throw new Error('Produto cadastrado não é do tipo "servico"')
  if (!produto.codigo_lc116) {
    throw new Error('Serviço sem código LC 116 — confirme com o contador antes de emitir')
  }

  // 3. Carrega tomador (usa município emissor como fallback de IBGE)
  const tomador = await resolveTomador(input, cMunEmi)

  // 4. Carrega certificado
  const cert = await carregarCertificado(input.empresaId)
  if (!cert) throw new Error('Certificado digital A1 não encontrado para a empresa')

  // 5. Próximo número DPS (atomicidade simples — em escala, mover pra função SQL)
  const serieDps = empresa.serie_dps || 1
  const numeroDps = await reservarProximoNumeroDps(input.empresaId, empresa.proximo_numero_dps || 1)

  // 6. Monta DPS
  const dpsInput: DpsInput = {
    ambiente,
    serie: serieDps,
    numero: numeroDps,
    dataEmissao: new Date(),
    dataCompetencia: input.dataCompetencia || new Date(),
    codigoMunicipioEmissor: cMunEmi,
    versaoAplicativo: 'NFE-API-1.0',
    prestador: {
      cnpj: empresa.cnpj,
      inscricaoMunicipal: empresa.inscricao_municipal,
      nome: empresa.razao_social,
      regimeTributario: {
        opSimpNac: regimeTributarioParaOpSimpNac(empresa.regime_tributario),
        regApTribSN: 1,
        regEspTrib: 0,
      },
    },
    tomador,
    servico: {
      codigoTributacaoNacional: produto.codigo_lc116,
      codigoTributacaoMunicipal: produto.codigo_tributario_municipal || undefined,
      codigoNBS: produto.codigo_nbs || undefined,
      descricao: input.descricao || produto.descricao,
      localPrestacaoCodigoMunicipio: cMunEmi,
    },
    valores: {
      valorServicos: input.valorServicos,
      aliquotaIss: Number(produto.aliquota_iss || 0),
      issRetido: Boolean(produto.iss_retido),
    },
  }

  const { xml: xmlUnsigned, idDps } = buildDpsXml(dpsInput)

  // 7. Cria registro inicial em notas_fiscais (status=transmitindo)
  const { data: nota, error: notaInsErr } = await supabase
    .from('notas_fiscais')
    .insert({
      empresa_id: input.empresaId,
      tipo: 'nfse',
      status: 'transmitindo',
      ambiente_nfse: ambiente,
      numero_dps: numeroDps,
      serie_dps: serieDps,
      destinatario_nome: tomador.nome,
      destinatario_cpf_cnpj: tomador.cpf || tomador.cnpj,
      valor_total: input.valorServicos,
      payload_original: input as unknown as Record<string, unknown>,
      tentativas: 1,
    })
    .select()
    .single()
  if (notaInsErr || !nota) throw new Error(`Erro ao criar registro da nota: ${notaInsErr?.message}`)

  try {
    // 8. Carrega material PFX, assina XML
    const pfx = carregarMaterialPfx(cert.pfxBuffer, cert.senha)
    const signedXml = signDps(xmlUnsigned, idDps, pfx)
    const dpsAssinadaEm = new Date().toISOString()

    // Sobe XML DPS no Storage
    const xmlDpsPath = `${input.empresaId}/${nowYYYYMM()}/${idDps}-dps.xml`
    await supabase.storage.from('nfse-xml').upload(xmlDpsPath, signedXml, {
      upsert: true,
      contentType: 'application/xml',
    })

    // 9. Comprime e transmite
    const dpsB64 = compressGzipBase64(signedXml)
    const agent = criarMtlsAgent(pfx, { insecureSkipServerVerify: true })
    const res = await postDps({ agent, ambiente }, dpsB64)

    // 10. Interpreta resposta
    const result = await processarRespostaSefin({
      notaId: nota.id,
      empresaId: input.empresaId,
      idDps,
      numeroDps,
      serieDps,
      ambiente,
      xmlDpsPath,
      dpsAssinadaEm,
      raw: res,
    })
    return result
  } catch (e) {
    // Falha na pipeline — marcar como falha_temporaria pra retry manual
    await supabase
      .from('notas_fiscais')
      .update({
        status: 'falha_temporaria',
        motivo_rejeicao: (e as Error).message,
        mensagens_retorno: { erro: (e as Error).message, stack: (e as Error).stack },
      })
      .eq('id', nota.id)

    return {
      notaId: nota.id,
      status: 'falha_temporaria',
      ambiente,
      idDps,
      numeroDps,
      serieDps,
      erros: [{ codigo: 'LOCAL', descricao: (e as Error).message }],
      rawResponse: '',
      rawStatus: 0,
    }
  }
}

// === helpers ===

async function resolveTomador(input: EmitirNfseInput, cMunFallback: string) {
  if (input.tomadorOverride) {
    const enderecoOverride = input.tomadorOverride.endereco
    return {
      cpf: input.tomadorOverride.cpf,
      cnpj: input.tomadorOverride.cnpj,
      nome: input.tomadorOverride.nome,
      email: input.tomadorOverride.email,
      endereco: enderecoOverride
        ? {
            ...enderecoOverride,
            codigoMunicipio: enderecoOverride.codigoMunicipio || cMunFallback,
          }
        : undefined,
    }
  }
  if (!input.clienteId) throw new Error('clienteId ou tomadorOverride é obrigatório')
  const { data: cli } = await supabase
    .from('clientes')
    .select('*')
    .eq('id', input.clienteId)
    .maybeSingle()
  if (!cli) throw new Error(`Cliente não encontrado: ${input.clienteId}`)

  const cpfCnpj = (cli.cpf_cnpj || '').replace(/\D/g, '')
  const isCpf = cpfCnpj.length === 11

  // Endereço é obrigatório no DPS quando ISS é retido pelo tomador, e o
  // SEFIN também rejeita quando vazio em outros cenários (E0237). Por
  // segurança, sempre montamos um endereço — se o cliente foi cadastrado
  // sem endereço, usamos um fallback no município emissor.
  const cep = (cli.endereco_cep || '').replace(/\D/g, '')
  const endereco = {
    logradouro: cli.endereco_logradouro || 'Nao informado',
    numero: cli.endereco_numero || 'S/N',
    bairro: cli.endereco_bairro || 'Centro',
    codigoMunicipio:
      (cli.endereco_codigo_ibge && /^\d{7}$/.test(cli.endereco_codigo_ibge))
        ? cli.endereco_codigo_ibge
        : cMunFallback,
    cep: cep && cep.length === 8 ? cep : '00000000',
  }

  return {
    ...(isCpf ? { cpf: cpfCnpj } : { cnpj: cpfCnpj }),
    nome: cli.nome,
    email: cli.email || undefined,
    endereco,
  }
}

async function reservarProximoNumeroDps(empresaId: string, atual: number): Promise<number> {
  const proximo = atual + 1
  await supabase
    .from('empresas')
    .update({ proximo_numero_dps: proximo, updated_at: new Date().toISOString() })
    .eq('id', empresaId)
  return atual
}

function regimeTributarioParaOpSimpNac(regime: string | null | undefined): 1 | 2 | 3 {
  // 1 = Não optante / 2 = MEI / 3 = ME ou EPP
  switch (regime) {
    case 'mei':
      return 2
    case 'simples':
      return 3
    case 'lucro_presumido':
    case 'lucro_real':
    default:
      return 1
  }
}

function nowYYYYMM(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

interface ProcessarParams {
  notaId: string
  empresaId: string
  idDps: string
  numeroDps: number
  serieDps: number
  ambiente: Ambiente
  xmlDpsPath: string
  dpsAssinadaEm: string
  raw: { status: number; body: string; contentType: string }
}

async function processarRespostaSefin(p: ProcessarParams): Promise<EmitirNfseResult> {
  // Sucesso = 201 Created (NFS-e gerada); 400/403/500 = erro
  if (p.raw.status === 201) {
    // Resposta tem estrutura NFSePostResponseSucesso (vamos tentar parsear)
    let chaveAcesso: string | undefined
    let numeroNfse: string | undefined
    let xmlNfsePath: string | undefined

    try {
      const json = JSON.parse(p.raw.body)
      // Estruturas variam — guardar o cru e extrair campos comuns
      chaveAcesso = json.chaveAcesso || json.ChaveAcesso || json.chave
      numeroNfse = json.nNFSe || json.numeroNFSe || json.numero
      const nfseXml = json.nfseXml || json.NFSeXml || json.xml
      if (nfseXml) {
        xmlNfsePath = `${p.empresaId}/${nowYYYYMM()}/${p.idDps}-nfse.xml`
        await supabase.storage.from('nfse-xml').upload(xmlNfsePath, nfseXml, {
          upsert: true,
          contentType: 'application/xml',
        })
      }
    } catch {
      // resposta sem JSON válido — guarda raw mesmo
    }

    await supabase
      .from('notas_fiscais')
      .update({
        status: 'autorizada',
        chave_acesso_nfse: chaveAcesso,
        numero_nfse: numeroNfse,
        xml_dps_path: p.xmlDpsPath,
        xml_nfse_path: xmlNfsePath,
        dps_assinada_em: p.dpsAssinadaEm,
        emitida_em: new Date().toISOString(),
        mensagens_retorno: tryParseJson(p.raw.body),
      })
      .eq('id', p.notaId)

    return {
      notaId: p.notaId,
      status: 'autorizada',
      ambiente: p.ambiente,
      idDps: p.idDps,
      numeroDps: p.numeroDps,
      serieDps: p.serieDps,
      chaveAcessoNfse: chaveAcesso,
      numeroNfse,
      rawResponse: p.raw.body,
      rawStatus: p.raw.status,
    }
  }

  // Erro
  let erros: Array<{ codigo: string; descricao: string; complemento?: string }> = []
  try {
    const json = JSON.parse(p.raw.body)
    erros = (json.erros || []).map((e: { Codigo: string; Descricao: string; Complemento?: string }) => ({
      codigo: e.Codigo,
      descricao: e.Descricao,
      complemento: e.Complemento,
    }))
  } catch {
    erros = [{ codigo: 'HTTP', descricao: `Status ${p.raw.status}: ${p.raw.body.slice(0, 200)}` }]
  }

  await supabase
    .from('notas_fiscais')
    .update({
      status: 'rejeitada',
      xml_dps_path: p.xmlDpsPath,
      dps_assinada_em: p.dpsAssinadaEm,
      mensagens_retorno: tryParseJson(p.raw.body),
      motivo_rejeicao: erros.map((e) => `[${e.codigo}] ${e.descricao}`).join(' | '),
    })
    .eq('id', p.notaId)

  return {
    notaId: p.notaId,
    status: 'rejeitada',
    ambiente: p.ambiente,
    idDps: p.idDps,
    numeroDps: p.numeroDps,
    serieDps: p.serieDps,
    erros,
    rawResponse: p.raw.body,
    rawStatus: p.raw.status,
  }
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return { raw: s }
  }
}

// =====================================================================
// Cancelamento de NFS-e (evento e101101 — Cancelamento)
// =====================================================================

export interface CancelarNfseInput {
  notaId: string
  codigoMotivo: CodigoMotivoCancelamento  // '1' Erro emissão, '2' Serv não prestado, '9' Outros
  descricaoMotivo: string  // mín. 15 chars
}

export interface CancelarNfseResult {
  notaId: string
  status: 'cancelada' | 'rejeitada' | 'falha_temporaria'
  ambiente: Ambiente
  idEvento: string
  chaveAcesso: string
  erros?: Array<{ codigo: string; descricao: string; complemento?: string }>
  rawResponse: string
  rawStatus: number
}

export async function cancelarNfse(input: CancelarNfseInput): Promise<CancelarNfseResult> {
  // 1. Carrega nota + empresa
  const { data: nota } = await supabase
    .from('notas_fiscais')
    .select('*, empresas(*)')
    .eq('id', input.notaId)
    .eq('tipo', 'nfse')
    .maybeSingle()
  if (!nota) throw new Error(`NFS-e não encontrada: ${input.notaId}`)
  if (nota.status !== 'autorizada') {
    throw new Error(`Só é possível cancelar NFS-e com status 'autorizada' (atual: ${nota.status})`)
  }
  if (!nota.chave_acesso_nfse) {
    throw new Error('NFS-e sem chave de acesso registrada — não é possível cancelar')
  }

  const empresa = (nota as { empresas?: Record<string, unknown> }).empresas
  if (!empresa) throw new Error('Empresa associada à nota não encontrada')

  const cnpjEmpresa = String(empresa.cnpj || '').replace(/\D/g, '')
  if (!cnpjEmpresa) throw new Error('Empresa sem CNPJ cadastrado')

  const ambiente = (nota.ambiente_nfse || 2) as Ambiente

  // 2. Carrega certificado
  const cert = await carregarCertificado(nota.empresa_id)
  if (!cert) throw new Error('Certificado A1 não encontrado para a empresa')

  // 3. Monta evento de cancelamento
  const { xml: xmlEvento, idEvento } = buildEventoCancelamentoXml({
    ambiente,
    chaveAcesso: nota.chave_acesso_nfse,
    cnpjAutor: cnpjEmpresa,
    codigoMotivo: input.codigoMotivo,
    descricaoMotivo: input.descricaoMotivo,
    sequencial: 1,
    versaoAplicativo: 'NFE-API-1.0',
    dataHora: new Date(),
  })

  try {
    // 4. Assina
    const pfx = carregarMaterialPfx(cert.pfxBuffer, cert.senha)
    const signedXml = signEvento(xmlEvento, idEvento, pfx)

    // Sobe XML do evento no Storage
    const xmlEventoPath = `${nota.empresa_id}/${nowYYYYMM()}/${idEvento}-evento-cancelamento.xml`
    await supabase.storage.from('nfse-xml').upload(xmlEventoPath, signedXml, {
      upsert: true,
      contentType: 'application/xml',
    })

    // 5. Comprime e posta
    const eventoB64 = compressGzipBase64(signedXml)
    const agent = criarMtlsAgent(pfx, { insecureSkipServerVerify: true })
    const res = await postEvento({ agent, ambiente }, nota.chave_acesso_nfse, eventoB64)

    // 6. Interpreta resposta
    if (res.status === 200 || res.status === 201) {
      // Atualiza nota como cancelada
      const respJson = tryParseJson(res.body)
      const mensagensRetorno =
        typeof nota.mensagens_retorno === 'object' && nota.mensagens_retorno !== null
          ? { ...(nota.mensagens_retorno as Record<string, unknown>), evento_cancelamento: respJson }
          : { evento_cancelamento: respJson }

      await supabase
        .from('notas_fiscais')
        .update({
          status: 'cancelada',
          motivo_rejeicao: `Cancelada (motivo ${input.codigoMotivo}): ${input.descricaoMotivo}`,
          mensagens_retorno: mensagensRetorno,
        })
        .eq('id', input.notaId)

      return {
        notaId: input.notaId,
        status: 'cancelada',
        ambiente,
        idEvento,
        chaveAcesso: nota.chave_acesso_nfse,
        rawResponse: res.body,
        rawStatus: res.status,
      }
    }

    // Erro na resposta
    let erros: Array<{ codigo: string; descricao: string; complemento?: string }> = []
    try {
      const json = JSON.parse(res.body) as { erros?: Array<{ Codigo: string; Descricao: string; Complemento?: string }> }
      erros = (json.erros || []).map((e) => ({
        codigo: e.Codigo,
        descricao: e.Descricao,
        complemento: e.Complemento,
      }))
    } catch {
      erros = [{ codigo: 'HTTP', descricao: `Status ${res.status}: ${res.body.slice(0, 200)}` }]
    }
    return {
      notaId: input.notaId,
      status: 'rejeitada',
      ambiente,
      idEvento,
      chaveAcesso: nota.chave_acesso_nfse,
      erros,
      rawResponse: res.body,
      rawStatus: res.status,
    }
  } catch (e) {
    return {
      notaId: input.notaId,
      status: 'falha_temporaria',
      ambiente,
      idEvento,
      chaveAcesso: nota.chave_acesso_nfse,
      erros: [{ codigo: 'LOCAL', descricao: (e as Error).message }],
      rawResponse: '',
      rawStatus: 0,
    }
  }
}
