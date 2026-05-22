import { supabase } from '../src/services/supabase.js'

const { data } = await supabase
  .from('empresas')
  .select('id, nome, razao_social, cnpj, endereco_cidade, ambiente_sefaz')
  .order('created_at')

console.log(`Total: ${data?.length ?? 0} empresa(s)`)
for (const e of data || []) {
  console.log(`  ${e.id}`)
  console.log(`    nome:        ${e.nome}`)
  console.log(`    razao:       ${e.razao_social}`)
  console.log(`    cnpj:        ${e.cnpj}`)
  console.log(`    cidade:      ${e.endereco_cidade}`)
  console.log(`    ambiente:    ${e.ambiente_sefaz}`)
  console.log()
}
