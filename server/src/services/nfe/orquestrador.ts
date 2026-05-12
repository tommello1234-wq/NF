/**
 * Orquestrador de emissão NF-e (modelo 55) e NFC-e (modelo 65) — SEFAZ-CE.
 *
 * Fluxo:
 *   1. Carrega empresa, certificado, cliente, natureza, itens (produtos) do Supabase
 *   2. Reserva próximo número (proximo_numero_nfe ou proximo_numero_nfce)
 *   3. Gera chave de acesso (44 dígitos com cDV mod11)
 *   4. Monta XML (NF-e ou NFC-e com QR Code)
 *   5. Assina com A1 da empresa
 *   6. Persiste registro inicial em notas_fiscais (status='aguardando_sefaz')
 *   7. Transmite via SOAP/mTLS pra SEFAZ-CE
 *   8. Processa retorno (com polling do recibo se SEFAZ devolveu lote em proc)
 *   9. Atualiza status, persiste itens em notas_fiscais_itens, baixa estoque
 */

import { supabase } from '../supabase.js'
import { carregarCertificado } from '../certificado.js'
import { gerarChaveAcesso } from './chave-acesso.js'
import { buildNfeXml, type BuildNfeInput, type ItemXml } from './builder-nfe.js'
import { buildNfceXml } from './builder-nfce.js'
import { assinarXmlNfe, carregarMaterialPfxNfe } from './signer.js'
import {
  consultarRecibo,
  enviarLoteNfe,
  parseSoapResposta,
  type SoapResposta,
  type TransmissaoConfig,
} from './transmissor.js'
import type { Ambiente, Modelo, NfeInput, NfeResult } from './types.js'

const POLL_INTERVAL_MS = 2000
const POLL_MAX_TRIES = 15

