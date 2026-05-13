/**
 * Transmissor SOAP/mTLS pra SEFAZ-CE (NF-e modelo 55 e NFC-e modelo 65).
 *
 * SEFAZ usa SOAP 1.2 com mTLS. O envelope tem header simples e o body
 * carrega o XML do serviço (lote, evento, inutilização etc.).
 *
 * Endpoints relevantes:
 *   - NfeAutorizacao4         — autorização (sync se indSinc=1, async se 0)
 *   - NfeRetAutorizacao4      — consulta recibo de lote async
 *   - NfeStatusServico4       — health check
 *   - NfeConsultaProtocolo4   — consulta nota emitida
 *   - NfeInutilizacao4        — inutilização de numeração
 *   - RecepcaoEvento4         — eventos (cancelamento, CCe)
 */

import https from 'node:https'
import { XMLParser } from 'fast-xml-parser'
import { SEFAZ_CE_URL, WS_PATH, type Ambiente, type Modelo } from './types.js'

export interface TransmissaoConfig {
  modelo: Modelo                       // 55 ou 65 — escolhe a base URL correta
  ambiente: Ambiente                   // 1 = produção, 2 = homologação
  pfxBuffer: Buffer
  pfxSenha: string
  /** UF do autorizador (default 'CE'). Reservado pra suporte multi-UF futuro. */
  uf?: 'CE'
}

export interface SoapResposta {
  status: number
  body: string
  contentType: string
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
})

/** Cria um Agent HTTPS com mTLS (cert do contribuinte + chave privada do PFX).
 *  rejectUnauthorized=false porque a cadeia ICP-Brasil da SEFAZ não está nos CAs
 *  default do Node. Pra produção, idealmente carregar a cadeia ICP via `ca:`. */
export function criarAgenteMtls(cfg: TransmissaoConfig): https.Agent {
  return new https.Agent({
    pfx: cfg.pfxBuffer,
    passphrase: cfg.pfxSenha,
    rejectUnauthorized: false,
    keepAlive: true,
  })
}

/**
 * Resolve a URL do webservice combinando ambiente, modelo e ação.
 *   modelo=55 → SEFAZ_CE_URL.nfe.<amb>
 *   modelo=65 → SEFAZ_CE_URL.nfce.<amb>
 */
export function resolverUrl(cfg: TransmissaoConfig, path: keyof typeof WS_PATH): string {
  const amb = cfg.ambiente === 1 ? 'prod' : 'homolog'
  const base = cfg.modelo === 65 ? SEFAZ_CE_URL.nfce[amb] : SEFAZ_CE_URL.nfe[amb]
  return `${base}${WS_PATH[path]}`
}

/**
 * Envia uma requisição SOAP 1.2 conforme spec NF-e v4.00.
 * Header SOAPAction não é usado em SOAP 1.2 — o action vai no Content-Type.
 */
export async function postSoap(
  cfg: TransmissaoConfig,
  url: string,
  envelope: string,
  soapAction: string,
): Promise<SoapResposta> {
  const agent = criarAgenteMtls(cfg)

  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.request(
      {
        method: 'POST',
        host: u.hostname,
        port: u.port || 443,
        path: u.pathname,
        agent,
        headers: {
          'Content-Type': `application/soap+xml; charset=utf-8; action="${soapAction}"`,
          'Accept': 'application/soap+xml',
          'User-Agent': 'NF-API-1.0',
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8')
          resolve({
            status: res.statusCode || 0,
            body,
            contentType: res.headers['content-type']?.toString() || '',
          })
        })
      },
    )
    req.on('error', reject)
    req.write(envelope)
    req.end()
  })
}

/**
 * Monta o envelope SOAP padrão da SEFAZ.
 * @param xmlContent XML do serviço (nfeAutorizacaoLote, consSitNFe, etc.)
 * @param wsdl       Namespace do serviço (ex: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4')
 */
