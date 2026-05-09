/**
 * Transmissor SOAP/mTLS pra SEFAZ-CE (NF-e modelo 55 e NFC-e modelo 65).
 *
 * SEFAZ usa SOAP 1.2 com mTLS (cliente apresenta o A1 da empresa, servidor
 * apresenta cert ICP-Brasil). O envelope tem um header simples e o body
 * carrega o XML já assinado da NFe (ou do lote).
 *
 * Endpoints relevantes (ver types.ts → SEFAZ_CE_URL e WS_PATH):
 *   - NfeAutorizacao4         — autorização síncrona/assíncrona
 *   - NfeRetAutorizacao4      — consulta recibo (modo assíncrono)
 *   - NfeStatusServico4       — health check
 *   - NfeConsultaProtocolo4   — consulta nota emitida
 *   - NfeInutilizacao4        — inutilização de numeração
 *   - RecepcaoEvento4         — eventos (cancelamento, CCe)
 *
 * ⚠️ ESQUELETO DE TESTE — só estrutura. mTLS via https.Agent com pfx, e parsing
 * SOAP é feito com regex simples ou DOMParser leve. Validar com homologação
 * antes de promover.
 */

import https from 'node:https'
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

/** Cria um Agent HTTPS com mTLS (cert do contribuinte + chave privada do PFX). */
export function criarAgenteMtls(cfg: TransmissaoConfig): https.Agent {
  return new https.Agent({
    pfx: cfg.pfxBuffer,
    passphrase: cfg.pfxSenha,
    rejectUnauthorized: true,
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
 * Envia uma requisição SOAP. O "envelope" deve ser o XML completo com
 * <soap:Envelope> e dentro o XML específico do serviço (nfeDadosMsg).
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
          'Content-Type': 'application/soap+xml; charset=utf-8',
          'SOAPAction': soapAction,
          'Accept': 'application/soap+xml, text/xml',
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

// === Ações de alto nível ===

/**
 * Envia um lote de NFe pra autorização (síncrono se indSinc=1, modo recomendado pra NFC-e).
 *
 * O lote tem a estrutura:
 *   <enviNFe versao="4.00">
 *     <idLote>1</idLote>
 *     <indSinc>1</indSinc>
 *     <NFe>...</NFe>          <!-- XML assinado da nota -->
 *   </enviNFe>
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
    xmlNfeAssinada +
    `</enviNFe>`

  const envelope = montarEnvelopeSoap(enviNFe, wsdl)
  return postSoap(cfg, url, envelope, wsdl)
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

  return postSoap(cfg, url, montarEnvelopeSoap(xml, wsdl), wsdl)
}

/** Consulta de nota já emitida pela chave de acesso. */
export async function consultarProtocolo(
  cfg: TransmissaoConfig,
  chaveAcesso: string,
): Promise<SoapResposta> {
  const url = resolverUrl(cfg, 'consultaProtocolo')
  const wsdl = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4'

  const xml =
    `<consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<tpAmb>${cfg.ambiente}</tpAmb>` +
    `<xServ>CONSULTAR</xServ>` +
    `<chNFe>${chaveAcesso}</chNFe>` +
    `</consSitNFe>`

  return postSoap(cfg, url, montarEnvelopeSoap(xml, wsdl), wsdl)
}