export async function emitirNfe(input: NfeInput): Promise<NfeResult> {
  const { data: empresa, error: empErr } = await supabase
    .from('empresas')
    .select('*')
    .eq('id', input.empresaId)
    .maybeSingle()
  if (empErr || !empresa) throw new Error(`Empresa não encontrada: ${input.empresaId}`)
  if (!empresa.ie) throw new Error('Empresa sem Inscrição Estadual — obrigatória pra NF-e/NFC-e')
  if (!empresa.endereco_codigo_ibge) throw new Error('Empresa sem código IBGE de município')

  const ambiente = (empresa.ambiente_sefaz || 2) as Ambiente
  const isNfce = input.modelo === 65
  const csc = resolverCsc(empresa, ambiente)
  if (isNfce && (!csc.id || !csc.token)) {
    throw new Error('Empresa sem CSC cadastrado pro ambiente atual — obrigatório pra NFC-e')
  }

  const serie = isNfce ? empresa.serie_nfce || 1 : empresa.serie_nfe || 1
  const numero = await reservarProximoNumero(input.empresaId, input.modelo, empresa)

  const natureza = await carregarNatureza(input.naturezaOperacaoId)
  const cert = await carregarCertificado(input.empresaId)
  if (!cert) throw new Error('Certificado A1 não encontrado pra empresa')
  const itensXml = await carregarItens(input.itens)
  // Regra SEFAZ: em homologação (ambiente=2) a descrição do PRIMEIRO item DEVE
  // ser literalmente esse texto. Caso contrário cStat 373.
  if (ambiente === 2 && itensXml[0]) {
    itensXml[0].descricao = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
  }
  const dest = await resolverDestinatario(input)

  const dataEmissao = new Date()
  const { chave, cnf, cdv } = gerarChaveAcesso({
    uf: 'CE',
    dataEmissao,
    cnpjEmitente: empresa.cnpj,
    modelo: input.modelo,
    serie,
    numero,
    tipoEmissao: 1,
  })

  const buildInput: BuildNfeInput = {
    chaveAcesso: chave,
    cnf,
    cdv,
    modelo: input.modelo,
    ambiente,
    serie,
    numero,
    dataEmissao,
    finalidade: 1,
    consumidorFinal: natureza.consumidor_final ?? true,
    indicadorPresenca: natureza.indicador_presenca ?? 1,
    naturezaOperacao: natureza.natureza,
    emit: {
      cnpj: empresa.cnpj.replace(/\D/g, ''),
      nome: empresa.razao_social,
      ie: empresa.ie,
      im: empresa.im || undefined,
      crt: (empresa.crt as 1 | 2 | 3 | 4) || 1,
      endereco: {
        logradouro: empresa.endereco_logradouro || '',
        numero: empresa.endereco_numero || 'S/N',
        bairro: empresa.endereco_bairro || '',
        codigoMunicipio: empresa.endereco_codigo_ibge,
        municipio: empresa.endereco_cidade || '',
        uf: empresa.endereco_uf || 'CE',
        cep: (empresa.endereco_cep || '').replace(/\D/g, ''),
      },
    },
    dest,
    itens: itensXml,
    total: calcularTotais(itensXml, input),
    transp: {
      modalidadeFrete: input.frete?.modalidade ?? 9,
      ...(input.frete?.transportadoraCnpj || input.frete?.transportadoraNome
        ? {
            transportadora: {
              cnpj: input.frete.transportadoraCnpj,
              nome: input.frete.transportadoraNome,
            },
          }
        : {}),
      ...(input.frete?.veiculoPlaca
        ? {
            veiculo: {
              placa: input.frete.veiculoPlaca,
              uf: input.frete.veiculoUf || empresa.endereco_uf || 'CE',
            },
          }
        : {}),
    },
    pag: [
      {
        forma: input.pagamento.forma,
        valor: input.pagamento.valor,
        troco: input.pagamento.troco,
        cnpjCredenciadora: input.pagamento.cnpjCredenciadora,
        bandeira: input.pagamento.bandeira,
        autorizacao: input.pagamento.autorizacao,
      },
    ],
    informacoesComplementares: input.informacoesComplementares,
  }

  let xmlUnsigned: string
  let idNfe: string
  let qrCode: string | undefined
  let urlConsulta: string | undefined

  if (isNfce) {
    const out = buildNfceXml({ ...buildInput, csc: { id: csc.id!, token: csc.token! } })
    xmlUnsigned = out.xml
    idNfe = out.idNfe
    qrCode = out.qrCode
    urlConsulta = out.urlConsulta
  } else {
    const out = buildNfeXml(buildInput)
    xmlUnsigned = out.xml
    idNfe = out.idNfe
  }

  const material = carregarMaterialPfxNfe(cert.pfxBuffer, cert.senha)
  const xmlAssinado = assinarXmlNfe(xmlUnsigned, idNfe, material)
  // Dump pra debug (só rodando spike): grava o XML antes do envio
  if (process.env.NFE_DEBUG_DUMP) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync('C:\\Users\\felip\\Desktop\\nfe-debug-sent.xml', xmlAssinado, 'utf-8')
  }

  const payloadCompleto = {
    empresa_id: input.empresaId,
    tipo: isNfce ? 'nfce' : 'nfe',
    modelo: input.modelo,
    ambiente_nfe: ambiente,
    serie,
    numero,
    chave_acesso: chave,
    status: 'aguardando_sefaz',
    natureza_operacao_id: input.naturezaOperacaoId,
    cliente_id: input.clienteId,
    destinatario_nome: dest?.nome,
    destinatario_cpf_cnpj: dest?.cpf || dest?.cnpj,
    valor_total: buildInput.total.valorTotalNota,
    valor_produtos: buildInput.total.valorProdutos,
    valor_desconto: buildInput.total.valorDesconto,
    qr_code_nfce: qrCode,
    url_consulta_nfce: urlConsulta,
    csc_id_usado: isNfce ? csc.id : null,
    forma_pagamento: input.pagamento.forma,
    valor_pago: input.pagamento.valor,
    troco: input.pagamento.troco,
    payload_original: input as unknown as Record<string, unknown>,
  }

  let { data: nota, error: notaErr } = await supabase
    .from('notas_fiscais')
    .insert(payloadCompleto)
    .select()
    .single()
  // Fallback se migration 013 não aplicada — insere só colunas da 004
  if (notaErr) {
    const payloadMinimo = {
      empresa_id: input.empresaId,
      tipo: isNfce ? 'nfce' : 'nfe',
      serie,
      numero,
      chave_acesso: chave,
      status: 'aguardando_sefaz',
      destinatario_nome: dest?.nome,
      destinatario_cpf_cnpj: dest?.cpf || dest?.cnpj,
      valor_total: buildInput.total.valorTotalNota,
    }
    const retry = await supabase.from('notas_fiscais').insert(payloadMinimo).select().single()
    nota = retry.data
    notaErr = retry.error
  }
  if (notaErr || !nota) throw new Error(`Erro ao criar registro: ${notaErr?.message}`)

  await persistirItens(nota.id, itensXml, input.itens)

  const xmlPath = `${input.empresaId}/${yyyymm()}/${chave}-nfe.xml`
  await supabase.storage.from('notas-xml').upload(xmlPath, xmlAssinado, {
    upsert: true,
    contentType: 'application/xml',
  })
  await supabase.from('notas_fiscais').update({ xml_path: xmlPath }).eq('id', nota.id)

  const cfg: TransmissaoConfig = {
    modelo: input.modelo,
    ambiente,
    pfxBuffer: cert.pfxBuffer,
    pfxSenha: cert.senha,
  }

  try {
    const res = await enviarLoteNfe(cfg, xmlAssinado, 1, 1)
    return await processarRespostaSefaz({
      cfg,
      notaId: nota.id,
      modelo: input.modelo,
      ambiente,
      serie,
      numero,
      chaveAcesso: chave,
      qrCode,
      urlConsulta,
      raw: res,
      itensInput: input.itens,
      xmlAssinado,
    })
  } catch (e) {
    await supabase
      .from('notas_fiscais')
      .update({ status: 'rejeitada', motivo_rejeicao: (e as Error).message })
      .eq('id', nota.id)
    return {
      notaId: nota.id,
      status: 'falha_temporaria',
      modelo: input.modelo,
      ambiente,
      serie,
      numero,
      chaveAcesso: chave,
      erros: [{ codigo: 'LOCAL', descricao: (e as Error).message }],
    }
  }
}

