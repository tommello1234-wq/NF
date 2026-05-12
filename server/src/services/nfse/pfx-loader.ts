import forge from 'node-forge'

export interface PfxMaterial {
  /** PEM da chave privada (sem encriptação) */
  privateKeyPem: string
  /** PEM do certificado do titular */
  certificatePem: string
  /** Cadeia de CAs do PFX, se houver, em PEM */
  caChainPem: string[]
  /** Buffer original do PFX (útil pra https.Agent que aceita pfx direto) */
  pfxBuffer: Buffer
  /** Senha do PFX (precisa entregar pro https.Agent quando passa pfx) */
  passphrase: string
}

/**
 * Extrai chave privada e certificado de um PFX/P12.
 * Retorna PEMs prontos pra serem usados por xml-crypto e por https.Agent
 * (este último também aceita o buffer PFX + passphrase, útil pra evitar
 * expor a chave privada em texto).
 */
export function carregarMaterialPfx(pfxBuffer: Buffer, passphrase: string): PfxMaterial {
  const p12Der = forge.util.createBuffer(pfxBuffer.toString('binary'))
  const p12Asn1 = forge.asn1.fromDer(p12Der)
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, passphrase)

  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })
  const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]
  if (!keyBag?.key) throw new Error('Chave privada não encontrada no PFX')

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
  const certs = certBags[forge.pki.oids.certBag] || []
  if (certs.length === 0) throw new Error('Nenhum certificado encontrado no PFX')

  // Identifica certificado do titular (não-CA): basicConstraints.cA !== true
  let titular = certs[0]?.cert
  const cas: forge.pki.Certificate[] = []
  for (const bag of certs) {
    const cert = bag.cert
    if (!cert) continue
    const bc = cert.getExtension('basicConstraints') as { cA?: boolean } | undefined
    if (bc?.cA) cas.push(cert)
    else titular = cert
  }
  if (!titular) throw new Error('Certificado do titular não encontrado no PFX')

  const privateKeyPem = forge.pki.privateKeyToPem(keyBag.key as forge.pki.rsa.PrivateKey)
  const certificatePem = forge.pki.certificateToPem(titular)
  const caChainPem = cas.map((c) => forge.pki.certificateToPem(c))

  return {
    privateKeyPem,
    certificatePem,
    caChainPem,
    pfxBuffer,
    passphrase,
  }
}
