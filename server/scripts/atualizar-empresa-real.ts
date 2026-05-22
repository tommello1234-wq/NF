/**
 * Atualiza a empresa de teste do banco com os dados reais da Ótica Princesa
 * Groaíras (extraídos do comprovante de venda). Campos sem dado conhecido
 * ficam em branco/null pra serem preenchidos depois.
 *
 * Uso: npm run atualizar:empresa
 */

import { supabase } from '../src/services/supabase.js'

const DADOS_REAIS = {
  nome: 'Ótica Princesa Groaíras',
  razao_social: 'Ótica Princesa Groaíras',  // razão social completa não conhecida
  cnpj: '09545371000123',
  ie: null,                                  // não conhecida
  im: null,
  regime_tributario: 'simples',
  crt: 1,
  endereco_logradouro: 'Manoel Gerônimo',
  endereco_numero: '85',
  endereco_bairro: 'Centro',
  endereco_cidade: 'Groaíras',
  endereco_uf: 'CE',
  endereco_cep: null,
  endereco_codigo_ibge: '2304657',
  email: null,
  telefone: '8898383160',
  ambiente_sefaz: 2,
  uf_sefaz: 'CE',
  serie_nfe: 1,
  proximo_numero_nfe: 1,
  serie_nfce: 1,
  proximo_numero_nfce: 1,
  tipo_emissao_habilitado: 'teste_local',
  status_fiscal: 'incompleta',
}

async function main() {
  console.log('Procurando empresa de teste no banco…')

  // Tenta achar pela razão social do seed antigo, ou pelo CNPJ fake antigo
  const { data: existentes } = await supabase
    .from('empresas')
    .select('*')
    .or('razao_social.ilike.%TESTE%,cnpj.eq.12345678000199')
    .order('created_at', { ascending: true })

  if (!existentes || existentes.length === 0) {
    console.log('Nenhuma empresa de teste encontrada — criando nova.')
    const { data, error } = await supabase
      .from('empresas')
      .insert(DADOS_REAIS)
      .select('*')
      .single()
    if (error) throw new Error(error.message)
    console.log(`✓ Empresa criada: ${data.id} — ${data.razao_social}`)
    return
  }

  const empresa = existentes[0]
  console.log(`Encontrada: ${empresa.id} — antigo "${empresa.razao_social}" (CNPJ ${empresa.cnpj})`)

  const { error } = await supabase
    .from('empresas')
    .update(DADOS_REAIS)
    .eq('id', empresa.id)
  if (error) throw new Error(`Erro ao atualizar: ${error.message}`)

  console.log(`\n✓ Atualizado para:`)
  console.log(`   Nome:        ${DADOS_REAIS.nome}`)
  console.log(`   CNPJ:        ${DADOS_REAIS.cnpj}`)
  console.log(`   Endereço:    ${DADOS_REAIS.endereco_logradouro}, ${DADOS_REAIS.endereco_numero}`)
  console.log(`                ${DADOS_REAIS.endereco_bairro} - ${DADOS_REAIS.endereco_cidade}/${DADOS_REAIS.endereco_uf}`)
  console.log(`   Telefone:    ${DADOS_REAIS.telefone}`)
  console.log(`   IBGE:        ${DADOS_REAIS.endereco_codigo_ibge}`)
  console.log(`\n⚠️  Em branco (preencha em /empresas/${empresa.id} quando souber):`)
  console.log(`   Razão social completa (hoje = nome fantasia)`)
  console.log(`   Inscrição Estadual (IE)`)
  console.log(`   Inscrição Municipal (IM)`)
  console.log(`   CEP`)
  console.log(`   Email`)
  console.log(`   CSC homol (pra NFC-e)`)
  console.log(`   Certificado A1 (cert PFX com a senha correta)`)

  if (existentes.length > 1) {
    console.log(`\n⚠️  Outras ${existentes.length - 1} empresa(s) de teste encontradas no banco — não foram tocadas:`)
    for (const e of existentes.slice(1)) console.log(`     ${e.id} — ${e.razao_social} (${e.cnpj})`)
  }
}

main().catch((e) => {
  console.error('Falhou:', (e as Error).message || e)
  process.exit(1)
})
