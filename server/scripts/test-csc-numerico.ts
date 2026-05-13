/**
 * Testa CSC com ID numérico ('000001') em vez do UUID do portal.
 * Mantém o Token que o user passou — pode estar errado, mas a SEFAZ vai
 * primeiro validar schema (formato do QR Code) antes de validar o hash do Token.
 */

import { supabase } from '../src/services/supabase.js'

const CNPJ_SOBRAL = '21568629000102'
const NOVO_CSC_ID = '000001'

async function main() {
  const { data: emp } = await supabase
    .from('empresas')
    .select('id, nome')
    .eq('cnpj', CNPJ_SOBRAL)
    .maybeSingle()
  if (!emp) throw new Error('Sobral não encontrada')

  await supabase
    .from('empresas')
    .update({ csc_id: NOVO_CSC_ID })
    .eq('id', emp.id)

  console.log(`✓ CSC ID trocado pra "${NOVO_CSC_ID}" — vai usar o Token já gravado`)
}

main().catch((e) => {
  console.error('Falhou:', (e as Error).message)
  process.exit(1)
})
