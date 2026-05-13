/**
 * Cadastra o CSC REAL DE HOMOLOGAÇÃO da NORTE-LAB SOBRAL.
 *
 * Gerado em 11/05/2026 no portal nfce.sefaz.ce.gov.br → Credenciar Empresa
 * → aba CSC NFC-e em ambiente de testes.
 *
 *   Id Token: 1
 *   CSC: 6752072A-EEEB-4A5B-B99A-B348EB692801
 *   Ambiente: HOMOLOGAÇÃO
 */

import { supabase } from '../src/services/supabase.js'

const CNPJ_SOBRAL = '21568629000102'
const CSC_ID_HOMOL = '1'
const CSC_TOKEN_HOMOL = '6752072A-EEEB-4A5B-B99A-B348EB692801'

async function main() {
  const { data: emp, error: selErr } = await supabase
    .from('empresas')
    .select('id, nome, ambiente_sefaz')
    .eq('cnpj', CNPJ_SOBRAL)
    .maybeSingle()
  if (selErr) throw new Error(selErr.message)
  if (!emp) throw new Error('Sobral não encontrada')

  // Sobrescreve csc_id/csc_token (legados) com os de homologação
  // (a migration 014 que separaria homol/prod ainda não foi aplicada)
  const { error: updErr } = await supabase
    .from('empresas')
    .update({
      csc_id: CSC_ID_HOMOL,
      csc_token: CSC_TOKEN_HOMOL,
    })
    .eq('id', emp.id)
  if (updErr) throw new Error(updErr.message)

  console.log(`✓ CSC homol cadastrado na empresa ${emp.id} (${emp.nome})`)
  console.log(`   Id Token:     ${CSC_ID_HOMOL}`)
  console.log(`   CSC:          ${CSC_TOKEN_HOMOL}`)
  console.log(`   Ambiente DB:  ${emp.ambiente_sefaz} (${emp.ambiente_sefaz === 2 ? 'homologação ✓' : 'produção'})`)
}

main().catch((e) => {
  console.error('Falhou:', (e as Error).message)
  process.exit(1)
})
