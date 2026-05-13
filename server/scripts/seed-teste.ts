/**
 * Cria dados de teste pra emitir uma NF-e/NFC-e em homologação:
 *  - empresa (CNPJ extraído do PFX de Groaíras pra bater com o certificado)
 *  - certificado A1 já criptografado e armazenado
 *  - natureza de operação "Venda dentro do CE"
 *  - 1 produto (óculos com NCM/CFOP/CSOSN)
 *  - 1 cliente teste
 *
 * Idempotente: usa upsert por CNPJ/empresa_id+nome.
 *
 * Rodar com: npm run seed:teste
 */

import { readFile } from 'node:fs/promises'
import { supabase } from '../src/services/supabase.js'
import { lerMetadadosPfx, salvarCertificado } from '../src/services/certificado.js'

const PFX_PATH = 'C:\\Users\\felip\\Desktop\\Arquivos\\CERTIFICADO DE GROAÍRAS.pfx'
const PFX_SENHA = 'Certificado1234'

const GROAIRAS_IBGE = '2304657'   // código IBGE de Groaíras-CE (7 dígitos)

async function main() {
  // Dados reais da Ótica Princesa Groaíras (do comprovante-venda-13119.pdf).
  // Sobrescritos se o PFX abrir e tiver CN com CNPJ.
  let cnpj = '09545371000123'
  let razaoSocial = 'Ótica Princesa Groaíras'
  let pfxBuffer: Buffer | null = null
  let info: ReturnType<typeof lerMetadadosPfx> = null

  console.log('Tentando ler PFX…')
  try {
    pfxBuffer = await readFile(PFX_PATH)
    info = lerMetadadosPfx(pfxBuffer, PFX_SENHA)
    if (info) {
      cnpj = info.cnpj
      razaoSocial = info.razaoSocial
      console.log(`  CN: ${info.razaoSocial} (CNPJ ${info.cnpj})`)
    } else {
      console.log('  ⚠️ PFX presente mas senha incorreta — empresa será criada com CNPJ fake e o certificado terá que ser uploadado depois pelo painel.')
    }
  } catch (e) {
    console.log(`  ⚠️ Falha ao ler PFX (${(e as Error).message}) — seguindo com CNPJ fake.`)
  }

  const empresaId = await upsertEmpresa(cnpj, razaoSocial)
  console.log(`Empresa: ${empresaId}`)

  if (pfxBuffer && info) {
    await salvarCertificado({ empresaId, pfxBuffer, senha: PFX_SENHA, info })
    console.log('Certificado salvo (criptografado em certificados_digitais).')
  } else {
    console.log('Certificado: NÃO foi salvo. Suba pelo painel /empresas/' + empresaId + ' assim que tiver a senha correta.')
  }

  const naturezaId = await upsertNatureza(empresaId)
  console.log(`Natureza de operação: ${naturezaId}`)

  const produtoId = await upsertProduto(empresaId)
  console.log(`Produto teste: ${produtoId}`)

  const clienteId = await upsertCliente(empresaId)
  console.log(`Cliente teste: ${clienteId}`)

  console.log('\nUse no painel /nfe (ambiente HOMOLOGAÇÃO):')
  console.log(`  empresa_id            = ${empresaId}`)
  console.log(`  natureza_operacao_id  = ${naturezaId}`)
  console.log(`  produto_id            = ${produtoId}`)
  console.log(`  cliente_id            = ${clienteId}  (opcional pra NFC-e)`)
  console.log('\n⚠️  Pra emitir NFC-e (modelo 65) em homologação, ainda falta cadastrar o CSC homol da empresa em /empresas/' + empresaId)
  console.log('⚠️  Pra emitir NF-e (modelo 55), a empresa precisa estar habilitada na SEFAZ-CE pro modelo 55, ambiente 2.')
}

