/**
 * Apenas troca ambiente_sefaz da NORTE-LAB SOBRAL de 2 (homol) → 1 (produção).
 * NÃO emite nada, NÃO transmite à SEFAZ. Só uma alteração no banco.
 */
import { supabase } from '../src/services/supabase.js'

const EMPRESA_ID = 'fb832331-d586-4536-8ef6-1b8469f4fe40'

async function main() {
  const { data: emp } = await supabase
    .from('empresas')
    .select('nome, ambiente_sefaz, csc_id_prod, csc_token_prod')
    .eq('id', EMPRESA_ID)
    .maybeSingle()
  if (!emp) { console.error('❌ Empresa não encontrada'); process.exit(1) }

  console.log('🏢 Empresa:', emp.nome)
  console.log('   Ambiente atual:', emp.ambiente_sefaz === 1 ? '🔴 PRODUÇÃO' : '🟡 HOMOLOGAÇÃO')
  if (!emp.csc_id_prod || !emp.csc_token_prod) {
    console.error('\n❌ CSC produção NÃO cadastrado — abortando')
    console.error('   Cadastra primeiro com cadastrar-csc-prod.ts')
    process.exit(1)
  }

  if (emp.ambiente_sefaz === 1) {
    console.log('\n✅ Já está em produção — nada a fazer.')
    return
  }

  console.log('\n🔁 Mudando ambiente_sefaz: 2 (HOMOL) → 1 (PRODUÇÃO)...')
  const { error } = await supabase
    .from('empresas')
    .update({ ambiente_sefaz: 1, updated_at: new Date().toISOString() })
    .eq('id', EMPRESA_ID)
  if (error) { console.error('❌', error.message); process.exit(1) }

  const { data: depois } = await supabase
    .from('empresas').select('ambiente_sefaz').eq('id', EMPRESA_ID).maybeSingle()
  console.log('\n✅ AMBIENTE TROCADO:', depois?.ambiente_sefaz === 1 ? '🔴 PRODUÇÃO' : 'falhou')
  console.log('\n⚠️  A PARTIR DESSE MOMENTO, qualquer NFC-e/NF-e emitida pela')
  console.log('   NORTE-LAB SOBRAL será NOTA FISCAL REAL com valor fiscal.')
  console.log('\n   Pra emitir 1 NFC-e teste de R$ 1 e validar, rode:')
  console.log('   npx tsx scripts/emitir-nfce-teste.ts')
  console.log('\n   Pra reverter pra homologação:')
  console.log('   UPDATE empresas SET ambiente_sefaz = 2 WHERE id = \'' + EMPRESA_ID + '\'')
}
void main()
