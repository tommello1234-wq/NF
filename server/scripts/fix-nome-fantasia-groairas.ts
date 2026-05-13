/**
 * One-off: restaura o nome fantasia "Ótica Princesa Groaíras" na empresa de Groaíras
 * (que foi sobrescrito pela razão social RENAYRA M X OTICA LTDA quando o script
 * cadastrar-empresas-pfx rodou).
 */

import { supabase } from '../src/services/supabase.js'

async function main() {
  const { data, error } = await supabase
    .from('empresas')
    .update({ nome: 'Ótica Princesa Groaíras' })
    .eq('cnpj', '09545371000123')
    .select('id, nome, razao_social')
    .single()
  if (error) throw new Error(error.message)
  console.log(`✓ Atualizado: ${data?.id}`)
  console.log(`   Nome fantasia:  ${data?.nome}`)
  console.log(`   Razão social:   ${data?.razao_social}`)
}

main().catch((e) => {
  console.error('Falhou:', (e as Error).message)
  process.exit(1)
})
