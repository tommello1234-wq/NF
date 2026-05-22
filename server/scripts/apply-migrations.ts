/**
 * Script CLI para aplicar migrations pendentes no Supabase.
 *
 * Uso:
 *   npm run db:migrate -w server
 *
 * Como funciona:
 *   1. Verifica quais migrations já estão aplicadas (testando colunas/tabelas chave)
 *   2. Tenta executar as pendentes via RPC `exec_sql(query text)`
 *   3. Se a RPC ainda não existe, imprime o SQL pra criar UMA vez no SQL Editor
 *
 * Esse script é para o desenvolvedor, NÃO é exposto ao usuário final.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { supabase } from '../src/services/supabase.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations')

interface Check { arquivo: string; nome: string; check: () => Promise<boolean> }

const checks: Check[] = [
  { arquivo: '013_nfe_nfce_complementos.sql', nome: 'NF-e complementos', check: async () => !(await supabase.from('produtos').select('cest').limit(1)).error },
  { arquivo: '014_nfe_estoque_csc.sql', nome: 'Estoque + CSC', check: async () => !(await supabase.from('produtos').select('estoque').limit(1)).error },
  { arquivo: '015_nfeproc_e_carta_correcao.sql', nome: 'nfeProc + CC-e', check: async () => !(await supabase.from('notas_fiscais').select('xml_proc_path').limit(1)).error },
  { arquivo: '016_produtos_fiscal_completo.sql', nome: 'Fiscal completo', check: async () => !(await supabase.from('produtos').select('cfop_venda_dentro').limit(1)).error },
  { arquivo: '017_nf_intermediador_frete_status.sql', nome: 'Intermediador + Frete + Status', check: async () => !(await supabase.from('notas_fiscais').select('ind_intermed').limit(1)).error },
  { arquivo: '018_vendas_e_os.sql', nome: 'Vendas + OS', check: async () => !(await supabase.from('vendas').select('id').limit(1)).error },
  { arquivo: '019_arquivado_produtos_clientes.sql', nome: 'Arquivado', check: async () => !(await supabase.from('produtos').select('arquivado').limit(1)).error },
  { arquivo: '020_audit_log.sql', nome: 'Audit log', check: async () => !(await supabase.from('audit_log').select('id').limit(1)).error },
]

const BOOTSTRAP_SQL = `CREATE OR REPLACE FUNCTION public.exec_sql(query text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  EXECUTE query;
  RETURN json_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('ok', false, 'error', SQLERRM);
END;
$func$;

GRANT EXECUTE ON FUNCTION public.exec_sql(text) TO service_role;`

async function main() {
  console.log('🔍 Verificando status das migrations...\n')

  if (!existsSync(MIGRATIONS_DIR)) {
    console.error('❌ Diretório de migrations não encontrado:', MIGRATIONS_DIR)
    process.exit(1)
  }

  // Detecta arquivos extras que tenham vindo depois (013+)
  const arquivos = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && /^0[12]\d_/.test(f))
    .sort()

  // Verifica status
  const status: Array<{ arquivo: string; nome: string; aplicada: boolean }> = []
  for (const c of checks) {
    if (!arquivos.includes(c.arquivo)) continue
    const aplicada = await c.check()
    status.push({ arquivo: c.arquivo, nome: c.nome, aplicada })
  }

  const pendentes = status.filter((s) => !s.aplicada)
  if (pendentes.length === 0) {
    console.log('✅ Todas as migrations já estão aplicadas. Nada a fazer.')
    process.exit(0)
  }

  console.log(`Status atual:`)
  for (const s of status) {
    console.log(`  ${s.aplicada ? '✅' : '❌'} ${s.arquivo} — ${s.nome}`)
  }
  console.log(`\n📦 ${pendentes.length} pendente(s).\n`)

  // Tenta usar RPC exec_sql
  console.log('🔎 Verificando se a função exec_sql existe no banco...')
  const probe = await supabase.rpc('exec_sql', { query: 'SELECT 1' })
  if (probe.error) {
    const msg = probe.error.message || ''
    if (/Could not find the function|exec_sql.*does not exist|PGRST202/i.test(msg)) {
      console.log('\n⚠️  A função exec_sql ainda não existe no banco.')
      console.log('   Cole o SQL abaixo no SQL Editor do Supabase (uma vez só):')
      console.log('   Link: https://supabase.com/dashboard → seu projeto → SQL Editor → New query\n')
      console.log('───────────────── COLE ESTE SQL ─────────────────')
      console.log(BOOTSTRAP_SQL)
      console.log('────────────────────────────────────────────────\n')
      console.log('Depois de colar e clicar Run, rode esse script de novo:')
      console.log('   npm run db:migrate -w server\n')
      process.exit(2)
    }
    console.error('❌ Erro inesperado:', msg)
    process.exit(1)
  }

  console.log('✅ Função exec_sql OK. Aplicando migrations...\n')

  let aplicadas = 0
  for (const m of pendentes) {
    const path = join(MIGRATIONS_DIR, m.arquivo)
    if (!existsSync(path)) {
      console.error(`❌ Arquivo não encontrado: ${path}`)
      continue
    }
    const sql = readFileSync(path, 'utf-8')
    console.log(`▶  ${m.arquivo} — ${m.nome}`)
    const r = await supabase.rpc('exec_sql', { query: sql })
    if (r.error) {
      console.error(`   ❌ Falha: ${r.error.message}`)
      continue
    }
    const data = r.data as { ok: boolean; error?: string } | null
    if (data && data.ok === false) {
      console.error(`   ❌ Falha: ${data.error}`)
      continue
    }
    console.log(`   ✅ Aplicada`)
    aplicadas++
  }

  console.log(`\n🎉 ${aplicadas}/${pendentes.length} migrations aplicadas com sucesso.`)
  if (aplicadas < pendentes.length) {
    console.log('⚠️  Algumas falharam — verifique os erros acima.')
    process.exit(1)
  }
}

void main().catch((e) => {
  console.error('Erro fatal:', e)
  process.exit(1)
})