// === Helpers ===

interface CscEmpresa {
  id: string | null
  token: string | null
}

function resolverCsc(empresa: Record<string, unknown>, ambiente: Ambiente): CscEmpresa {
  const id =
    (ambiente === 1 ? (empresa.csc_id_prod as string | null) : (empresa.csc_id_homol as string | null)) ||
    (empresa.csc_id as string | null)
  const token =
    (ambiente === 1 ? (empresa.csc_token_prod as string | null) : (empresa.csc_token_homol as string | null)) ||
    (empresa.csc_token as string | null)
  return { id: id || null, token: token || null }
}

async function reservarProximoNumero(
  empresaId: string,
  modelo: Modelo,
  empresa: { proximo_numero_nfe: number; proximo_numero_nfce: number },
): Promise<number> {
  const campo = modelo === 65 ? 'proximo_numero_nfce' : 'proximo_numero_nfe'
  const atual = (modelo === 65 ? empresa.proximo_numero_nfce : empresa.proximo_numero_nfe) || 1
  await supabase
    .from('empresas')
    .update({ [campo]: atual + 1, updated_at: new Date().toISOString() })
    .eq('id', empresaId)
  return atual
}

async function carregarNatureza(naturezaId: string) {
  const { data, error } = await supabase
    .from('naturezas_operacao')
    .select('*')
    .eq('id', naturezaId)
    .maybeSingle()
  if (error || !data) throw new Error(`Natureza de operação não encontrada: ${naturezaId}`)
  return data
}

