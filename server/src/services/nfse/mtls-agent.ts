import https from 'node:https'
import type { PfxMaterial } from './pfx-loader.js'

/**
 * Cria um https.Agent com mTLS.
 *
 * IMPORTANTE: passar o PFX direto (`pfx: pfxBuffer`) falha em Node 18+ com
 * OpenSSL 3 quando o A1 da ICP-Brasil usa algoritmos legados (RC2-40, SHA-1).
 * O erro é "Unsupported PKCS12 PFX data". Por isso usamos os PEMs já
 * extraídos pelo node-forge (que aceita os legados).
 *
 * keepAlive evita renegociar TLS a cada request (importante porque mTLS
 * tem custo de ~200ms por handshake).
 */
export interface MtlsAgentOptions {
  /**
   * Se true, ignora verificação da cadeia de CA do servidor (SEFIN).
   * Necessário porque o cert TLS do `adn.producaorestrita.nfse.gov.br` é
   * assinado pela ICP-Brasil, que o Node não traz no bundle padrão.
   * Pra produção: carregar o CA bundle ICP-Brasil em `extraCa`.
   */
  insecureSkipServerVerify?: boolean
  /** PEMs adicionais de CAs raiz (ex: ICP-Brasil) */
  extraCa?: string[]
}

export function criarMtlsAgent(pfx: PfxMaterial, opts: MtlsAgentOptions = {}): https.Agent {
  const cas = [
    ...(pfx.caChainPem || []),
    ...(opts.extraCa || []),
  ]
  return new https.Agent({
    key: pfx.privateKeyPem,
    cert: pfx.certificatePem,
    ca: cas.length > 0 ? cas : undefined,
    rejectUnauthorized: opts.insecureSkipServerVerify ? false : true,
    keepAlive: true,
    minVersion: 'TLSv1.2',
  })
}
