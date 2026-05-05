import { create } from 'xmlbuilder2'
import { NFSE_NS, VERSAO_DPS } from './types.js'
import type { Ambiente } from './types.js'

/**
 * Builder de "Pedido de Registro de Evento" (pedRegEvento).
 * Refs:
 *   - pedRegEvento_v1.01.xsd
 *   - tiposEventos_v1.00.xsd
 *
 * Estrutura geral:
 *   <pedRegEvento xmlns versao="1.01">
 *     <infPedReg Id="PRE{chaveAcesso50}{tpEvento6}{nPedRegEvento3}">
 *       <tpAmb>1|2</tpAmb>
 *       <verAplic>...</verAplic>
 *       <dhEvento>ISO UTC com TZ</dhEvento>
 *       <CNPJAutor>...</CNPJAutor> | <CPFAutor>...</CPFAutor>
 *       <chNFSe>...50 chars...</chNFSe>
 *       <e101101>     <!-- ou outro evento -->
 *         <xDesc>Cancelamento de NFS-e</xDesc>
 *         <cMotivo>1|2|9</cMotivo>
 *         <xMotivo>livre</xMotivo>
 *       </e101101>
 *     </infPedReg>
 *     <ds:Signature/>   <!-- adicionada pelo xml-signer -->
 *   </pedRegEvento>
 *
 * Tipos de evento implementados aqui:
 *   - 101101 = Cancelamento de NFS-e (TE101101)
 *
 * cMotivo (TSCodJustCanc):
 *   1 - Erro na Emissão
 *   2 - Serviço não Prestado
 *   9 - Outros
 */

export type CodigoMotivoCancelamento = '1' | '2' | '9'

export interface CancelamentoEventoInput {
  ambiente: Ambiente
  chaveAcesso: string  // 50 chars
  /** CNPJ do autor (geralmente o emitente da NFS-e) */
  cnpjAutor: string
  /** Código do motivo (1=Erro emissão, 2=Serv não prestado, 9=Outros) */
  codigoMotivo: CodigoMotivoCancelamento
  /** Descrição livre do motivo (15-255 chars típico) */
  descricaoMotivo: string
  /** Sequencial do evento (geralmente 1 — incrementa só se houver múltiplos do mesmo tipo) */
  sequencial?: number
  versaoAplicativo?: string
  dataHora?: Date
}

export function buildEventoCancelamentoXml(input: CancelamentoEventoInput): { xml: string; idEvento: string; tpEvento: string } {
  const tpEvento = '101101'
  const seq = (input.sequencial || 1)
  const seqStr = String(seq).padStart(3, '0')
  const chave = (input.chaveAcesso || '').replace(/\D/g, '').padStart(50, '0')
  if (chave.length !== 50) {
    throw new Error(`Chave de acesso NFS-e deve ter 50 dígitos: ${chave}`)
  }
  const cnpjAutor = (input.cnpjAutor || '').replace(/\D/g, '').padStart(14, '0')
  const dhEvento = isoUtc(input.dataHora || new Date())
  const verAplic = (input.versaoAplicativo || 'NFSE-API-1.0').slice(0, 20)

  const idEvento = `PRE${chave}${tpEvento}${seqStr}`
  if (idEvento.length !== 59) {
    throw new Error(`Id do evento inválido (${idEvento.length} chars): ${idEvento}`)
  }

  const motivo = (input.descricaoMotivo || '').slice(0, 255)
  if (motivo.length < 15) {
    throw new Error('Descrição do motivo de cancelamento precisa ter pelo menos 15 caracteres (xMotivo).')
  }

  const doc = create({ version: '1.0', encoding: 'UTF-8' })
  const ped = doc.ele('pedRegEvento', { xmlns: NFSE_NS, versao: VERSAO_DPS })
  const inf = ped.ele('infPedReg', { Id: idEvento })

  inf.ele('tpAmb').txt(String(input.ambiente))
  inf.ele('verAplic').txt(verAplic)
  inf.ele('dhEvento').txt(dhEvento)
  inf.ele('CNPJAutor').txt(cnpjAutor)
  inf.ele('chNFSe').txt(chave)

  const e = inf.ele('e101101')
  e.ele('xDesc').txt('Cancelamento de NFS-e')
  e.ele('cMotivo').txt(input.codigoMotivo)
  e.ele('xMotivo').txt(motivo)

  const xml = doc.end({ headless: false, prettyPrint: false })
  return { xml, idEvento, tpEvento }
}

function isoUtc(d: Date): string {
  // Sempre em horário de Brasília (UTC-3) — Vercel roda em UTC, então
  // formatamos manualmente. Subtrai 60s pra evitar clock skew (E0008).
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  const TZ_OFFSET_MIN = -180
  const adjusted = new Date(d.getTime() - 60_000 + TZ_OFFSET_MIN * 60_000)
  const Y = adjusted.getUTCFullYear()
  const M = pad(adjusted.getUTCMonth() + 1)
  const D = pad(adjusted.getUTCDate())
  const h = pad(adjusted.getUTCHours())
  const m = pad(adjusted.getUTCMinutes())
  const s = pad(adjusted.getUTCSeconds())
  return `${Y}-${M}-${D}T${h}:${m}:${s}-03:00`
}
