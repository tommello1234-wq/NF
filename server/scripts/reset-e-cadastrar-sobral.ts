/**
 * 🚨 DESTRUTIVO 🚨
 *
 * Apaga TODOS os dados das tabelas relacionadas a NF-e/NFC-e/empresas no
 * Supabase + arquivos dos buckets `certificados` e `notas-xml`. Em seguida
 * cadastra SÓ a empresa NORTE LAB SOBRAL com os dados reais do PDF da
 * Luxottica + sobe o cert A1 dela.
 *
 * Uso (intencional, não rodar sem querer):
 *   npm run reset:sobral
 */

import { readFile } from 'node:fs/promises'
import { supabase } from '../src/services/supabase.js'
import { lerMetadadosPfx, salvarCertificado } from '../src/services/certificado.js'

const PFX_SOBRAL = 'C:\\Users\\felip\\Desktop\\Arquivos\\CERTIFICADOS DIGITAIS\\CERTIFICADO DE SOBRAL (2).pfx'
const SENHA_PFX = '123456'

// Dados de Sobral extraídos do "luxotica 2.pdf" (NORTE-LAB SOBRAL como destinatário).
// Endereço/IE/CEP são fiscais e podem ser usados como dados oficiais.
const DADOS_SOBRAL = {
  // razao_social vem do cert
  ie: '064528049',
  endereco_logradouro: 'TV do Xerez',
  endereco_numero: '137',
  endereco_complemento: 'BETHS',
  endereco_bairro: 'Centro',
  endereco_cidade: 'Sobral',
  endereco_uf: 'CE',
  endereco_cep: '62010270',
  endereco_codigo_ibge: '2312908',
  telefone: '88988438620',
}

// Ordem importante — child first pra respeitar FK
const TABELAS_NA_ORDEM = [
  'notas_fiscais_eventos',
  'notas_fiscais_itens',
  'inutilizacoes',
  'webhook_events',
  'ticto_mapeamento',
  'empresas_nfse',
  'notas_fiscais',
  'certificados_digitais',
  'api_keys',
  'clientes',
  'produtos',
  'naturezas_operacao',
  'empresas',
] as const

const BUCKETS = ['certificados', 'notas-xml'] as const

async function main() {
  console.log('=== RESET TOTAL ===\n')
  await wipeTabelas()
  await wipeStorage()
  console.log('\n=== CADASTRO SOBRAL ===\n')
  await cadastrarSobral()
  console.log('\n✓ Pronto. Acesse /empresas no painel pra ver a Sobral única.')
}

async function wipeTabelas() {
  for (const tabela of TABELAS_NA_ORDEM) {
    const { error, count } = await supabase
      .from(tabela)
      .delete({ count: 'exact' })
      .not('id', 'is', null)
    if (error) {
      // Tabela pode não existir (migrations 011/012/013 não aplicadas) — ignora.
      if (error.message.toLowerCase().includes('not find') || error.message.toLowerCase().includes('does not exist') || error.code === '42P01') {
        console.log(`  - ${tabela}: tabela não existe (skip)`)
        continue
      }
      console.log(`  ✗ ${tabela}: ${error.message}`)
      continue
    }
    console.log(`  - ${tabela}: ${count ?? 0} linha(s) apagada(s)`)
  }
}

async function wipeStorage() {
  for (const bucket of BUCKETS) {
    try {
      const todos = await listarRecursivo(bucket, '')
      if (todos.length === 0) {
        console.log(`  - storage/${bucket}: já vazio`)
        continue
      }
      // Deleta em lotes
      const lote = 100
      let apagados = 0
      for (let i = 0; i < todos.length; i += lote) {
        const slice = todos.slice(i, i + lote)
        const { error } = await supabase.storage.from(bucket).remove(slice)
        if (error) {
          console.log(`  ✗ storage/${bucket}: ${error.message}`)
          break
        }
        apagados += slice.length
      }
      console.log(`  - storage/${bucket}: ${apagados} arquivo(s) apagado(s)`)
    } catch (e) {
      console.log(`  ✗ storage/${bucket}: ${(e as Error).message}`)
    }
  }
}

