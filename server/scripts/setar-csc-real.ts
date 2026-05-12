/**
 * Cadastra o par CSC REAL da NORTE-LAB SOBRAL na empresa.
 *
 * Dados extraídos do portal nfce.sefaz.ce.gov.br (Consultar CSC):
 *   - Id Token: 1
 *   - CSC (Token): C5041DB9-6FD1-4492-8DBA-6F38195C4A99
 *   - Ambiente: PRODUÇÃO
 *
 * Como a migration 014 ainda não foi aplicada, salvamos nos campos legados
 * csc_id/csc_token. Quando user gerar o CSC de homologação no portal, troca
 * por aquele.
 */

import { supabase } from '../src/services/supabase.js'

const CNPJ_SOBRAL = '21568629000102'
const CSC_ID_REAL = '1'
const CSC_TOKEN_REAL = 'C5041DB9-6FD1-4492-8DBA-6F38195C4A99'

async function main() {
  const { data: emp, error: selErr } = await supabase
    .from('empresas')
    .select('id, nome')
    .eq('cnpj', CNPJ_SOBRAL)
    .maybeSingle()
  if (selErr) throw new Error(selErr.message)
  if (!emp) throw new Error('Sobral não encontrada')

  const { error: updErr } = await supabase
    .from('empresas')
    .update({
      csc_id: CSC_ID_REAL,
      csc_token: CSC_TOKEN_REAL,
    })
    .eq('id', emp.id)
  if (updErr) throw new Error(updErr.message)

  console.log(`✓ CSC real cadastrado na empresa ${emp.id} (${emp.nome})`)
  console.log(`   Id Token: ${CSC_ID_REAL}`)
  console.log(`   CSC:      ${CSC_TOKEN_REAL}`)
  console.log(`   Ambiente: PRODUÇÃO`)
  console.log()
  console.log(`⚠️  Esse é o CSC de PRODUÇÃO. Pra emitir nota fiscal de verdade`)
  console.log(`   (com valor fiscal real), troque empresa.ambiente_sefaz pra 1.`)
  console.log(`   Pra testes (sem valor fiscal), pegue o CSC de HOMOLOGAÇÃO no`)
  console.log(`   portal: nfce.sefaz.ce.gov.br → "Ambiente de Testes".`)
}

main().catch((e) => {
  console.error('Falhou:', (e as Error).message)
  process.exit(1)
})
