/**
 * Emite uma NFC-e de teste em ambiente de homologação SVRS-CE.
 *
 * Pega 1 produto real da empresa NORTE-LAB SOBRAL (já com ficha fiscal),
 * monta a NFC-e como consumidor avulso pagando em dinheiro, e transmite.
 *
 * Mostra cStat + protocolo + chave + URL do QR Code no final.
 */

import { supabase } from '../src/services/supabase.js'
import { emitirNfe } from '../src/services/nfe/orquestrador.js'

const EMPRESA_ID = 'fb832331-d586-4536-8ef6-1b8469f4fe40' // NORTE-LAB SOBRAL

async function main() {
  // 1) Pega a empresa pra confirmar dados
  const { data: emp } = await supabase
    .from('empresas')
    .select('id, nome, razao_social, cnpj, ie, crt, ambiente_sefaz, csc_id_homol, csc_token_homol')
    .eq('id', EMPRESA_ID)
    .maybeSingle()
  if (!emp) { console.error('Empresa não encontrada'); process.exit(1) }
  console.log('🏢 Empresa:', emp.nome || emp.razao_social, `(CRT=${emp.crt}, ambiente=${emp.ambiente_sefaz === 1 ? 'PROD' : 'HOMOL'})`)
  if (!emp.csc_id_homol || !emp.csc_token_homol) {
    console.error('❌ CSC de homologação não cadastrado na empresa')
    process.exit(1)
  }

  // 2) Pega natureza de operação ativa
  const { data: nat } = await supabase
    .from('naturezas_operacao')
    .select('id, nome, natureza, cfop_padrao')
    .eq('empresa_id', EMPRESA_ID)
    .eq('ativo', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!nat) { console.error('❌ Nenhuma natureza de operação ativa'); process.exit(1) }
  console.log('📌 Natureza:', nat.nome || nat.natureza, `(CFOP padrão ${nat.cfop_padrao})`)

  // 3) Pega 1 produto qualquer com fiscal preenchido
  const { data: produto } = await supabase
    .from('produtos')
    .select('id, descricao, valor_unitario, ncm, cst_icms, aliquota_icms, cfop_venda_dentro')
    .eq('empresa_id', EMPRESA_ID)
    .eq('ativo', true)
    .not('cst_icms', 'is', null)
    .gt('valor_unitario', 0)
    .order('descricao')
    .limit(1)
    .maybeSingle()
  if (!produto) { console.error('❌ Nenhum produto válido'); process.exit(1) }
  console.log('🛒 Produto:', produto.descricao, `— R$ ${Number(produto.valor_unitario).toFixed(2)}`)
  console.log('   NCM:', produto.ncm, '| CST:', produto.cst_icms, '| ICMS%:', produto.aliquota_icms, '| CFOP:', produto.cfop_venda_dentro)

  const valor = Number(produto.valor_unitario)

  // 4) Emitir NFC-e
  console.log('\n🚀 Transmitindo NFC-e ao SVRS-CE (homologação)...\n')
  const inicio = Date.now()
  try {
    const result = await emitirNfe({
      empresaId: EMPRESA_ID,
      modelo: 65, // NFC-e
      naturezaOperacaoId: nat.id,
      itens: [
        {
          produtoId: produto.id,
          quantidade: 1,
          valorUnitario: valor,
        },
      ],
      pagamento: {
        forma: '01', // dinheiro
        valor,
      },
      tipoDocumento: 'venda',
    })

    const tempo = ((Date.now() - inicio) / 1000).toFixed(1)
    console.log(`⏱️  Tempo: ${tempo}s\n`)
    console.log('═'.repeat(70))
    console.log('RESULTADO DA EMISSÃO')
    console.log('═'.repeat(70))
    console.log('Status:        ', result.status.toUpperCase())
    console.log('Modelo:        ', result.modelo, '(NFC-e)')
    console.log('Ambiente:      ', result.ambiente === 1 ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO')
    console.log('Série/Número:  ', `${result.serie}/${result.numero}`)
    if (result.chaveAcesso) console.log('Chave de acesso:', result.chaveAcesso)
    if (result.protocolo) console.log('Protocolo SEFAZ:', result.protocolo)
    if (result.qrCode) console.log('QR Code:       ', result.qrCode)
    if (result.urlConsulta) console.log('URL consulta:  ', result.urlConsulta)
    if (result.erros?.length) {
      console.log('\n⚠️  Erros/avisos da SEFAZ:')
      for (const e of result.erros) {
        console.log(`   ${e.codigo}: ${e.descricao}`)
      }
    }
    console.log('═'.repeat(70))

    if (result.status === 'autorizada') {
      console.log('\n🎉 NFC-e AUTORIZADA com sucesso!')
      console.log(`   ID interno (banco): ${result.notaId}`)
      console.log('\n💡 Pra ver a DANFE, abre o admin → /nfe → Comprovantes nessa nota.')
    } else {
      console.log('\n⚠️  Não autorizada — veja erros acima.')
    }
  } catch (e) {
    console.error('\n❌ Falha fatal:', (e as Error).message)
    if ((e as Error).stack) console.error((e as Error).stack)
    process.exit(1)
  }
}

void main()
