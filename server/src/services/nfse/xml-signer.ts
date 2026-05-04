import { SignedXml } from 'xml-crypto'
import type { PfxMaterial } from './pfx-loader.js'

/**
 * Assina envelope NFS-e (DPS, pedRegEvento, etc) com XMLDSIG enveloped:
 * - Canonicalização exclusiva sem comentários (xml-exc-c14n#)
 * - SHA-256 + RSA
 *
 * Pontos de falha conhecidos com a NFS-e Padrão Nacional:
 * - Reference URI deve bater EXATAMENTE com o Id do elemento interno
 * - O xml de entrada não pode ter indentação extra entre tags
 *   senão o DigestValue muda
 * - O <X509Certificate> deve ser DER base64 (sem -----BEGIN/END----- nem newlines)
 */
export interface SignXmlOptions {
  /** Local-name do elemento raiz onde a <Signature> será embutida (ex: 'DPS', 'pedRegEvento') */
  rootLocalName: string
  /** Local-name do elemento interno que tem o Id (ex: 'infDPS', 'infPedReg') */
  innerLocalName: string
  /** Valor do Id do elemento interno (deve casar com Reference URI=#id) */
  id: string
}

export function signNfseXml(xml: string, opts: SignXmlOptions, pfx: PfxMaterial): string {
  const sig = new SignedXml({
    privateKey: pfx.privateKeyPem,
    publicCert: pfx.certificatePem,
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    idAttribute: 'Id',
  })

  sig.addReference({
    xpath: `//*[local-name(.)='${opts.innerLocalName}' and @Id='${opts.id}']`,
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    uri: `#${opts.id}`,
  })

  sig.computeSignature(xml, {
    location: {
      reference: `//*[local-name(.)='${opts.rootLocalName}']`,
      action: 'append',
    },
  })

  return sig.getSignedXml()
}

/** Assina DPS — wrapper de signNfseXml com nomes corretos */
export function signDps(xml: string, idDps: string, pfx: PfxMaterial): string {
  return signNfseXml(xml, { rootLocalName: 'DPS', innerLocalName: 'infDPS', id: idDps }, pfx)
}

/** Assina pedRegEvento (cancelamento, etc.) */
export function signEvento(xml: string, idEvento: string, pfx: PfxMaterial): string {
  return signNfseXml(xml, { rootLocalName: 'pedRegEvento', innerLocalName: 'infPedReg', id: idEvento }, pfx)
}
