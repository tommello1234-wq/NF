/**
 * Orquestrador de emissão NF-e (modelo 55) e NFC-e (modelo 65) — SEFAZ-CE.
 *
 * Pattern espelhado do nfse/orquestrador.ts:
 *   1. Carrega empresa, certificado, cliente, natureza, itens (produtos) do Supabase
 *   2. Reserva próximo número (proximo_numero_nfe ou proximo_numero_nfce)
 *   3. Gera chave de acesso (44 dígitos com cDV mod11)
 *   4. Monta XML (NF-e ou NFC-e com QR Code)
 *   5. Assina com A1 da empresa
 *   6. Persiste registro inicial em notas_fiscais (status='aguardando_sefaz')
 *   7. Transmite via SOAP/mTLS pra SEFAZ-CE
 *   8. Processa retorno e atualiza status (autorizada/rejeitada/falha_temporaria)
 *
 * ⚠️ ESQUELETO DE TESTE — sem chamada real de produção. Use o spike-nfe.ts
 * (a criar) pra testar antes de plugar no fluxo real.
 */

import { supabase } from '../supabase.js'
import { carregarCertificado } from '../certificado.js'
import { gerarChaveAcesso } from './chave-acesso.js'
import { buildNfeXml, type BuildNfeInput } from './builder-nfe.js'
import { buildNfceXml } from './builder-nfce.js'
import { assinarXmlNfe, carregarMaterialPfxNfe } from './signer.js'
import { enviarLoteNfe, type TransmissaoConfig } from './transmissor.js'
import type { Ambiente, Modelo, NfeInput, NfeResult } from './types.js'

