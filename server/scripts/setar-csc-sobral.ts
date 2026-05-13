/**
 * Seta o par CSC homologação na empresa NORTE-LAB SOBRAL.
 * IDs e Token vindos da conversa.
 *
 * Resiliente à migration 014: se as colunas csc_id_homol/csc_token_homol não
 * existirem, cai pros campos legados csc_id/csc_token (migration 001).
 */

import { supabase } from '../src/services/supabase.js'

const CNPJ_SOBRAL = '21568629000102'

const CSC_ID_HOMOL = 'C5041DB9-6FD1-4492-8DBA-6F38195C4A99'
const CSC_TOKEN_HOMOL = '0bfa1960a70d8e9353c4a7af61ef50245249464ccef0088cdcd74325b6eef4df'

async function main() {
  // Seleciona só `id` e `nome` que existem desde a migration 001.
  const { data: emp, error: selErr } = await supabase
    .from('empresas')
    .select('id, nome')
    .eq('cnpj', CNPJ_SOBRAL)
    .maybeSingle()
  if (selErr) throw new Error(`select: ${selErr.message}`)
  if (!emp) throw new Error(`Empresa Sobral (CNPJ ${CNPJ_SOBRAL}) não encontrada`)

  // Tenta atualizar os campos NOVOS (migration 014)
  let { error: updErr } = await supabase
    .from('empresas')
    .update({
      csc_id_homol: CSC_ID_HOMOL,
      csc_token_homol: CSC_TOKEN_HOMOL,
    })
    .eq('id', emp.id)

  if (updErr) {
    console.log(`  ⚠️ Campos csc_id_homol/csc_token_homol não existem (migration 014 não aplicada).`)
    console.log(`     Caindo pros campos legados csc_id/csc_token (migration 001)…`)
    const fb = await supabase
      .from('empresas')
      .update({ csc_id: CSC_ID_HOMOL, csc_token: CSC_TOKEN_HOMOL })
      .eq('id', emp.id)
    if (fb.error) throw new Error(`update legado: ${fb.error.message}`)
    console.log(`  ✓ Persistido em csc_id/csc_token (legado).`)
  }

  console.log(`✓ CSC homol cadastrado na empresa ${emp.id} (${emp.nome})`)
  console.log(`   CSC ID:     ${CSC_ID_HOMOL}`)
  console.log(`   CSC Token:  ${CSC_TOKEN_HOMOL.slice(0, 10)}…${CSC_TOKEN_HOMOL.slice(-6)}  (${CSC_TOKEN_HOMOL.length} chars)`)
  console.log()
  console.log(`O orquestrador (resolverCsc) usa o legado como fallback automaticamente —`)
  console.log(`então NFC-e em ambiente=2 vai pegar esse par mesmo sem a 014 aplicada.`)
}

main().catch((e) => {
  console.error('Falhou:', (e as Error).message)
  process.exit(1)
})
