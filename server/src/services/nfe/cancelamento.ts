/**
 * Evento de Cancelamento de NF-e/NFC-e (tpEvento = 110111).
 *
 * Refs:
 *   - MOC NF-e v7.00 — capítulo 8 (Eventos)
 *   - Schema XSD: PL_009_V4 / envEvento_v1.00.xsd
 *
 * Estrutura:
 *   <envEvento versao="1.00">
 *     <idLote>1</idLote>
 *     <evento versao="1.00">
 *       <infEvento Id="ID110111<chave44><nSeqEvento(2)>">
 *         <cOrgao>23</cOrgao>          <!-- CE = 23 -->
 *         <tpAmb>1|2</tpAmb>
 *         <CNPJ>...</CNPJ>
 *         <chNFe>...44...</chNFe>
 *         <dhEvento>ISO -03:00</dhEvento>
 *         <tpEvento>110111</tpEvento>
 *         <nSeqEvento>1</nSeqEvento>
 *         <verEvento>1.00</verEvento>
 *         <detEvento versao="1.00">
 *           <descEvento>Cancelamento</descEvento>
 *           <nProt>...</nProt>
 *           <xJust>15-255 chars</xJust>
 *         </detEvento>
 *       </infEvento>
 *       <Signature/>
 *     </evento>
 *   </envEvento>
 *
 * Prazo: até 24h após autorização da NF-e/NFC-e (regra geral SEFAZ-CE).
 *
 * ⚠️ ESQUELETO DE TESTE.
 */

import { create } from 'xmlbuilder2'
import { NFE_NS, type Ambiente } from './types.js'

export interface CancelamentoInput {
  ambiente: Ambiente
  chaveAcesso: string                 // 44 dígitos
  cnpjEmitente: string                // 14 dígitos
  protocoloAutorizacao: string        // nProt da autorização original
  justificativa: string               // 15..255 chars
  sequencial?: number                 // default 1
  dataHoraEvento?: Date
}

export interface CancelamentoOutput {
  xml: string
  idEvento: string
  tpEvento: string
}

export function buildCancelamentoXml(input: CancelamentoInput): CancelamentoOutput {
  const tpEvento = '110111'
  const seq = input.sequencial ?? 1
  const seqStr = String(seq).padStart(2, '0')

  const chave = input.chaveAcesso.replace(/\D/g, '')
  if (chave.length !== 44) throw new Error(`Chave inválida (${chave.length}): ${chave}`)

  const cnpj = input.cnpjEmitente.replace(/\D/g, '').padStart(14, '0')
  if (cnpj.length !== 14) throw new Error(`CNPJ inválido: ${cnpj}`)

  const justificativa = (input.justificativa || '').trim()
  if (justificativa.length < 15 || justificativa.length > 255) {
    throw new Error(`Justificativa precisa ter 15-255 chars (atual: ${justificativa.length})`)
  }

  const idEvento = `ID${tpEvento}${chave}${seqStr}`
  const dh = isoBR(input.dataHoraEvento || new Date())

  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('envEvento', { xmlns: NFE_NS, versao: '1.00' })
      .ele('idLote').txt('1').up()
      .ele('evento', { xmlns: NFE_NS, versao: '1.00' })
        .ele('infEvento', { Id: idEvento })
          .ele('cOrgao').txt('23').up()                      // CE
          .ele('tpAmb').txt(String(input.ambiente)).up()
          .ele('CNPJ').txt(cnpj).up()
          .ele('chNFe').txt(chave).up()
          .ele('dhEvento').txt(dh).up()
          .ele('tpEvento').txt(tpEvento).up()
          .ele('nSeqEvento').txt(String(seq)).up()
          .ele('verEvento').txt('1.00').up()
          .ele('detEvento', { versao: '1.00' })
            .ele('descEvento').txt('Cancelamento').up()
            .ele('nProt').txt(input.protocoloAutorizacao).up()
            .ele('xJust').txt(justificativa).up()
          .up()
        .up()
      .up()

  return {
    xml: doc.end({ prettyPrint: false, headless: false }),
    idEvento,
    tpEvento,
  }
}

function isoBR(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}-03:00`
  )
}