export async function emitirNfe(input: NfeInput): Promise<NfeResult> {
  // 1. Carrega empresa
  const { data: empresa, error: empErr } = await supabase
    .from('empresas')
    .select('*')
    .eq('id', input.empresaId)
    .maybeSingle()
  if (empErr || !empresa) throw new Error(`Empresa não encontrada: ${input.empresaId}`)
  if (!empresa.ie) throw new Error('Empresa sem Inscrição Estadual — obrigatória pra NF-e/NFC-e')
  if (!empresa.endereco_codigo_ibge) throw new Error('Empresa sem código IBGE de município')
  if (input.modelo === 65 && (!empresa.csc_id || !empresa.csc_token)) {
    throw new Error('Empresa sem CSC cadastrado — obrigatório pra NFC-e (modelo 65)')
  }

  const ambiente = (empresa.ambiente_sefaz || 2) as Ambiente
  const isNfce = input.modelo === 65
  const serie = isNfce ? empresa.serie_nfce || 1 : empresa.serie_nfe || 1
  const numero = await reservarProximoNumero(input.empresaId, input.modelo, empresa)

  // 2. Carrega natureza, certificado, itens, cliente
  const natureza = await carregarNatureza(input.naturezaOperacaoId)
  const cert = await carregarCertificado(input.empresaId)
  if (!cert) throw new Error('Certificado A1 não encontrado pra empresa')
  const itensXml = await carregarItens(input.itens)
  const dest = await resolverDestinatario(input)

  // 3. Gera chave de acesso
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

  // 4. Monta XML
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
    transp: { modalidadeFrete: input.frete?.modalidade ?? 9 },
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
    const out = buildNfceXml({
      ...buildInput,
      csc: { id: empresa.csc_id, token: empresa.csc_token },
    })
    xmlUnsigned = out.xml
    idNfe = out.idNfe
    qrCode = out.qrCode
    urlConsulta = out.urlConsulta
  } else {
    const out = buildNfeXml(buildInput)
    xmlUnsigned = out.xml
    idNfe = out.idNfe
  }

  // 5. Assina
  const material = carregarMaterialPfxNfe(cert.pfxBuffer, cert.senha)
  const xmlAssinado = assinarXmlNfe(xmlUnsigned, idNfe, material)

  // 6. Cria registro inicial
  const { data: nota, error: notaErr } = await supabase
    .from('notas_fiscais')
    .insert({
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
      csc_id_usado: isNfce ? empresa.csc_id : null,
      forma_pagamento: input.pagamento.forma,
      valor_pago: input.pagamento.valor,
      troco: input.pagamento.troco,
      payload_original: input as unknown as Record<string, unknown>,
    })
    .select()
    .single()
  if (notaErr || !nota) throw new Error(`Erro ao criar registro: ${notaErr?.message}`)

  // 7. Salva XML assinado no Storage (mesmo bucket usado pelas NFS-e? Use 'notas-xml' do schema)
  const xmlPath = `${input.empresaId}/${yyyymm()}/${chave}-nfe.xml`
  await supabase.storage.from('notas-xml').upload(xmlPath, xmlAssinado, {
    upsert: true,
    contentType: 'application/xml',
  })
  await supabase.from('notas_fiscais').update({ xml_path: xmlPath }).eq('id', nota.id)

  // 8. Transmite
  const cfg: TransmissaoConfig = {
    modelo: input.modelo,
    ambiente,
    pfxBuffer: cert.pfxBuffer,
    pfxSenha: cert.senha,
  }

  try {
    const res = await enviarLoteNfe(cfg, xmlAssinado, 1, 1)
    return await processarRespostaSefaz({
      notaId: nota.id,
      modelo: input.modelo,
      ambiente,
      serie,
      numero,
      chaveAcesso: chave,
      qrCode,
      urlConsulta,
      raw: res,
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

async function carregarItens(itens: NfeInput['itens']) {
  const ids = itens.map((i) => i.produtoId)
  const { data: produtos, error } = await supabase.from('produtos').select('*').in('id', ids)
  if (error || !produtos) throw new Error(`Erro ao carregar produtos: ${error?.message}`)

  return itens.map((it, idx) => {
    const p = produtos.find((x) => x.id === it.produtoId)
    if (!p) throw new Error(`Produto ${it.produtoId} não encontrado`)
    if (!p.ncm) throw new Error(`Produto ${p.descricao} sem NCM cadastrado`)
    const valorUnit = it.valorUnitario ?? Number(p.valor_unitario || 0)
    return {
      numero: idx + 1,
      codigo: p.codigo_interno || p.id.slice(0, 8),
      descricao: p.descricao,
      ncm: p.ncm,
      cest: p.cest || undefined,
      cfop: it.cfop || p.cfop || '5102',
      unidadeComercial: p.unidade || 'UN',
      quantidadeComercial: it.quantidade,
      valorUnitario: valorUnit,
      valorTotal: +(valorUnit * it.quantidade - (it.valorDesconto || 0)).toFixed(2),
      gtin: p.gtin || 'SEM GTIN',
      origem: p.origem ?? 0,
      cstCsosn: p.cst_csosn || '102',
      cstPis: p.cst_pis || '49',
      cstCofins: p.cst_cofins || '49',
      aliquotaIcms: p.aliquota_icms ? Number(p.aliquota_icms) : undefined,
      aliquotaPis: p.aliquota_pis ? Number(p.aliquota_pis) : undefined,
      aliquotaCofins: p.aliquota_cofins ? Number(p.aliquota_cofins) : undefined,
      valorDesconto: it.valorDesconto,
      infoAdicional: it.infoAdicional,
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

type ItemBuilt = Awaited<ReturnType<typeof carregarItens>>[number]

function calcularTotais(itens: ItemBuilt[], _input: NfeInput) {
  const valorProdutos = itens.reduce((s, i) => s + i.valorTotal, 0)
  const valorDesconto = itens.reduce((s, i) => s + (i.valorDesconto || 0), 0)
  return {
    valorProdutos,
    valorDesconto,
    valorFrete: 0,
    valorSeguro: 0,
    valorOutras: 0,
    valorIcms: 0,
    valorIcmsSt: 0,
    valorIpi: 0,
    valorPis: 0,
    valorCofins: 0,
    valorTotalNota: +(valorProdutos - valorDesconto).toFixed(2),
  }
}

interface ProcessarParams {
  notaId: string
  modelo: Modelo
  ambiente: Ambiente
  serie: number
  numero: number
  chaveAcesso: string
  qrCode?: string
  urlConsulta?: string
  raw: { status: number; body: string; contentType: string }
}

async function processarRespostaSefaz(p: ProcessarParams): Promise<NfeResult> {
  // TODO: parse SOAP/XML do retorno (cStat 100 = autorizado, 110 = denegado, etc.)
  // SEFAZ-CE devolve <retEnviNFe> com <cStat> e <protNFe>.
  const sucesso = p.raw.status >= 200 && p.raw.status < 300 && /cStat>(100|150)</.test(p.raw.body)
  const protocoloMatch = p.raw.body.match(/<nProt>([^<]+)<\/nProt>/)
  const protocolo = protocoloMatch?.[1]

  await supabase
    .from('notas_fiscais')
    .update({
      status: sucesso ? 'autorizada' : 'rejeitada',
      protocolo,
      data_autorizacao: sucesso ? new Date().toISOString() : null,
      mensagens_retorno: { raw: p.raw.body.slice(0, 8000) },
    })
    .eq('id', p.notaId)

  return {
    notaId: p.notaId,
    status: sucesso ? 'autorizada' : 'rejeitada',
    modelo: p.modelo,
    ambiente: p.ambiente,
    serie: p.serie,
    numero: p.numero,
    chaveAcesso: p.chaveAcesso,
    protocolo,
    qrCode: p.qrCode,
    urlConsulta: p.urlConsulta,
    rawResponse: p.raw.body,
  }
}

function yyyymm(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
