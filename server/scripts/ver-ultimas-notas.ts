import { supabase } from '../src/services/supabase.js'

const { data } = await supabase
  .from('notas_fiscais')
  .select('id, tipo, status, chave_acesso, protocolo, serie, numero, valor_total, created_at')
  .order('created_at', { ascending: false })
  .limit(5)

console.log(`=== Últimas ${data?.length ?? 0} notas ===`)
for (const n of data || []) {
  console.log(`${n.created_at.slice(0, 19)} | ${n.tipo} ${n.serie}/${n.numero} | ${n.status} | proto=${n.protocolo || '—'} | R$${n.valor_total}`)
  console.log(`  chave: ${n.chave_acesso}`)
}
