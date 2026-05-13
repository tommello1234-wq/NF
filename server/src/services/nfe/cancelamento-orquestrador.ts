/**
 * Orquestrador de cancelamento de NF-e/NFC-e.
 *
 * Fluxo:
 *   1. Carrega nota + empresa + certificado
 *   2. Determina próximo nSeqEvento (max(sequencial) + 1)
 *   3. Monta XML do evento, assina, envia ao RecepcaoEvento4
 *   4. Persiste linha em notas_fiscais_eventos
 *   5. Se SEFAZ devolveu cStat 135 (homologado) ou 155 (homologado fora do prazo),
 *      atualiza notas_fiscais.status = 'cancelada'
 */

import { supabase } from '../supabase.js'
import { carregarCertificado } from '../certificado.js'
import { buildCancelamentoXml } from './cancelamento.js'
import { assinarXmlEvento, carregarMaterialPfxNfe } from './signer.js'
import { enviarEvento, parseSoapResposta, type TransmissaoConfig } from './transmissor.js'
import type { Ambiente, Modelo } from './types.js'

export interface CancelamentoResult {
  notaId: string
  status: 'autorizado' | 'rejeitado' | 'falha_temporaria'
  cStat?: string
  motivo?: string
  protocolo?: string
  sequencial: number
  rawResponse?: string
}

export async function cancelarNota(
  notaId: string,
  justificativa: string,
): Promise<CancelamentoResult> {
  const { data: nota, error: notaErr } = await supabase
    .from('notas_fiscais')
    .select('*')
    .eq('id', notaId)
    .maybeSingle()
  if (notaErr || !nota) throw new Error(`Nota não encontrada: ${notaId}`)
  if (nota.status === 'cancelada') {
    throw new Error('Nota já está cancelada')
  }
  if (nota.status !== 'autorizada') {
    throw new Error(`Só notas autorizadas podem ser canceladas (status atual: ${nota.status})`)
  }
  if (!nota.chave_acesso) throw new Error('Nota sem chave de acesso — nunca foi transmitida')
  if (!nota.protocolo) throw new Error('Nota sem protocolo de autorização')
  if (!nota.modelo) throw new Error('Nota sem modelo (55 ou 65) — é uma NF-e/NFC-e?')

  const { data: empresa, error: empErr } = await supabase
    .from('empresas')
    .select('cnpj')
    .eq('id', nota.empresa_id)
    .maybeSingle()
  if (empErr || !empresa) throw new Error('Empresa da nota não encontrada')

  const ambiente = (nota.ambiente_nfe || 2) as Ambiente
  const modelo = nota.modelo as Modelo

  const { data: ultimoEvento } = await supabase
    .from('notas_fiscais_eventos')
    .select('sequencial')
    .eq('nota_id', notaId)
    .eq('tipo_evento', 'cancelamento')
    .order('sequencial', { ascending: false })
    .limit(1)
    .maybeSingle()
  const sequencial = (ultimoEvento?.sequencial ?? 0) + 1

  const cert = await carregarCertificado(nota.empresa_id)
  if (!cert) throw new Error('Certificado A1 da empresa não encontrado')

  const built = buildCancelamentoXml({
    ambiente,
    chaveAcesso: nota.chave_acesso,
    cnpjEmitente: empresa.cnpj,
    protocoloAutorizacao: nota.protocolo,
    justificativa,
    sequencial,
  })

  const material = carregarMaterialPfxNfe(cert.pfxBuffer, cert.senha)
  const xmlAssinado = assinarXmlEvento(built.xml, built.idEvento, material)

  const { data: eventoRow, error: evErr } = await supabase
    .from('notas_fiscais_eventos')
    .insert({
      nota_id: notaId,
      empresa_id: nota.empresa_id,
      tipo_evento: 'cancelamento',
      sequencial,
      motivo: justificativa,
      status: 'pendente',
    })
    .select()
    .single()
  if (evErr || !eventoRow) throw new Error(`Erro ao criar evento: ${evErr?.message}`)

  const xmlPath = `${nota.empresa_id}/eventos/${nota.chave_acesso}-canc-${String(sequencial).padStart(2, '0')}.xml`
  await supabase.storage.from('notas-xml').upload(xmlPath, xmlAssinado, {
    upsert: true,
    contentType: 'application/xml',
  })
  await supabase
    .from('notas_fiscais_eventos')
    .update({ xml_evento_path: xmlPath })
    .eq('id', eventoRow.id)

  const cfg: TransmissaoConfig = {
    modelo,
    ambiente,
    pfxBuffer: cert.pfxBuffer,
    pfxSenha: cert.senha,
  }

  let raw
  try {
    raw = await enviarEvento(cfg, xmlAssinado)
  } catch (e) {
    await supabase
      .from('notas_fiscais_eventos')
      .update({
        status: 'rejeitado',
        mensagens_retorno: { erro: (e as Error).message },
      })
      .eq('id', eventoRow.id)
    return {
      notaId,
      status: 'falha_temporaria',
      sequencial,
      motivo: (e as Error).message,
    }
  }

  const parsed = parseSoapResposta(raw.body)
  const ret = parsed as Record<string, unknown>
  const retEvento = (ret.retEvento || (Array.isArray(ret.retEvento) ? ret.retEvento[0] : ret)) as
    | Record<string, unknown>
    | undefined
  const infEvento = (retEvento?.infEvento || ret.infEvento) as Record<string, unknown> | undefined
  const cStat = String(infEvento?.cStat ?? ret.cStat ?? '')
  const xMotivo = String(infEvento?.xMotivo ?? ret.xMotivo ?? '')
  const protocolo = String(infEvento?.nProt ?? '')

  const homologado = cStat === '135' || cStat === '155'
  const xmlRetornoPath = `${nota.empresa_id}/eventos/${nota.chave_acesso}-canc-${String(sequencial).padStart(2, '0')}-ret.xml`
  await supabase.storage.from('notas-xml').upload(xmlRetornoPath, raw.body, {
    upsert: true,
    contentType: 'application/xml',
  })

  await supabase
    .from('notas_fiscais_eventos')
    .update({
      status: homologado ? 'autorizado' : 'rejeitado',
      protocolo: protocolo || null,
      data_evento: homologado ? new Date().toISOString() : null,
      xml_retorno_path: xmlRetornoPath,
      mensagens_retorno: { cStat, xMotivo, raw: raw.body.slice(0, 8000) },
    })
    .eq('id', eventoRow.id)

  if (homologado) {
    await supabase
      .from('notas_fiscais')
      .update({ status: 'cancelada' })
      .eq('id', notaId)
  }

  return {
    notaId,
    status: homologado ? 'autorizado' : 'rejeitado',
    cStat,
    motivo: xMotivo,
    protocolo: protocolo || undefined,
    sequencial,
    rawResponse: raw.body,
  }
}
