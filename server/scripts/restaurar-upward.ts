/**
 * Apaga a empresa de Groaíras (adicionada por engano) e cadastra a UPWARD
 * CREATIVE ACADEMY LTDA com base no XML de NFS-e que já foi emitido
 * (autorizado em 05/05/2026, nº 10, cTribNac 010501 = licenciamento de software).
 *
 * Também cadastra o cliente Washington melo (tomador da NFS-e) vinculado à
 * Upward.
 *
 * Mantém Sobral intacta.
 */

import { supabase } from '../src/services/supabase.js'

const CNPJ_GROAIRAS = '09545371000123'
const CNPJ_UPWARD = '41911178000171'

// Dados extraídos do XML <NFSe>
const UPWARD = {
  nome: 'Upward Creative Academy',
  razao_social: 'UPWARD CREATIVE ACADEMY LTDA',
  cnpj: CNPJ_UPWARD,
  ie: null,                                // SaaS — sem IE estadual
  im: '1264',
  regime_tributario: 'simples',
  crt: 1,
  endereco_logradouro: 'Rua Monsenhor Melo',
  endereco_numero: 'S/N',
  endereco_bairro: 'Centro',
  endereco_cidade: 'Mucambo',
  endereco_uf: 'CE',
  endereco_cep: '62170000',
  endereco_codigo_ibge: '2309003',          // Mucambo-CE
  email: 'contato@tommello.com',           // do CN do certificado original
  telefone: null,                          // estava zerado no XML
  ambiente_sefaz: 2,                        // homologação por padrão (era 1 no XML — mude se quiser produção)
  uf_sefaz: 'CE',
  serie_nfe: 1,
  proximo_numero_nfe: 1,
  serie_nfce: 1,
  proximo_numero_nfce: 1,
  tipo_emissao_habilitado: 'teste_local',
  status_fiscal: 'incompleta',
  // NFS-e Padrão Nacional
  inscricao_municipal: '1264',
  municipio_emissor_codigo: '2309003',
  nfse_ambiente: 2,                         // homologação (era 1 no XML)
  serie_dps: 1,
  proximo_numero_dps: 9,                    // o XML mostrava nDPS=8 já emitido
  nfse_codigo_lc116_padrao: '01.05',       // licenciamento de software (cTribNac 010501)
}

const CLIENTE_TOMADOR = {
  nome: 'Washington Melo',
  cpf_cnpj: '60353200310',
  email: null,
  endereco_logradouro: 'Avenida Monsenhor José Aloísio Pinto',
  endereco_numero: '388',
  endereco_bairro: 'Dom Expedito',
  endereco_cidade: 'Sobral',
  endereco_uf: 'CE',
  endereco_cep: '62050255',
  endereco_codigo_ibge: '2312908',          // Sobral-CE
  ativo: true,
}

async function main() {
  console.log('=== Apagando Groaíras (cadastro errado) ===')
  await apagarEmpresaPorCnpj(CNPJ_GROAIRAS)

  console.log('\n=== Cadastrando UPWARD CREATIVE ACADEMY LTDA ===')
  const upwardId = await upsertEmpresa()
  console.log(`✓ Empresa: ${upwardId}`)

  console.log('\n=== Cadastrando cliente Washington Melo (tomador da NFS-e nº 10) ===')
  const clienteId = await upsertCliente(upwardId)
  console.log(`✓ Cliente: ${clienteId}`)

  console.log('\n=== Estado final ===')
  const { data: empresas } = await supabase
    .from('empresas')
    .select('id, nome, razao_social, cnpj, endereco_cidade')
    .order('created_at')
  for (const e of empresas || []) {
    console.log(`  ${e.id} — ${e.nome} (${e.razao_social}) — CNPJ ${e.cnpj} — ${e.endereco_cidade}`)
  }
}

async function apagarEmpresaPorCnpj(cnpj: string) {
  const { data: emp } = await supabase
    .from('empresas')
    .select('id')
    .eq('cnpj', cnpj)
    .maybeSingle()
  if (!emp) {
    console.log(`  Nenhuma empresa com CNPJ ${cnpj} (já estava apagada).`)
    return
  }
  const empresaId = emp.id as string

  // Filhos primeiro (FK)
  const filhos = [
    'notas_fiscais_eventos',
    'notas_fiscais_itens',
    'inutilizacoes',
    'notas_fiscais',
    'certificados_digitais',
    'api_keys',
    'clientes',
    'produtos',
    'naturezas_operacao',
  ]
  for (const t of filhos) {
    await supabase.from(t).delete().eq('empresa_id', empresaId).then(({ error }) => {
      if (error && !/not find|does not exist/i.test(error.message)) {
        console.log(`  ✗ ${t}: ${error.message}`)
      }
    })
  }
  // Storage
  await apagarStorage('certificados', empresaId)
  await apagarStorage('notas-xml', empresaId)
  // Empresa
  const { error } = await supabase.from('empresas').delete().eq('id', empresaId)
  if (error) console.log(`  ✗ empresas: ${error.message}`)
  else console.log(`  ✓ empresa ${empresaId} apagada (incluindo storage e filhos)`)
}

async function apagarStorage(bucket: string, empresaId: string) {
  const { data } = await supabase.storage.from(bucket).list(empresaId, { limit: 1000 })
  if (!data || data.length === 0) return
  const paths: string[] = []
  for (const item of data) {
    if (item.id === null) {
      // É pasta
      const { data: sub } = await supabase.storage.from(bucket).list(`${empresaId}/${item.name}`, { limit: 1000 })
      for (const s of sub || []) paths.push(`${empresaId}/${item.name}/${s.name}`)
    } else {
      paths.push(`${empresaId}/${item.name}`)
    }
  }
  if (paths.length > 0) await supabase.storage.from(bucket).remove(paths)
}

async function upsertEmpresa(): Promise<string> {
  const { data: existente } = await supabase
    .from('empresas')
    .select('id')
    .eq('cnpj', CNPJ_UPWARD)
    .maybeSingle()
  if (existente) {
    await supabase.from('empresas').update(UPWARD).eq('id', existente.id)
    return existente.id as string
  }
  const { data, error } = await supabase.from('empresas').insert(UPWARD).select('id').single()
  if (error || !data) throw new Error(`empresa: ${error?.message}`)
  return data.id as string
}

async function upsertCliente(empresaId: string): Promise<string> {
  const payload = { ...CLIENTE_TOMADOR, empresa_id: empresaId }
  const { data: existente } = await supabase
    .from('clientes')
    .select('id')
    .eq('empresa_id', empresaId)
    .eq('cpf_cnpj', CLIENTE_TOMADOR.cpf_cnpj)
    .maybeSingle()
  if (existente) {
    await supabase.from('clientes').update(payload).eq('id', existente.id)
    return existente.id as string
  }
  const { data, error } = await supabase.from('clientes').insert(payload).select('id').single()
  if (error || !data) throw new Error(`cliente: ${error?.message}`)
  return data.id as string
}

main().catch((e) => {
  console.error('Falhou:', (e as Error).message || e)
  process.exit(1)
})