async function carregarItens(itens: NfeInput['itens']): Promise<ItemXml[]> {
  const ids = itens.map((i) => i.produtoId)
  const { data: produtos, error } = await supabase.from('produtos').select('*').in('id', ids)
  if (error || !produtos) throw new Error(`Erro ao carregar produtos: ${error?.message}`)

  return itens.map((it, idx) => {
    const p = produtos.find((x) => x.id === it.produtoId)
    if (!p) throw new Error(`Produto ${it.produtoId} não encontrado`)
    if (!p.ncm) throw new Error(`Produto ${p.descricao} sem NCM cadastrado`)
    const valorUnit = it.valorUnitario ?? Number(p.valor_unitario || 0)
    const quantidade = it.quantidade
    const desconto = it.valorDesconto || 0
    return {
      numero: idx + 1,
      codigo: p.codigo_interno || p.id.slice(0, 8),
      descricao: p.descricao,
      ncm: p.ncm,
      cest: p.cest || undefined,
      cfop: it.cfop || p.cfop || '5102',
      unidadeComercial: p.unidade || 'UN',
      unidadeTributavel: p.unidade_tributavel || p.unidade || 'UN',
      quantidadeComercial: quantidade,
      valorUnitario: valorUnit,
      valorTotal: +(valorUnit * quantidade - desconto).toFixed(2),
      gtin: p.gtin || 'SEM GTIN',
      origem: p.origem ?? 0,
      cstCsosn: p.cst_csosn || '102',
      cstPis: p.cst_pis || '49',
      cstCofins: p.cst_cofins || '49',
      cstIpi: p.cst_ipi || undefined,
      aliquotaIcms: p.aliquota_icms ? Number(p.aliquota_icms) : undefined,
      aliquotaPis: p.aliquota_pis ? Number(p.aliquota_pis) : undefined,
      aliquotaCofins: p.aliquota_cofins ? Number(p.aliquota_cofins) : undefined,
      aliquotaIpi: p.aliquota_ipi ? Number(p.aliquota_ipi) : undefined,
      pesoLiquido: p.peso_liquido ? Number(p.peso_liquido) : undefined,
      pesoBruto: p.peso_bruto ? Number(p.peso_bruto) : undefined,
      exTipi: p.ex_tipi || undefined,
      valorDesconto: desconto || undefined,
      infoAdicional: it.infoAdicional || p.info_adicional_produto || undefined,
      produtoId: p.id,
    }
  })
}

async function persistirItens(
  notaId: string,
  itensXml: ItemXml[],
  _itensInput: NfeInput['itens'],
) {
  const rows = itensXml.map((it) => ({
    nota_id: notaId,
    produto_id: it.produtoId,
    numero_item: it.numero,
    codigo_produto: it.codigo,
    descricao: it.descricao,
    ncm: it.ncm,
    cest: it.cest,
    cfop: it.cfop,
    unidade_comercial: it.unidadeComercial,
    quantidade_comercial: it.quantidadeComercial,
    valor_unitario: it.valorUnitario,
    valor_total: it.valorTotal,
    valor_desconto: it.valorDesconto,
    gtin: it.gtin,
    origem: it.origem,
    cst_csosn: it.cstCsosn,
    aliquota_icms: it.aliquotaIcms,
    cst_pis: it.cstPis,
    aliquota_pis: it.aliquotaPis,
    cst_cofins: it.cstCofins,
    aliquota_cofins: it.aliquotaCofins,
    info_adicional: it.infoAdicional,
  }))
  // Migration 013 cria essa tabela. Se não rodou, só ignora silenciosamente.
  await supabase.from('notas_fiscais_itens').insert(rows).then(({ error }) => {
    if (error && !/not find|does not exist/i.test(error.message)) {
      console.warn('Erro ao persistir itens (não bloqueante):', error.message)
    }
  })
}

async function resolverDestinatario(input: NfeInput) {
  if (input.destinatarioOverride) {
    const o = input.destinatarioOverride
    return {
      cpf: o.cpf,
      cnpj: o.cnpj,
      nome: o.nome,
      email: o.email,
      ie: o.inscricaoEstadual,
      indicadorIe: (o.indicadorIe || 9) as 1 | 2 | 9,
      endereco: o.endereco,
    }
  }
  if (!input.clienteId) return undefined            // pra NFC-e <R$10k pode ser sem dest
  const { data: c } = await supabase
    .from('clientes')
    .select('*')
    .eq('id', input.clienteId)
    .maybeSingle()
  if (!c) throw new Error(`Cliente ${input.clienteId} não encontrado`)
  const cpfCnpj = (c.cpf_cnpj || '').replace(/\D/g, '')
  return {
    cpf: cpfCnpj.length === 11 ? cpfCnpj : undefined,
    cnpj: cpfCnpj.length === 14 ? cpfCnpj : undefined,
    nome: c.nome,
    email: c.email || undefined,
    ie: c.ie || undefined,
    indicadorIe: (c.ie ? 1 : 9) as 1 | 2 | 9,
    endereco: c.endereco_logradouro
      ? {
          logradouro: c.endereco_logradouro,
          numero: c.endereco_numero || 'S/N',
          bairro: c.endereco_bairro || '',
          municipio: c.endereco_cidade || '',
          codigoMunicipio: c.endereco_codigo_ibge || '',
          uf: c.endereco_uf || 'CE',
          cep: (c.endereco_cep || '').replace(/\D/g, ''),
        }
      : undefined,
  }
}

