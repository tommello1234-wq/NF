/**
 * Cadastra em lote as empresas a partir dos PFX da pasta CERTIFICADOS DIGITAIS.
 *
 * Pra cada PFX que abrir com a senha:
 *   1. Extrai CNPJ + razão social do CN do certificado
 *   2. Cria/atualiza a empresa no banco (idempotente por CNPJ)
 *   3. Faz upload do cert (criptografado, AES-256-GCM)
 *
 * Pros PFX que NÃO abrirem (senha errada): lista no final pra você corrigir.
 *
 * Uso:
 *   npm run cadastrar:empresas
 *
 * Pode customizar a senha via env var:
 *   CERT_SENHA=outraSenha npm run cadastrar:empresas
 *
 * Pode também customizar a pasta:
 *   CERT_DIR="C:/outra/pasta" npm run cadastrar:empresas
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { supabase } from '../src/services/supabase.js'
import { lerMetadadosPfx, salvarCertificado } from '../src/services/certificado.js'

const DEFAULT_DIR = 'C:\\Users\\felip\\Desktop\\Arquivos\\CERTIFICADOS DIGITAIS'
const DEFAULT_SENHA = 'Certificado1234'

const GROAIRAS_IBGE = '2304657'
const SOBRAL_IBGE = '2312908'
const IPU_IBGE = '2305803'
const VARJOTA_IBGE = '2314102'

// Tenta inferir a cidade/IBGE a partir do nome do arquivo PFX.
// O cert tem o CNPJ e a razão social, mas geralmente não a cidade — então
// usamos o nome do arquivo como pista.
function inferirCidade(nomeArquivo: string): { cidade: string; ibge: string } {
  const u = nomeArquivo.toUpperCase()
  if (u.includes('GROAÍRAS') || u.includes('GROAIRAS')) return { cidade: 'Groaíras', ibge: GROAIRAS_IBGE }
  if (u.includes('SOBRAL')) return { cidade: 'Sobral', ibge: SOBRAL_IBGE }
  if (u.includes('IPU')) return { cidade: 'IPU', ibge: IPU_IBGE }
  if (u.includes('VARJOTA') || u.includes('CARIRÉ') || u.includes('CARIRE') || u.includes('MACARAÚ') || u.includes('MACARAU')) {
    return { cidade: 'Varjota', ibge: VARJOTA_IBGE }
  }
  return { cidade: '', ibge: '' }
}

interface ResultadoPfx {
  arquivo: string
  status: 'ok' | 'senha_errada' | 'erro' | 'ja_existia'
  empresaId?: string
  cnpj?: string
  razaoSocial?: string
  cidade?: string
  erro?: string
}

async function main() {
  const dir = process.env.CERT_DIR || DEFAULT_DIR
  const senha = process.env.CERT_SENHA || DEFAULT_SENHA

  console.log(`Lendo PFX de: ${dir}`)
  console.log(`Senha sendo testada: ${senha === DEFAULT_SENHA ? '(default — Dados.txt)' : '(via env CERT_SENHA)'}`)
  console.log()

  let arquivos: string[]
  try {
    arquivos = (await readdir(dir)).filter((f) => /\.(pfx|p12)$/i.test(f))
  } catch (e) {
    throw new Error(`Pasta não encontrada: ${dir} — ${(e as Error).message}`)
  }
  if (arquivos.length === 0) {
    console.log('Nenhum .pfx/.p12 encontrado na pasta.')
    return
  }
  console.log(`Encontrados ${arquivos.length} arquivos:`)
  for (const a of arquivos) console.log(`  ${a}`)
  console.log()

  const resultados: ResultadoPfx[] = []
  for (const arquivo of arquivos) {
    const r = await processar(dir, arquivo, senha)
    resultados.push(r)
    const linha = r.status === 'ok' || r.status === 'ja_existia'
      ? `✓ ${arquivo} → ${r.razaoSocial} (CNPJ ${r.cnpj}) — ${r.status === 'ok' ? 'cadastrada' : 'atualizada'}`
      : `✗ ${arquivo} → ${r.erro || r.status}`
    console.log(linha)
  }

  // Resumo final
  console.log()
  console.log('=== Resumo ===')
  const ok = resultados.filter((r) => r.status === 'ok' || r.status === 'ja_existia')
  const falha = resultados.filter((r) => r.status !== 'ok' && r.status !== 'ja_existia')
  console.log(`✓ ${ok.length} empresa(s) cadastrada(s):`)
  for (const r of ok) console.log(`   ${r.cidade || '?'} — ${r.razaoSocial} (${r.cnpj}) — id=${r.empresaId}`)
  if (falha.length > 0) {
    console.log()
    console.log(`⚠️  ${falha.length} arquivo(s) NÃO processado(s):`)
    for (const r of falha) console.log(`   ${r.arquivo} → ${r.erro || r.status}`)
    console.log()
    console.log('   Pra esses, descubra a senha correta e rode:')
    console.log('   CERT_SENHA="senhaCorreta" npm run cadastrar:empresas')
    console.log('   (ou suba o PFX manualmente em /empresas/<id>/certificado)')
  }
}

async function processar(dir: string, arquivo: string, senha: string): Promise<ResultadoPfx> {
  const caminho = join(dir, arquivo)
  const pfxBuffer = await readFile(caminho)

  const info = lerMetadadosPfx(pfxBuffer, senha)
  if (!info || !info.cnpj) {
    return { arquivo, status: 'senha_errada', erro: 'PFX não decriptou — senha provavelmente errada' }
  }

  const cnpj = info.cnpj
  const { cidade, ibge } = inferirCidade(arquivo)

  // Cria ou atualiza empresa por CNPJ
  const { data: existente } = await supabase
    .from('empresas')
    .select('id')
    .eq('cnpj', cnpj)
    .maybeSingle()

  const payload = {
    nome: info.razaoSocial,
    razao_social: info.razaoSocial,
    cnpj,
    regime_tributario: 'simples',
    crt: 1,
    endereco_cidade: cidade || null,
    endereco_uf: 'CE',
    endereco_codigo_ibge: ibge || null,
    ambiente_sefaz: 2,
    uf_sefaz: 'CE',
    serie_nfe: 1,
    proximo_numero_nfe: 1,
    serie_nfce: 1,
    proximo_numero_nfce: 1,
    tipo_emissao_habilitado: 'teste_local',
    status_fiscal: 'incompleta',
  }

  let empresaId: string
  let novaCadastrada = false
  if (existente) {
    // Atualiza só razao_social (vem autoritativa do cert). NÃO toca em `nome`
    // (pode ser nome fantasia personalizado pelo usuário) nem em endereço/IE/CSC
    // que já foram preenchidos manualmente.
    const { error } = await supabase
      .from('empresas')
      .update({ razao_social: payload.razao_social })
      .eq('id', existente.id)
    if (error) return { arquivo, status: 'erro', erro: `update: ${error.message}` }
    empresaId = existente.id as string
  } else {
    const { data, error } = await supabase.from('empresas').insert(payload).select('id').single()
    if (error || !data) return { arquivo, status: 'erro', erro: `insert: ${error?.message}` }
    empresaId = data.id as string
    novaCadastrada = true
  }

  // Upload do cert
  try {
    await salvarCertificado({ empresaId, pfxBuffer, senha, info })
  } catch (e) {
    return { arquivo, status: 'erro', erro: `salvar cert: ${(e as Error).message}` }
  }

  return {
    arquivo,
    status: novaCadastrada ? 'ok' : 'ja_existia',
    empresaId,
    cnpj,
    razaoSocial: info.razaoSocial,
    cidade,
  }
}

main().catch((e) => {
  console.error('Falhou:', (e as Error).message || e)
  process.exit(1)
})
