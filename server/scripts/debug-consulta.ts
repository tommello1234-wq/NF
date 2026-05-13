import { supabase } from '../src/services/supabase.js'
import { carregarCertificado } from '../src/services/certificado.js'
import { consultarProtocolo, parseSoapResposta } from '../src/services/nfe/transmissor.js'

const CHAVE = '23260521568629000102650010000000311657895270'
const CNPJ = '21568629000102'

const { data: emp } = await supabase
  .from('empresas')
  .select('id, ambiente_sefaz')
  .eq('cnpj', CNPJ)
  .maybeSingle()
if (!emp) throw new Error('empresa não encontrada')

const cert = await carregarCertificado(emp.id)
if (!cert) throw new Error('cert não encontrado')

const res = await consultarProtocolo(
  {
    modelo: 65,
    ambiente: 2,
    pfxBuffer: cert.pfxBuffer,
    pfxSenha: cert.senha,
  },
  CHAVE,
)

console.log(`HTTP status: ${res.status}`)
console.log(`Content-Type: ${res.contentType}`)
console.log()
console.log('=== Resposta crua (primeiros 2000 chars) ===')
console.log(res.body.slice(0, 2000))
console.log()
console.log('=== Resposta parseada ===')
console.log(JSON.stringify(parseSoapResposta(res.body), null, 2))