function calcularTotais(itens: ItemXml[], _input: NfeInput) {
  const valorProdutos = itens.reduce((s, i) => s + i.valorTotal, 0)
  const valorDesconto = itens.reduce((s, i) => s + (i.valorDesconto || 0), 0)
  const valorIpi = itens.reduce((s, i) => {
    if (!i.aliquotaIpi) return s
    return s + (i.valorTotal * (i.aliquotaIpi / 100))
  }, 0)
  // ICMS total = soma do (valorTotal × aliquotaIcms / 100) de cada item.
  // Pra CST 00/10/20 isso precisa bater com o somatório do XML — senão cStat 531.
  const valorIcmsTotal = itens.reduce((s, i) => {
    if (!i.aliquotaIcms) return s
    // CST 40/41/50/60 não destacam ICMS — não somar.
    const cst = i.cstCsosn
    if (['40', '41', '50', '60'].includes(cst)) return s
    return s + (i.valorTotal * (i.aliquotaIcms / 100))
  }, 0)
  const valorBaseIcms = itens.reduce((s, i) => {
    if (!i.aliquotaIcms) return s
    const cst = i.cstCsosn
    if (['40', '41', '50', '60'].includes(cst)) return s
    return s + i.valorTotal
  }, 0)
  return {
    valorProdutos,
    valorDesconto,
    valorFrete: 0,
    valorSeguro: 0,
    valorOutras: 0,
    valorIcms: +valorIcmsTotal.toFixed(2),
    valorBaseIcms: +valorBaseIcms.toFixed(2),
    valorIcmsSt: 0,
    valorIpi: +valorIpi.toFixed(2),
    valorPis: 0,
    valorCofins: 0,
    valorTotalNota: +(valorProdutos - valorDesconto + valorIpi).toFixed(2),
  }
}

interface ProcessarParams {
  cfg: TransmissaoConfig
  notaId: string
  modelo: Modelo
  ambiente: Ambiente
  serie: number
  numero: number
  chaveAcesso: string
  qrCode?: string
  urlConsulta?: string
  raw: SoapResposta
  itensInput: NfeInput['itens']
  xmlAssinado: string
}

async function processarRespostaSefaz(p: ProcessarParams): Promise<NfeResult> {
  const parsed = parseSoapResposta(p.raw.body) as Record<string, unknown>

  let resultado = parsed
  // Se SEFAZ devolveu apenas o recibo (modo async ou sob carga), vai pra polling.
  const cStatLote = String(parsed.cStat ?? '')
  const nRec = (parsed.infRec as Record<string, unknown> | undefined)?.nRec as string | undefined
  if ((cStatLote === '103' || cStatLote === '105') && nRec) {
    const polled = await pollRecibo(p.cfg, nRec)
    resultado = polled
  }

  const protNFe = extrairProtNFe(resultado)
  const cStat = String(protNFe?.cStat ?? resultado.cStat ?? '')
  const xMotivo = String(protNFe?.xMotivo ?? resultado.xMotivo ?? '')
  const protocolo = String(protNFe?.nProt ?? '')

  const autorizada = cStat === '100' || cStat === '150'
  const denegada = cStat === '110' || cStat === '301' || cStat === '302'

  const updateCompleto: Record<string, unknown> = {
    status: autorizada ? 'autorizada' : denegada ? 'rejeitada' : 'rejeitada',
    protocolo: protocolo || null,
    data_autorizacao: autorizada ? new Date().toISOString() : null,
    motivo_rejeicao: autorizada ? null : xMotivo || null,
    mensagens_retorno: { cStat, xMotivo, raw: p.raw.body.slice(0, 8000) },
  }
  const { error: updErr } = await supabase
    .from('notas_fiscais')
    .update(updateCompleto)
    .eq('id', p.notaId)
  if (updErr) {
    // Fallback se migration 013 não aplicada — atualiza só status + protocolo
    await supabase
      .from('notas_fiscais')
      .update({ status: updateCompleto.status, protocolo: updateCompleto.protocolo })
      .eq('id', p.notaId)
  }

  if (autorizada) {
    await darBaixaEstoque(p.itensInput)
    // Monta e salva o XML autorizado oficial (<nfeProc>): seu XML + protNFe da SEFAZ.
    // Esse é o documento que tem valor fiscal — o que vai pro contador, SPED, cliente.
    await salvarNfeProc({
      empresaId: (await supabase.from('notas_fiscais').select('empresa_id').eq('id', p.notaId).single()).data?.empresa_id || '',
      chave: p.chaveAcesso,
      xmlAssinado: p.xmlAssinado,
      rawSefaz: p.raw.body,
      notaId: p.notaId,
    })
  }

  return {
    notaId: p.notaId,
    status: autorizada ? 'autorizada' : denegada ? 'denegada' : 'rejeitada',
    modelo: p.modelo,
    ambiente: p.ambiente,
    serie: p.serie,
    numero: p.numero,
    chaveAcesso: p.chaveAcesso,
    protocolo: protocolo || undefined,
    qrCode: p.qrCode,
    urlConsulta: p.urlConsulta,
    erros: autorizada ? undefined : [{ codigo: cStat, descricao: xMotivo }],
    rawResponse: p.raw.body,
  }
}

