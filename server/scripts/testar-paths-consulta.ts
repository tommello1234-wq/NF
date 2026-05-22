import https from 'node:https'
import { supabase } from '../src/services/supabase.js'
import { carregarCertificado } from '../src/services/certificado.js'

const CNPJ = '21568629000102'
const HOSTS = [
  'nfe-homologacao.svrs.rs.gov.br',
  'nfce-homologacao.svrs.rs.gov.br',
]
const PATHS = [
  '/ws/NfeConsulta/NFeConsultaProtocolo4.asmx',
  '/ws/NFeConsulta/NFeConsultaProtocolo4.asmx',
  '/ws/nfeconsulta/NFeConsultaProtocolo4.asmx',
  '/ws/NfeConsultaProtocolo/NFeConsultaProtocolo4.asmx',
  '/ws/NfeConsulta2/NFeConsultaProtocolo4.asmx',
  '/ws/NfeConsulta4/NFeConsultaProtocolo4.asmx',
  '/ws/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
  '/ws/nfeconsultaprotocolo4/NFeConsultaProtocolo4.asmx',
]

const { data: emp } = await supabase.from('empresas').select('id').eq('cnpj', CNPJ).maybeSingle()
const cert = await carregarCertificado(emp!.id)
if (!cert) throw new Error('no cert')

function tryPath(host: string, path: string) {
  return new Promise<number>((resolve) => {
    const req = https.request({
      method: 'GET',
      host, port: 443, path: path + '?wsdl',
      agent: new https.Agent({ pfx: cert!.pfxBuffer, passphrase: cert!.senha, rejectUnauthorized: false }),
      timeout: 5000,
    }, (res) => {
      resolve(res.statusCode || 0)
      res.resume()
    })
    req.on('error', () => resolve(-1))
    req.on('timeout', () => { req.destroy(); resolve(-2) })
    req.end()
  })
}

for (const host of HOSTS) {
  for (const path of PATHS) {
    const code = await tryPath(host, path)
    console.log(`${code === 200 ? '✓' : '✗'} [${code}] https://${host}${path}`)
  }
  console.log()
}