async function upsertEmpresa(cnpj: string, razaoSocial: string): Promise<string> {
  const cnpjLimpo = cnpj.replace(/\D/g, '')
  const { data: existente } = await supabase
    .from('empresas')
    .select('id')
    .eq('cnpj', cnpjLimpo)
    .maybeSingle()

  // Dados reais da Ótica Princesa Groaíras quando o CNPJ bate; senão fica genérico.
  const ehOticaPrincesa = cnpjLimpo === '09545371000123'
  const payload = ehOticaPrincesa
    ? {
        nome: 'Ótica Princesa Groaíras',
        razao_social: razaoSocial,
        cnpj: cnpjLimpo,
        ie: null,
        regime_tributario: 'simples',
        crt: 1,
        endereco_logradouro: 'Manoel Gerônimo',
        endereco_numero: '85',
        endereco_bairro: 'Centro',
        endereco_cidade: 'Groaíras',
        endereco_uf: 'CE',
        endereco_cep: null,
        endereco_codigo_ibge: GROAIRAS_IBGE,
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
    : {
        nome: razaoSocial.split(' ').slice(0, 3).join(' '),
        razao_social: razaoSocial,
        cnpj: cnpjLimpo,
        ie: null,
        regime_tributario: 'simples',
        crt: 1,
        endereco_cidade: 'Groaíras',
        endereco_uf: 'CE',
        endereco_codigo_ibge: GROAIRAS_IBGE,
        ambiente_sefaz: 2,
        uf_sefaz: 'CE',
        serie_nfe: 1,
        proximo_numero_nfe: 1,
        serie_nfce: 1,
        proximo_numero_nfce: 1,
        tipo_emissao_habilitado: 'teste_local',
        status_fiscal: 'incompleta',
      }

  if (existente) {
    await supabase.from('empresas').update(payload).eq('id', existente.id)
    return existente.id as string
  }
  const { data, error } = await supabase.from('empresas').insert(payload).select('id').single()
  if (error || !data) throw new Error(`Erro ao criar empresa: ${error?.message}`)
  return data.id as string
}

async function upsertNatureza(empresaId: string): Promise<string> {
  const nome = 'Venda dentro do CE'
  const { data: existente } = await supabase
    .from('naturezas_operacao')
    .select('id')
    .eq('empresa_id', empresaId)
    .eq('nome', nome)
    .maybeSingle()
  const payload = {
    empresa_id: empresaId,
    nome,
    natureza: 'VENDA DE MERCADORIA',
    tipo_operacao: 'saida',
    finalidade: 'normal',
    cfop_padrao: '5102',
    consumidor_final: true,
    indicador_presenca: 1,
    modalidade_frete: 9,
    ativo: true,
  }
  if (existente) {
    await supabase.from('naturezas_operacao').update(payload).eq('id', existente.id)
    return existente.id as string
  }
  const { data, error } = await supabase
    .from('naturezas_operacao')
    .insert(payload)
    .select('id')
    .single()
  if (error || !data) throw new Error(`Erro ao criar natureza: ${error?.message}`)
  return data.id as string
}

async function upsertProduto(empresaId: string): Promise<string> {
  const codigo = 'OCULOS-TESTE-001'
  const { data: existente } = await supabase
    .from('produtos')
    .select('id')
    .eq('empresa_id', empresaId)
    .eq('codigo_interno', codigo)
    .maybeSingle()
  const base: Record<string, unknown> = {
    empresa_id: empresaId,
    descricao: 'OCULOS DE GRAU TESTE - ARMACAO PLASTICA',
    codigo_interno: codigo,
    ncm: '90031100',
    cfop: '5102',
    unidade: 'PC',
    valor_unitario: 250.0,
    origem: 0,
    cst_csosn: '102',
    aliquota_icms: 0,
    aliquota_pis: 0,
    aliquota_cofins: 0,
    cst_pis: '49',
    cst_cofins: '49',
    gtin: 'SEM GTIN',
    estoque: 100,
    tipo: 'produto',
    ativo: true,
  }
  // Se as migrations 013/014 não estiverem aplicadas, retira os campos novos.
  if (existente) {
    const { error } = await supabase.from('produtos').update(base).eq('id', existente.id)
    if (error) await tentarUpdateLegado(existente.id as string, base)
    return existente.id as string
  }
  const { data, error } = await supabase.from('produtos').insert(base).select('id').single()
  if (error) {
    return await inserirLegado(base)
  }
  if (!data) throw new Error('Insert de produto retornou vazio')
  return data.id as string
}

async function tentarUpdateLegado(id: string, base: Record<string, unknown>) {
  const legado = stripCampos(base, ['cst_pis', 'cst_cofins', 'gtin', 'estoque'])
  const { error } = await supabase.from('produtos').update(legado).eq('id', id)
  if (error) throw new Error(`Erro ao atualizar produto (mesmo sem campos novos): ${error.message}`)
}

async function inserirLegado(base: Record<string, unknown>): Promise<string> {
  const legado = stripCampos(base, ['cst_pis', 'cst_cofins', 'gtin', 'estoque'])
  const { data, error } = await supabase.from('produtos').insert(legado).select('id').single()
  if (error || !data) throw new Error(`Erro ao criar produto (mesmo sem campos novos): ${error?.message}`)
  console.log('  ⚠️  Migrations 013/014 ainda não aplicadas — produto criado SEM gtin/cst_pis/cst_cofins/estoque.')
  console.log('     Aplique 013 e 014 e rode o seed novamente pra completar os dados fiscais.')
  return data.id as string
}

function stripCampos<T extends Record<string, unknown>>(obj: T, campos: string[]): T {
  const out = { ...obj }
  for (const c of campos) delete out[c]
  return out
}

async function upsertCliente(empresaId: string): Promise<string> {
  const cpf = '12345678909'
  const { data: existente } = await supabase
    .from('clientes')
    .select('id')
    .eq('empresa_id', empresaId)
    .eq('cpf_cnpj', cpf)
    .maybeSingle()
  const payload = {
    empresa_id: empresaId,
    nome: 'CLIENTE TESTE',
    cpf_cnpj: cpf,
    email: 'cliente@teste.local',
    endereco_logradouro: 'Av. Brasil',
    endereco_numero: '500',
    endereco_bairro: 'Aldeota',
    endereco_cidade: 'FORTALEZA',
    endereco_uf: 'CE',
    endereco_cep: '60150000',
    endereco_codigo_ibge: '2304400',
  }
  if (existente) {
    await supabase.from('clientes').update(payload).eq('id', existente.id)
    return existente.id as string
  }
  const { data, error } = await supabase.from('clientes').insert(payload).select('id').single()
  if (error || !data) throw new Error(`Erro ao criar cliente: ${error?.message}`)
  return data.id as string
}

main().catch((e) => {
  console.error('Falhou:', e.message || e)
  process.exit(1)
})