export function montarEnvelopeSoap(xmlContent: string, wsdl: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap:Body>` +
    `<nfeDadosMsg xmlns="${wsdl}">${xmlContent}</nfeDadosMsg>` +
    `</soap:Body></soap:Envelope>`
  )
}

// === Parser ===

/** Parseia um envelope SOAP da SEFAZ e retorna o nó "ret*" como objeto. */
export function parseSoapResposta(body: string): Record<string, unknown> {
  const tree = xmlParser.parse(body) as Record<string, unknown>
  const env = (tree.Envelope || tree['soap:Envelope']) as Record<string, unknown> | undefined
  const soapBody = env?.Body as Record<string, unknown> | undefined
  if (!soapBody) {
    // Pode ser uma resposta direta sem envelope SOAP (raro, mas preparado).
    return tree
  }
  // O wrapper costuma ser nfeResultMsg ou nfeRecepcaoEventoResult etc.
  const innerKey = Object.keys(soapBody).find((k) => !k.startsWith('@_'))
  if (!innerKey) return soapBody
  const inner = soapBody[innerKey] as Record<string, unknown> | undefined
  if (!inner) return soapBody
  const retKey = Object.keys(inner).find((k) => !k.startsWith('@_'))
  return retKey ? (inner[retKey] as Record<string, unknown>) : inner
}

// === Ações de alto nível ===

/**
 * Envia um lote de NFe pra autorização.
 * indSinc=1 (síncrono, recomendado pra NFC-e) → resposta tem <protNFe> direto.
 * indSinc=0 (assíncrono) → resposta tem <infRec>/<nRec> que precisa ser polled
 * via consultarRecibo().
 */
export async function enviarLoteNfe(
  cfg: TransmissaoConfig,
  xmlNfeAssinada: string,
  idLote: number = 1,
  indSinc: 0 | 1 = 1,
): Promise<SoapResposta> {
  const url = resolverUrl(cfg, 'autorizacao')
  const wsdl = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4'

  const enviNFe =
    `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<idLote>${idLote}</idLote>` +
    `<indSinc>${indSinc}</indSinc>` +
    stripXmlDecl(xmlNfeAssinada) +
    `</enviNFe>`

  return postSoap(cfg, url, montarEnvelopeSoap(enviNFe, wsdl), `${wsdl}/nfeAutorizacaoLote`)
}

/** Remove a declaração <?xml ... ?> de um XML — necessário pra embutir o XML
 *  assinado dentro de outro XML (enviNFe, envEvento, inutNFe). */
function stripXmlDecl(xml: string): string {
  return xml.replace(/^\s*<\?xml[^?]*\?>\s*/i, '')
}

/**
 * Consulta o recibo de um lote enviado em modo assíncrono (indSinc=0).
 * Retorna `<retConsReciNFe>` com cStat 105 (lote em proc), 104 (processado), etc.
 */
export async function consultarRecibo(
  cfg: TransmissaoConfig,
  nRec: string,
): Promise<SoapResposta> {
  const url = resolverUrl(cfg, 'retAutorizacao')
  const wsdl = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRetAutorizacao4'

  const xml =
    `<consReciNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<tpAmb>${cfg.ambiente}</tpAmb>` +
    `<nRec>${nRec}</nRec>` +
    `</consReciNFe>`

  return postSoap(cfg, url, montarEnvelopeSoap(xml, wsdl), `${wsdl}/nfeRetAutorizacaoLote`)
}

/** Status do serviço SEFAZ (pra health check antes de transmitir lotes). */
export async function consultarStatusServico(cfg: TransmissaoConfig): Promise<SoapResposta> {
  const url = resolverUrl(cfg, 'statusServico')
  const wsdl = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4'

  const xml =
    `<consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<tpAmb>${cfg.ambiente}</tpAmb>` +
    `<cUF>23</cUF>` +
    `<xServ>STATUS</xServ>` +
    `</consStatServ>`

  return postSoap(cfg, url, montarEnvelopeSoap(xml, wsdl), `${wsdl}/nfeStatusServicoNF`)
}

/** Consulta de nota já emitida pela chave de acesso.
 *  O host de consulta na SVRS é o de NF-e (modelo 55) mesmo quando consultando
 *  uma NFC-e — o host de NFC-e não expõe esse endpoint. */
export async function consultarProtocolo(
  cfg: TransmissaoConfig,
  chaveAcesso: string,
): Promise<SoapResposta> {
  // Força modelo=55 pro host correto, independente do modelo da nota.
  const cfgConsulta: TransmissaoConfig = { ...cfg, modelo: 55 }
  const url = resolverUrl(cfgConsulta, 'consultaProtocolo')
  const wsdl = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4'

  const xml =
    `<consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<tpAmb>${cfg.ambiente}</tpAmb>` +
    `<xServ>CONSULTAR</xServ>` +
    `<chNFe>${chaveAcesso}</chNFe>` +
    `</consSitNFe>`

  return postSoap(cfgConsulta, url, montarEnvelopeSoap(xml, wsdl), `${wsdl}/nfeConsultaNF`)
}

/**
 * Envia um evento (cancelamento, CCe etc.) pra RecepcaoEvento4.
 * @param eventoXmlAssinado XML completo do <evento> já assinado.
 */
export async function enviarEvento(
  cfg: TransmissaoConfig,
  eventoXmlAssinado: string,
  idLote: number = 1,
): Promise<SoapResposta> {
  const url = resolverUrl(cfg, 'recepcaoEvento')
  const wsdl = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4'

  const envEvento =
    `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
    `<idLote>${idLote}</idLote>` +
    stripXmlDecl(eventoXmlAssinado) +
    `</envEvento>`

  return postSoap(cfg, url, montarEnvelopeSoap(envEvento, wsdl), `${wsdl}/nfeRecepcaoEvento`)
}

/**
 * Envia uma inutilização de numeração pra NfeInutilizacao4.
 * @param inutXmlAssinado XML completo do <inutNFe> já assinado.
 */
export async function enviarInutilizacao(
  cfg: TransmissaoConfig,
  inutXmlAssinado: string,
): Promise<SoapResposta> {
  const url = resolverUrl(cfg, 'inutilizacao')
  const wsdl = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4'

  return postSoap(cfg, url, montarEnvelopeSoap(stripXmlDecl(inutXmlAssinado), wsdl), `${wsdl}/nfeInutilizacaoNF`)
}
