import { supabase } from '../src/services/supabase.js'

const r = await supabase
  .from('notas_fiscais')
  .select('id, status, created_at')
  .order('created_at', { ascending: false })
  .limit(3)

console.log('Notas mais recentes:')
for (const n of r.data || []) {
  console.log(`  ${n.id} | status=${JSON.stringify(n.status)} | ${n.created_at}`)
}

const r2 = await supabase
  .from('notas_fiscais')
  .select('id')
  .eq('status', 'autorizada')

console.log('Notas com status=autorizada:', r2.data?.length ?? 0)
if (r2.error) console.log('Erro:', r2.error.message)
