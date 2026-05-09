/**
 * Geração do QR Code da NFC-e (modelo 65).
 *
 * Refs:
 *   - Manual de Padrões Técnicos NFC-e v7.00, item 7.5
 *   - SEFAZ-CE: https://nfce.sefaz.ce.gov.br/pages/consultaNFCe.jsf
 *
 * Estrutura da URL do QR Code:
 *   <urlConsultaPublica>?p=<chaveAcesso>|<versao>|<tpAmb>|<idCSC>|<hash>
 *
 * Onde hash = SHA1 da concatenação:
 *   chaveAcesso + '|' + versao + '|' + tpAmb + '|' + idCSC + '|' + tokenCSC
 *   (resultado em hexadecimal lowercase)
 *
 * O token CSC NUNCA aparece na URL — só o hash. O ID do CSC sim aparece.
 */

import { createHash } from 'node:crypto'
import { SEFAZ_CE_URL, type Ambiente } from './types.js'

export interface QrCodeInput {
  chaveAcesso: string         // 44 chars
  ambiente: Ambiente          // 1=produção, 2=homologação
  cscId: string               // ID do CSC (geralmente "000001")
  cscToken: string            // Token do CSC — segredo, nunca exposto
  /** Versão do QR Code — atualmente "2" (v2.0) */
  versao?: '2'
}

export interface QrCodeOutput {
  /** URL completa do QR Code (vai pro <qrCode> no XML e DANFE) */
  qrCode: string
  /** URL pública de consulta (vai pro <urlChave> no XML) */
  urlConsulta: string
}

export function gerarQrCodeNfce(input: QrCodeInput): QrCodeOutput {
  const chave = (input.chaveAcesso || '').replace(/\D/g, '')
  if (chave.length !== 44) {
    throw new Error(`Chave de acesso NFC-e deve ter 44 dígitos: ${chave.length}`)
  }
  const versao = input.versao || '2'
  const tpAmb = String(input.ambiente)
  const cscId = String(input.cscId).padStart(6, '0')

  // Stringão pra calcular o hash (CSC token entra aqui mas nunca na URL)
  const stringHash = `${chave}|${versao}|${tpAmb}|${cscId}|${input.cscToken}`
  const hash = createHash('sha1').update(stringHash).digest('hex')

  const baseUrl =
    input.ambiente === 1
      ? SEFAZ_CE_URL.consultaPublicaNfce.prod
      : SEFAZ_CE_URL.consultaPublicaNfce.homolog

  const param = `${chave}|${versao}|${tpAmb}|${cscId}|${hash}`
  const qrCode = `${baseUrl}?p=${param}`

  return {
    qrCode,
    urlConsulta: baseUrl,
  }
}
