/**
 * Troca o Token CSC pra um fake completamente aleatório,
 * pra ver se o erro de schema muda.
 */

import { supabase } from '../src/services/supabase.js'

const CNPJ_SOBRAL = '21568629000102'

async function main() {
  const { data: emp } = await supabase
    .from('empresas')
    .select('id')
    .eq('cnpj', CNPJ_SOBRAL)
    .maybeSingle()
  if (!emp) throw new Error('Sobral não encontrada')

  await supabase
    .from('empresas')
    .update({
      csc_id: '000001',
      csc_token: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCD',
    })
    .eq('id', emp.id)

  console.log('✓ CSC trocado pra fake (test apenas)')
}

main().catch((e) => {
  console.error('Falhou:', (e as Error).message)
  process.exit(1)
})
