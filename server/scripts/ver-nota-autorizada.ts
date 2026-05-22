import { supabase } from '../src/services/supabase.js'

const { data } = await supabase
  .from('notas_fiscais')
  .select('*')
  .eq('status', 'autorizada')
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle()

if (!data) {
  console.log('Nenhuma nota autorizada no banco.')
  process.exit(0)
}

console.log('=== Última nota autorizada ===')
console.log(`id:             ${data.id}`)
console.log(`tipo:           ${data.tipo}`)
console.log(`status:         ${data.status}`)
console.log(`chave_acesso:   ${data.chave_acesso}`)
console.log(`protocolo:      ${data.protocolo}`)
console.log(`serie/numero:   ${data.serie}/${data.numero}`)
console.log(`valor_total:    R$ ${data.valor_total}`)
console.log(`criada em:      ${data.created_at}`)
