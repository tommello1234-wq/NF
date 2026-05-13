/**
 * Aplica a "ficha fiscal padrão da Princesa Otica" em todos os produtos de uma
 * empresa. Conforme respostas do contador (Augusto):
 *
 *   - Regime Normal (CRT=3)
 *   - ICMS: CST 00 (tributado integralmente), alíquota 20% (CE)
 *   - PIS:    CST 01 (tributada não-cumulativa, Lucro Real), alíquota 1,65%
 *   - COFINS: CST 01 (tributada não-cumulativa, Lucro Real), alíquota 7,60%
 *   - IPI:    CST 49 (outras saídas)
 *   - CFOP venda dentro do estado: 5102
 *   - CFOP venda fora do estado:   6102
 *
 * Reforma Tributária (CBS/IBS) NÃO entra agora — leiaute novo será implementado
 * depois (cClassTrib 000001, CBS 0,9%, IBS 0,1% pra 2026).
 *
 * Uso:
 *   npm run db:fiscal-padrao -w server -- <empresa_id>
 *   npm run db:fiscal-padrao -w server -- todas
 *
 * Por padrão SÓ aplica em produtos com campos fiscais vazios (não sobrescreve
 * o que já estiver preenchido).  Use --force pra sobrescrever tudo.
 */

import { supabase } from '../src/services/supabase.js'

const FICHA_FISCAL_PADRAO = {
  origem: 0,                          // Nacional
  cst_icms: '00',                     // Tributado integralmente (Regime Normal)
  cst_csosn: null,                    // não usa, é regime normal
  csosn: null,
  aliquota_icms: 20,                  // 20% — CE
  aliquota_credito_icms: null,        // sem crédito presumido
  percentual_base_calculo_icms: 100,  // sem redução
  cst_pis: '01',                      // tributada
  aliquota_pis: 1.65,                 // não-cumulativo
  cst_cofins: '01',
  aliquota_cofins: 7.60,
  // IPI: ótica revendedora NÃO é contribuinte → não destaca IPI no XML.
  // O contador falou CST 49 mas tecnicamente CST 49 é "outras ENTRADAS"
  // (não pode ir em saída). Mantemos null pra omitir o grupo inteiro.
  cst_ipi: null,
  aliquota_ipi: 0,
  cfop: '5102',                       // legado
  cfop_venda_dentro: '5102',
  cfop_venda_fora: '6102',
  cfop_devolucao_dentro: '5202',
  cfop_devolucao_fora: '6202',
  cfop_compra_dentro: '1102',
  cfop_compra_fora: '2102',
}

const FORCE = process.argv.includes('--force')
// Filtra argumentos: ignora paths (node binary, tsx, script.ts) e flags
const ALVO =
  process.argv
    .slice(2)
    .find((a) => !a.startsWith('-') && !a.includes('\\') && !a.includes('/') && !a.endsWith('.ts') && !a.endsWith('.js')) || ''

async function main() {
  if (!ALVO) {
    console.error('Uso: npm run db:fiscal-padrao -w server -- <empresa_id|todas> [--force]')
    process.exit(1)
  }

  // Lista empresas alvo
  const empQ = supabase.from('empresas').select('id, nome, razao_social, crt')
  const { data: empresas, error: empErr } =
    ALVO === 'todas' ? await empQ : await empQ.eq('id', ALVO)
  if (empErr) {
    console.error('Erro ao buscar empresas:', empErr.message)
    process.exit(1)
  }
  if (!empresas?.length) {
    console.error('Nenhuma empresa encontrada')
    process.exit(1)
  }

  console.log(`\n📋 Aplicando ficha fiscal padrão Princesa Otica em ${empresas.length} empresa(s)`)
  console.log(`   ${FORCE ? '⚠️  --force ativo: sobrescreve campos já preenchidos' : 'Modo normal: só preenche campos vazios'}\n`)

  for (const emp of empresas) {
    console.log(`▶  ${emp.nome || emp.razao_social} (CRT=${emp.crt || '?'})`)

    // Conta total
    const { count } = await supabase
      .from('produtos')
      .select('*', { count: 'exact', head: true })
      .eq('empresa_id', emp.id)
    if (!count) { console.log('   (0 produtos)'); continue }

    // Pagina e aplica em chunks
    const PAGE = 1000
    let offset = 0
    let atualizados = 0
    let pulados = 0

    while (offset < (count || 0) + PAGE) {
      const { data: lote } = await supabase
        .from('produtos')
        .select('id, descricao, cst_icms, aliquota_icms, cst_pis, cst_cofins, cst_ipi, cfop_venda_dentro')
        .eq('empresa_id', emp.id)
        .order('descricao')
        .range(offset, offset + PAGE - 1)
      if (!lote || lote.length === 0) break

      // Filtra: se --force aplica em todos; senão só os "vazios"
      const alvos = FORCE
        ? lote
        : lote.filter((p) =>
            !p.cst_icms && !p.aliquota_icms && !p.cst_pis && !p.cst_cofins && !p.cst_ipi && !p.cfop_venda_dentro,
          )

      if (alvos.length === 0) {
        pulados += lote.length
        offset += PAGE
        continue
      }

      const ids = alvos.map((p) => p.id)
      // UPDATE em lotes (PostgREST limita URL — quebra em 500)
      for (let i = 0; i < ids.length; i += 500) {
        const slice = ids.slice(i, i + 500)
        const { error } = await supabase
          .from('produtos')
          .update({ ...FICHA_FISCAL_PADRAO, updated_at: new Date().toISOString() })
          .in('id', slice)
        if (error) {
          console.error(`   ❌ Erro em chunk: ${error.message}`)
        } else {
          atualizados += slice.length
        }
      }
      pulados += lote.length - alvos.length
      offset += PAGE
    }

    console.log(`   ✅ ${atualizados} atualizado(s), ${pulados} pulado(s) (já tinham fiscal preenchido)`)
  }

  console.log('\n🎉 Concluído.')
}

void main().catch((e) => {
  console.error('Erro fatal:', e)
  process.exit(1)
})