function extrairProtNFe(parsed: Record<string, unknown>): Record<string, unknown> | undefined {
  const direct = parsed.protNFe as Record<string, unknown> | undefined
  if (direct) {
    const inf = direct.infProt as Record<string, unknown> | undefined
    return inf || direct
  }
  // Pode estar dentro de retConsReciNFe
  const ret = parsed.retConsReciNFe as Record<string, unknown> | undefined
  if (ret?.protNFe) {
    const inf = (ret.protNFe as Record<string, unknown>).infProt as
      | Record<string, unknown>
      | undefined
    return inf || (ret.protNFe as Record<string, unknown>)
  }
  return undefined
}

/**
 * Monta o `<nfeProc>` (envelope oficial) extraindo o `<protNFe>` do retorno SEFAZ
 * e juntando com o `<NFe>` que assinamos. É esse arquivo que tem valor fiscal.
 */
async function salvarNfeProc(params: {
  empresaId: string
  chave: string
  xmlAssinado: string
  rawSefaz: string
  notaId: string
}): Promise<void> {
  const protMatch = params.rawSefaz.match(/<protNFe[^>]*>[\s\S]*?<\/protNFe>/)
  if (!protMatch) return // sem protNFe = não autorizada de fato

  // Remove a tag <NFe ...> wrapper só pra extrair o conteúdo, depois reembala.
  const nfeContent = params.xmlAssinado.replace(/<\?xml[^?]*\?>/, '')
  const nfeProc =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    nfeContent +
    protMatch[0] +
    `</nfeProc>`

  const path = `${params.empresaId}/${yyyymm()}/${params.chave}-procNFe.xml`
  await supabase.storage.from('notas-xml').upload(path, nfeProc, {
    upsert: true,
    contentType: 'application/xml',
  })
  await supabase
    .from('notas_fiscais')
    .update({ xml_proc_path: path })
    .eq('id', params.notaId)
}

async function pollRecibo(cfg: TransmissaoConfig, nRec: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < POLL_MAX_TRIES; i++) {
    await sleep(POLL_INTERVAL_MS)
    const res = await consultarRecibo(cfg, nRec)
    const parsed = parseSoapResposta(res.body) as Record<string, unknown>
    const cStat = String(parsed.cStat ?? '')
    if (cStat !== '105' && cStat !== '103') return parsed
  }
  throw new Error(`Timeout consultando recibo ${nRec} após ${POLL_MAX_TRIES} tentativas`)
}

async function darBaixaEstoque(itens: NfeInput['itens']) {
  // Coluna `estoque` vem da migration 014. Se não rodou, vira no-op.
  for (const it of itens) {
    const { data: p, error: selErr } = await supabase
      .from('produtos')
      .select('estoque')
      .eq('id', it.produtoId)
      .maybeSingle()
    if (selErr || !p || p.estoque == null) continue
    const novoEstoque = Math.max(0, Number(p.estoque || 0) - it.quantidade)
    await supabase
      .from('produtos')
      .update({ estoque: novoEstoque, updated_at: new Date().toISOString() })
      .eq('id', it.produtoId)
      .then(({ error }) => {
        if (error && !/not find|does not exist/i.test(error.message)) {
          console.warn('Erro ao baixar estoque (não bloqueante):', error.message)
        }
      })
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function yyyymm(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
