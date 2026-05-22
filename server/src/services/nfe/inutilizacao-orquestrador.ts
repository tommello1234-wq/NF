/**
 * Orquestrador de inutilização de numeração NF-e/NFC-e.
 *
 * Fluxo:
 *   1. Carrega empresa + certificado
 *   2. Monta XML inutNFe, assina, envia ao NfeInutilizacao4
 *   3. Persiste linha em inutilizacoes
 *   4. Se cStat 102 (homologada), nada mais a fazer — a numeração fica queimada
 */

import { supabase } from '../supabase.js'
import { carregarCertificado } from '../certificado.js'
import { buildInutilizacaoXml } from './inutilizacao.js'
import { assinarXmlInutilizacao, carregarMaterialPfxNfe } from './signer.js'
import { enviarInutilizacao, parseSoapResposta, type TransmissaoConfig } from './transmissor.js'
import type { Ambiente, Modelo } from './types.js'

export interface InutilizacaoOrqInput {
  empresaId: string
  modelo: Modelo                       // 55 ou 65
  serie: number
  numeroInicial: number
  numeroFinal: number
  justificativa: string
  ano?: number
  ambiente?: Ambiente                  // default = empresa.ambiente_sefaz
}

export interface InutilizacaoOrqResult {
  inutilizacaoId: string
  status: 'autorizada' | 'rejeitada' | 'falha_temporaria'
  cStat?: string
  motivo?: string
  protocolo?: string
  rawResponse?: string
}

export async function inutilizarNumeracao(
  input: InutilizacaoOrqInput,
): Promise<InutilizacaoOrqResult> {
  const { data: empresa, error: empErr } = await supabase
    .from('empresas')
    .select('cnpj, ambiente_sefaz')
    .eq('id', input.empresaId)
    .maybeSingle()
  if (empErr || !empresa) throw new Error(`Empresa não encontrada: ${input.empresaId}`)

  const ambiente = (input.ambiente ?? empresa.ambiente_sefaz ?? 2) as Ambiente
  const ano = input.ano ?? new Date().getFullYear()

  const cert = await carregarCertificado(input.empresaId)
  if (!cert) throw new Error('Certificado A1 da empresa não encontrado')

  const built = buildInutilizacaoXml({
    ambiente,
    cnpjEmitente: empresa.cnpj,
    modelo: input.modelo,
    serie: input.serie,
    numeroInicial: input.numeroInicial,
    numeroFinal: input.numeroFinal,
    justificativa: input.justificativa,
    ano,
  })

  const material = carregarMaterialPfxNfe(cert.pfxBuffer, cert.senha)
  const xmlAssinado = assinarXmlInutilizacao(built.xml, built.idInut, material)

  const { data: inutRow, error: rowErr } = await supabase
    .from('inutilizacoes')
    .insert({
      empresa_id: input.empresaId,
      modelo: input.modelo,
      serie: input.serie,
      numero_inicial: input.numeroInicial,
      numero_final: input.numeroFinal,
      ano,
      justificativa: input.justificativa,
      status: 'pendente',
    })
    .select()
    .single()
  if (rowErr || !inutRow) throw new Error(`Erro ao registrar inutilização: ${rowErr?.message}`)

  const xmlPath = `${input.empresaId}/inutilizacoes/${built.idInut}.xml`
  await supabase.storage.from('notas-xml').upload(xmlPath, xmlAssinado, {
    upsert: true,
    contentType: 'application/xml',
  })
  await supabase
    .from('inutilizacoes')
    .update({ xml_pedido_path: xmlPath })
    .eq('id', inutRow.id)

  const cfg: TransmissaoConfig = {
    modelo: input.modelo,
    ambiente,
    pfxBuffer: cert.pfxBuffer,
    pfxSenha: cert.senha,
  }

  let raw
  try {
    raw = await enviarInutilizacao(cfg, xmlAssinado)
  } catch (e) {
    await supabase
      .from('inutilizacoes')
      .update({ status: 'rejeitada', mensagens_retorno: { erro: (e as Error).message } })
      .eq('id', inutRow.id)
    return {
      inutilizacaoId: inutRow.id,
      status: 'falha_temporaria',
      motivo: (e as Error).message,
    }
  }

  const parsed = parseSoapResposta(raw.body) as Record<string, unknown>
  const infInut = (parsed.infInut || parsed) as Record<string, unknown>
  const cStat = String(infInut.cStat ?? '')
  const xMotivo = String(infInut.xMotivo ?? '')
  const protocolo = String(infInut.nProt ?? '')

  const homologada = cStat === '102'
  const xmlRetornoPath = `${input.empresaId}/inutilizacoes/${built.idInut}-ret.xml`
  await supabase.storage.from('notas-xml').upload(xmlRetornoPath, raw.body, {
    upsert: true,
    contentType: 'application/xml',
  })

  await supabase
    .from('inutilizacoes')
    .update({
      status: homologada ? 'autorizada' : 'rejeitada',
      protocolo: protocolo || null,
      data_processamento: new Date().toISOString(),
      xml_retorno_path: xmlRetornoPath,
      mensagens_retorno: { cStat, xMotivo, raw: raw.body.slice(0, 8000) },
    })
    .eq('id', inutRow.id)

  return {
    inutilizacaoId: inutRow.id,
    status: homologada ? 'autorizada' : 'rejeitada',
    cStat,
    motivo: xMotivo,
    protocolo: protocolo || undefined,
    rawResponse: raw.body,
  }
}
