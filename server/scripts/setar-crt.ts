/**
 * Tenta vários CRTs até a SEFAZ aceitar. SEFAZ-CE tem o registro próprio do
 * regime tributário e nosso XML precisa bater com ele.
 *
 * Uso: npm run setar:crt -- 3
 *      npm run setar:crt -- 2
 *      npm run setar:crt -- 1
 */

import { supabase } from '../src/services/supabase.js'

const CNPJ_SOBRAL = '21568629000102'
const novoCrt = Number(process.argv[2] || '3') as 1 | 2 | 3 | 4

async function main() {
  if (![1, 2, 3, 4].includes(novoCrt)) throw new Error('CRT deve ser 1, 2, 3 ou 4')
  const { data: emp } = await supabase
    .from('empresas')
    .select('id, nome, crt')
    .eq('cnpj', CNPJ_SOBRAL)
    .maybeSingle()
  if (!emp) throw new Error('Sobral não encontrada')

  const { error } = await supabase
    .from('empresas')
    .update({ crt: novoCrt })
    .eq('id', emp.id)
  if (error) throw new Error(error.message)

  const label = { 1: 'Simples Nacional', 2: 'Simples Nacional sublimite', 3: 'Regime Normal', 4: 'MEI' }[novoCrt]
  console.log(`✓ CRT atualizado: ${emp.crt} → ${novoCrt} (${label})`)
}

main().catch((e) => {
  console.error('Falhou:', (e as Error).message)
  process.exit(1)
})
