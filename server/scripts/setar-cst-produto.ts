/**
 * Troca o cst_csosn dos produtos da Sobral pra um CST válido em Regime Normal.
 * Default: '00' (Tributada Integralmente).
 *
 * Uso: npm run setar:cst -- 00
 */

import { supabase } from '../src/services/supabase.js'

const CNPJ_SOBRAL = '21568629000102'
const novoCst = process.argv[2] || '00'

async function main() {
  const { data: emp } = await supabase
    .from('empresas')
    .select('id')
    .eq('cnpj', CNPJ_SOBRAL)
    .maybeSingle()
  if (!emp) throw new Error('Sobral não encontrada')

  const { data, error } = await supabase
    .from('produtos')
    .update({ cst_csosn: novoCst, aliquota_icms: 18 })
    .eq('empresa_id', emp.id)
    .select('id, descricao')
  if (error) throw new Error(error.message)

  console.log(`✓ Produtos atualizados para CST=${novoCst} (Regime Normal):`)
  for (const p of data || []) console.log(`   ${p.descricao}`)
}

main().catch((e) => {
  console.error('Falhou:', (e as Error).message)
  process.exit(1)
})
