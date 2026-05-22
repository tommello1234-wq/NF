/**
 * Cadastra natureza de operação + 1 produto óculos pra Sobral, pra destravar
 * o spike-nfe.
 */

import { supabase } from '../src/services/supabase.js'

const CNPJ_SOBRAL = '21568629000102'

async function main() {
  const { data: emp } = await supabase
    .from('empresas')
    .select('id, nome')
    .eq('cnpj', CNPJ_SOBRAL)
    .maybeSingle()
  if (!emp) throw new Error('Sobral não encontrada')
  console.log(`Empresa: ${emp.id} (${emp.nome})`)

  // 1. Natureza de operação
  const naturezaPayload = {
    empresa_id: emp.id,
    nome: 'Venda dentro do CE',
    natureza: 'VENDA DE MERCADORIA',
    tipo_operacao: 'saida',
    finalidade: 'normal',
    cfop_padrao: '5102',
    consumidor_final: true,
    indicador_presenca: 1,
    modalidade_frete: 9,
    ativo: true,
  }
  const { data: nat, error: natErr } = await supabase
    .from('naturezas_operacao')
    .insert(naturezaPayload)
    .select('id')
    .single()
  if (natErr) throw new Error(`natureza: ${natErr.message}`)
  console.log(`✓ Natureza criada: ${nat?.id}`)

  // 2. Produto óculos (campos básicos — sem gtin/cst_pis que dependem da 013)
  const produtoBasico = {
    empresa_id: emp.id,
    descricao: 'OCULOS DE GRAU TESTE - ARMACAO PLASTICA',
    codigo_interno: 'OCULOS-TESTE-001',
    ncm: '90031100',
    cfop: '5102',
    unidade: 'PC',
    valor_unitario: 250.0,
    origem: 0,
    cst_csosn: '102',
    aliquota_icms: 0,
    aliquota_pis: 0,
    aliquota_cofins: 0,
    tipo: 'produto',
    ativo: true,
  }
  // Tenta primeiro com campos da 013 — se falhar, cai pro básico
  let { data: prod, error: prodErr } = await supabase
    .from('produtos')
    .insert({
      ...produtoBasico,
      cst_pis: '49',
      cst_cofins: '49',
      gtin: 'SEM GTIN',
      estoque: 100,
    })
    .select('id')
    .single()
  if (prodErr) {
    console.log(`  ⚠️ Falha com campos novos — caindo pro produto básico (migration 013 não aplicada).`)
    const fb = await supabase.from('produtos').insert(produtoBasico).select('id').single()
    if (fb.error) throw new Error(`produto: ${fb.error.message}`)
    prod = fb.data
  }
  console.log(`✓ Produto criado: ${prod?.id}`)

  console.log()
  console.log(`Pronto pra rodar:`)
  console.log(`   npm run spike:nfe -- 65    # NFC-e em homologação`)
  console.log(`   npm run spike:nfe -- 55    # NF-e em homologação`)
}

main().catch((e) => {
  console.error('Falhou:', (e as Error).message)
  process.exit(1)
})
