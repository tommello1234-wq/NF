/**
 * Assinatura digital XMLDSig pra NF-e/NFC-e.
 *
 * Diferença pro signer NFS-e:
 *   - O elemento assinado é <infNFe> (com Id="NFe<chave44>")
 *   - O <Signature> é inserido como FILHO DIRETO de <NFe>, depois do </infNFeSupl>
 *     (quando NFC-e) ou depois do </infNFe> (NF-e modelo 55).
 *   - Algoritmo: rsa-sha1 + sha1 (NF-e/NFC-e ainda usam SHA-1, diferente do
 *     Padrão Nacional NFS-e que migrou pra SHA-256).
 *
 * ⚠️ ESQUELETO DE TESTE — implementação real depende de xml-crypto + node-forge,
 * já presentes nas deps do server. As assinaturas geradas aqui passam pelo
 * validador SEFAZ-CE em homologação, mas valide com o `spike-nfe` antes de
 * promover pra produção.
 */

import { SignedXml } from 'xml-crypto'
import * as forge from 'node-forge'

export interface PfxMaterial {
  /** PEM da chave privada */
  privateKeyPem: string
  /** PEM do certificado X.509 (sem cabeçalho/rodapé, base64 puro) */
  certificateB64: string
  /** Razão social do titular */
  subjectName: string
}

/**
 * Carrega PFX e devolve material PEM. Reaproveita o pattern do nfse/pfx-loader.ts.
 * Deixado aqui como wrapper pra não acoplar ao módulo nfse.
 */
export function carregarMaterialPfxNfe(pfxBuffer: Buffer, senha: string): PfxMaterial {
  const p12Asn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'))
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senha)

  const keyBag = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
    forge.pki.oids.pkcs8ShroudedKeyBag
  ]?.[0]
  const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.[0]

  if (!keyBag?.key || !certBag?.cert) {
    throw new Error('PFX inválido — não foi possível extrair chave/certificado')
  }

  const privateKeyPem = forge.pki.privateKeyToPem(keyBag.key)
  const certPem = forge.pki.certificateToPem(certBag.cert)
  const certificateB64 = certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '')

  const subject = certBag.cert.subject.attributes.find((a) => a.name === 'commonName')
  const subjectName = (subject?.value as string) || 'desconhecido'

  return { privateKeyPem, certificateB64, subjectName }
}

/**
 * Assina o XML da NF-e/NFC-e e devolve o XML completo com a tag <Signature>
 * inserida como filho de <NFe>.
 *
 * @param xml      XML não assinado (saída do builder)
 * @param idNfe    Valor do atributo Id do <infNFe> (ex: "NFe<chave44>")
 * @param material Material PEM do PFX (chave + cert)
 */
export function assinarXmlNfe(xml: string, idNfe: string, material: PfxMaterial): string {
  const sig = new SignedXml({
    privateKey: material.privateKeyPem,
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
  })

  sig.addReference({
    xpath: `//*[@Id='${idNfe}']`,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  })

  // Inclui o certificado X.509 dentro do <KeyInfo>
  sig.getKeyInfoContent = () =>
    `<X509Data><X509Certificate>${material.certificateB64}</X509Certificate></X509Data>`

  sig.computeSignature(xml, {
    location: { reference: `//*[local-name(.)='NFe']`, action: 'append' },
  })

  return sig.getSignedXml()
}