async function listarRecursivo(bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = []
  const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 })
  if (error || !data) return out
  for (const item of data) {
    const path = prefix ? `${prefix}/${item.name}` : item.name
    if (item.id === null) {
      // É pasta — recurse
      const filhos = await listarRecursivo(bucket, path)
      out.push(...filhos)
    } else {
      out.push(path)
    }
  }
  return out
}

async function cadastrarSobral() {
  const pfxBuffer = await readFile(PFX_SOBRAL)
  const info = lerMetadadosPfx(pfxBuffer, SENHA_PFX)
  if (!info) throw new Error('Não foi possível ler PFX de Sobral')
  console.log(`Cert: ${info.razaoSocial} (CNPJ ${info.cnpj}, valido até ${info.validoAte.toISOString().slice(0, 10)})`)

  const { data: empresa, error } = await supabase
    .from('empresas')
    .insert({
      nome: 'NORTE-LAB SOBRAL',
      razao_social: info.razaoSocial,
      cnpj: info.cnpj,
      ie: DADOS_SOBRAL.ie,
      regime_tributario: 'simples',
      crt: 1,
      endereco_logradouro: DADOS_SOBRAL.endereco_logradouro,
      endereco_numero: DADOS_SOBRAL.endereco_numero,
      endereco_bairro: DADOS_SOBRAL.endereco_bairro,
      endereco_cidade: DADOS_SOBRAL.endereco_cidade,
      endereco_uf: DADOS_SOBRAL.endereco_uf,
      endereco_cep: DADOS_SOBRAL.endereco_cep,
      endereco_codigo_ibge: DADOS_SOBRAL.endereco_codigo_ibge,
      telefone: DADOS_SOBRAL.telefone,
      ambiente_sefaz: 2,
      uf_sefaz: 'CE',
      serie_nfe: 1,
      proximo_numero_nfe: 1,
      serie_nfce: 1,
      proximo_numero_nfce: 1,
      tipo_emissao_habilitado: 'teste_local',
      status_fiscal: 'incompleta',
    })
    .select('*')
    .single()
  if (error || !empresa) throw new Error(`Erro ao criar empresa: ${error?.message}`)

  console.log(`✓ Empresa criada: ${empresa.id}`)
  console.log(`   Nome:        ${empresa.nome}`)
  console.log(`   Razão soc:   ${empresa.razao_social}`)
  console.log(`   CNPJ:        ${empresa.cnpj}`)
  console.log(`   IE:          ${empresa.ie}`)
  console.log(`   Endereço:    ${empresa.endereco_logradouro}, ${empresa.endereco_numero}`)
  console.log(`                ${empresa.endereco_bairro} - ${empresa.endereco_cidade}/${empresa.endereco_uf}`)
  console.log(`   CEP:         ${empresa.endereco_cep}`)
  console.log(`   IBGE:        ${empresa.endereco_codigo_ibge}`)
  console.log(`   Telefone:    ${empresa.telefone}`)

  // Upload cert
  await salvarCertificado({ empresaId: empresa.id, pfxBuffer, senha: SENHA_PFX, info })
  console.log(`\n✓ Certificado A1 uploadado e criptografado (válido até ${info.validoAte.toISOString().slice(0, 10)})`)

  console.log(`\n⚠️  Em branco (preencha em /empresas/${empresa.id}):`)
  console.log(`   IM (Inscrição Municipal) — só pra NFS-e`)
  console.log(`   Email`)
  console.log(`   CSC homol (ID + Token) — pra NFC-e`)
}

main().catch((e) => {
  console.error('\n✗ FALHOU:', (e as Error).message || e)
  process.exit(1)
})
