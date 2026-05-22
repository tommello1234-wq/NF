/**
 * Emite 1 NFC-e teste de R$ 1,00 em PRODUÇÃO.
 * Antes de emitir, valida que a empresa está mesmo em ambiente=1.
 */
import { supabase } from '../src/services/supabase.js'
import { emitirNfe } from '../src/services/nfe/orquestrador.js'

const EMPRESA_ID = 'fb832331-d586-4536-8ef6-1b8469f4fe40'
const VALOR = 1.00

async function main() {
  // 1) Pre-flight: confirmar produção
  const { data: emp } = await supabase
    .from('empresas')
    .select('nome, ambiente_sefaz, csc_id_prod, csc_token_prod')
    .eq('id', EMPRESA_ID)
    .maybeSingle()
  if (!emp) { console.error('❌ Empresa não encontrada'); process.exit(1) }
  console.log('🏢 Empresa:', emp.nome)
  console.log('   Ambiente:', emp.ambiente_sefaz === 1 ? '🔴 PRODUÇÃO' : '🟡 HOMOLOGAÇÃO')

  if (emp.ambiente_sefaz !== 1) {
    console.error('\n❌ Empresa NÃO está em produção (ambiente_sefaz=' + emp.ambiente_sefaz + ')')
    console.error('   Rode primeiro o UPDATE pra trocar ambiente_sefaz pra 1')
    process.exit(1)
  }
  if (!emp.csc_id_prod || !emp.csc_token_prod) {
    console.error('\n❌ CSC produção não cadastrado')
    process.exit(1)
  }

  // 2) Natureza
  const { data: nat } = await supabase
    .from('naturezas_operacao')
    .select('id, nome, natureza')
    .eq('empresa_id', EMPRESA_ID)
    .eq('ativo', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!nat) { console.error('❌ Sem natureza ativa'); process.exit(1) }
  console.log('📌 Natureza:', nat.nome || nat.natureza)

  // 3) Produto
  const { data: produto } = await supabase
    .from('produtos')
    .select('id, descricao, ncm')
    .eq('empresa_id', EMPRESA_ID)
    .eq('ativo', true)
    .not('cst_icms', 'is', null)
    .order('descricao')
    .limit(1)
    .maybeSingle()
  if (!produto) { console.error('❌ Sem produto válido'); process.exit(1) }
  console.log('🛒 Produto:', produto.descricao, `(NCM ${produto.ncm})`)
  console.log('💰 Valor:', `R$ ${VALOR.toFixed(2)}`)

  // 4) Emite
  console.log('\n🚀 EMITINDO NFC-e EM PRODUÇÃO no SVRS-CE...')
  const inicio = Date.now()
  const result = await emitirNfe({
    empresaId: EMPRESA_ID,
    modelo: 65,
    naturezaOperacaoId: nat.id,
    itens: [{
      produtoId: produto.id,
      quantidade: 1,
      valorUnitario: VALOR,
    }],
    pagamento: { forma: '01', valor: VALOR },
    tipoDocumento: 'venda',
  })
  const tempo = ((Date.now() - inicio) / 1000).toFixed(1)

  console.log(`\n⏱️  Tempo: ${tempo}s`)
  console.log('═'.repeat(70))
  console.log('Status:        ', result.status.toUpperCase())
  console.log('Ambiente:      ', result.ambiente === 1 ? '🔴 PRODUÇÃO (REAL!)' : 'HOMOL')
  console.log('Modelo:        ', result.modelo, '(NFC-e)')
  console.log('Série/Número:  ', `${result.serie}/${result.numero}`)
  if (result.chaveAcesso) console.log('Chave acesso:  ', result.chaveAcesso)
  if (result.protocolo)   console.log('Protocolo:     ', result.protocolo)
  if (result.qrCode)      console.log('QR Code:       ', result.qrCode)
  if (result.urlConsulta) console.log('URL consulta:  ', result.urlConsulta)
  if (result.erros?.length) {
    console.log('\n⚠️  Erros SEFAZ:')
    for (const e of result.erros) console.log(`   ${e.codigo}: ${e.descricao}`)
  }
  console.log('═'.repeat(70))

  if (result.status === 'autorizada') {
    console.log('\n🎉 NFC-e PRODUÇÃO AUTORIZADA!')
    console.log('   Tributos reais (R$ 1,00 venda):')
    console.log('     vICMS  (20%)   = R$ 0.20')
    console.log('     vPIS   (1.65%) = R$ 0.02')
    console.log('     vCOFINS (7.6%) = R$ 0.08')
    console.log('   Total tributos: ~R$ 0,30')
    console.log(`\n💡 ID interno: ${result.notaId}`)
    console.log('   Pra cancelar (≤24h após autorização):')
    console.log('   no admin → /nfe → linha dessa nota → Comprovantes → Cancelamento')
  }
}
void main().catch((e) => { console.error('Falha fatal:', e); process.exit(1) })
