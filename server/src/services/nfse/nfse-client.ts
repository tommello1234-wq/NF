import https from 'node:https'
import type { Ambiente, NfseResponse } from './types.js'
import { ADN_PARAM_URL, SEFIN_URL } from './types.js'

interface ClientDeps {
  agent: https.Agent
  ambiente: Ambiente
}

function sefinBase(amb: Ambiente) {
  return amb === 1 ? SEFIN_URL.prod : SEFIN_URL.homolog
}

function adnParamBase(amb: Ambiente) {
  return amb === 1 ? ADN_PARAM_URL.prod : ADN_PARAM_URL.homolog
}

/** Chama POST /nfse com a DPS comprimida em GZip+Base64 */
export async function postDps(deps: ClientDeps, dpsGzipBase64: string): Promise<NfseResponse> {
  const url = `${sefinBase(deps.ambiente)}/nfse`
  const body = JSON.stringify({ dpsXmlGZipB64: dpsGzipBase64 })
  return doRequest(deps.agent, 'POST', url, body, {
    'content-type': 'application/json',
    accept: 'application/json',
  })
}

/** Consulta NFS-e pela chave de acesso (50 chars) */
export async function getNfse(deps: ClientDeps, chaveAcesso: string): Promise<NfseResponse> {
  const url = `${sefinBase(deps.ambiente)}/nfse/${encodeURIComponent(chaveAcesso)}`
  return doRequest(deps.agent, 'GET', url, null, { accept: 'application/json' })
}

/** Consulta os parâmetros de convênio do município emissor (sanity check) */
export async function getConvenioMunicipio(deps: ClientDeps, codigoIbge: string): Promise<NfseResponse> {
  // Endpoint ParametrosMunicipais foi movido pro ADN/parametrizacao
  const url = `${adnParamBase(deps.ambiente)}/parametros_municipais/${codigoIbge}/convenio`
  return doRequest(deps.agent, 'GET', url, null, { accept: 'application/json' })
}

/**
 * Posta um pedido de registro de evento (cancelamento, etc.) pra NFS-e.
 * Body do POST tem o mesmo shape de emissão: { dpsXmlGZipB64: '...' } com
 * o XML do pedRegEvento já comprimido (GZip+Base64).
 */
export async function postEvento(
  deps: ClientDeps,
  chaveAcesso: string,
  eventoGzipBase64: string
): Promise<NfseResponse> {
  const url = `${sefinBase(deps.ambiente)}/nfse/${encodeURIComponent(chaveAcesso)}/eventos`
  const body = JSON.stringify({ dpsXmlGZipB64: eventoGzipBase64 })
  return doRequest(deps.agent, 'POST', url, body, {
    'content-type': 'application/json',
    accept: 'application/json',
  })
}

/**
 * Baixa a DANFSe em PDF — a representacao grafica da NFS-e, que e o que se
 * manda pro cliente. O XML vale pra contabilidade; o PDF e o que a pessoa abre.
 *
 * O endpoint exige o mesmo mTLS da emissao (tentar sem certificado devolve
 * 403), por isso passa pelo nosso servidor em vez de ser um link direto.
 * Devolve o PDF cru — nao e JSON como os outros.
 */
export async function getDanfsePdf(
  deps: ClientDeps,
  chaveAcesso: string,
): Promise<{ status: number; contentType: string; buffer: Buffer }> {
  const url = `${sefinBase(deps.ambiente)}/danfse/${encodeURIComponent(chaveAcesso)}`
  return doRequestBinary(deps.agent, 'GET', url, { accept: 'application/pdf' })
}

function doRequestBinary(
  agent: https.Agent,
  method: string,
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; contentType: string; buffer: Buffer }> {
  const u = new URL(url)
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        agent,
        method,
        host: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () =>
          resolve({
            status: res.statusCode || 0,
            contentType: String(res.headers['content-type'] || ''),
            buffer: Buffer.concat(chunks),
          }),
        )
      },
    )
    req.on('error', reject)
    req.end()
  })
}

function doRequest(
  agent: https.Agent,
  method: string,
  url: string,
  body: string | null,
  headers: Record<string, string>
): Promise<NfseResponse> {
  const u = new URL(url)
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        agent,
        method,
        host: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        headers: {
          ...headers,
          ...(body ? { 'content-length': Buffer.byteLength(body).toString() } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () =>
          resolve({
            status: res.statusCode || 0,
            contentType: String(res.headers['content-type'] || ''),
            body: Buffer.concat(chunks).toString('utf-8'),
            headers: Object.fromEntries(
              Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v ?? '')])
            ),
          })
        )
      }
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}
