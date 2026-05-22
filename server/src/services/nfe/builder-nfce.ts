/**
 * Builder XML de NFC-e (modelo 65).
 *
 * NFC-e usa a mesma raiz <NFe>/<infNFe> da NF-e, com diferenças:
 *   - mod = "65"
 *   - tpImp = "4" (DANFE NFC-e)
 *   - dest é opcional pra notas <R$10k em CE
 *   - precisa do bloco <infNFeSupl> com <qrCode> e <urlChave>
 *   - finNFe = 1 (normal) na maioria dos casos
 *
 * O bloco <infNFeSupl> é inserido APÓS <infNFe> e ANTES de <Signature>.
 *
 * ⚠️ ESQUELETO DE TESTE — reutiliza buildNfeXml e adiciona o suplementar.
 */

import { buildNfeXml, type BuildNfeInput } from './builder-nfe.js'
import { gerarQrCodeNfce } from './qrcode.js'
import type { Ambiente } from './types.js'

export interface BuildNfceInput extends BuildNfeInput {
  csc: { id: string; token: string }
}

export interface BuildNfceOutput {
  xml: string
  idNfe: string
  qrCode: string
  urlConsulta: string
}

export function buildNfceXml(input: BuildNfceInput): BuildNfceOutput {
  if (input.modelo !== 65) {
    throw new Error(`buildNfceXml chamado com modelo ${input.modelo} (esperado 65)`)
  }

  const { xml: xmlBase, idNfe } = buildNfeXml(input)

  const qr = gerarQrCodeNfce({
    chaveAcesso: input.chaveAcesso,
    ambiente: input.ambiente as Ambiente,
    cscId: input.csc.id,
    cscToken: input.csc.token,
  })

  // Injeta <infNFeSupl> dentro de <NFe>, depois do </infNFe> e antes de <Signature>.
  // O signer espera essa ordem porque a Signature referencia o Id do <infNFe>.
  const xmlComSupl = inserirSuplementar(xmlBase, qr.qrCode, qr.urlConsulta)

  return {
    xml: xmlComSupl,
    idNfe,
    qrCode: qr.qrCode,
    urlConsulta: qr.urlConsulta,
  }
}

function inserirSuplementar(xml: string, qrCode: string, urlChave: string): string {
  // qrCode/urlChave vão sem CDATA, com chars escapados.
  // infNFeSupl NÃO leva atributo Id (a schema PL_009_V4 só pede os 2 filhos).
  const supl =
    `<infNFeSupl>` +
    `<qrCode>${escapeXmlText(qrCode)}</qrCode>` +
    `<urlChave>${escapeXmlText(urlChave)}</urlChave>` +
    `</infNFeSupl>`

  const idx = xml.lastIndexOf('</infNFe>')
  if (idx === -1) throw new Error('Tag </infNFe> não encontrada no XML base')
  const insertAt = idx + '</infNFe>'.length
  return xml.slice(0, insertAt) + supl + xml.slice(insertAt)
}

function escapeXmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
