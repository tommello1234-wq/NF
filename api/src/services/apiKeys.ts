import crypto from 'node:crypto'
import { supabase } from './supabase.js'

/**
 * Formato da API key: nf_<env>_<32 random chars>
 * - env = "live" (produção SEFAZ) ou "test" (homologação)
 * - Nunca guardamos a chave plaintext no banco — só o SHA-256.
 * - O prefix (primeiros 8 caracteres) é guardado pra identificação visual.
 */

export function gerarApiKey(env: 'live' | 'test' = 'live'): { plaintext: string; hash: string; prefix: string } {
  const random = crypto.randomBytes(24).toString('base64url').slice(0, 32)
  const plaintext = `nf_${env}_${random}`
  const hash = crypto.createHash('sha256').update(plaintext).digest('hex')
  const prefix = plaintext.slice(0, 11) // "nf_live_abc" ou "nf_test_abc"
  return { plaintext, hash, prefix }
}

export function hashKey(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext).digest('hex')
}

/**
 * Valida uma API key, retornando o empresa_id correspondente ou null.
 * Atualiza `ultimo_uso` quando válida.
 */
export async function validarApiKey(plaintext: string): Promise<string | null> {
  if (!plaintext || !plaintext.startsWith('nf_')) return null

  const hash = hashKey(plaintext)
  const { data } = await supabase
    .from('api_keys')
    .select('id, empresa_id, revogada_em')
    .eq('key_hash', hash)
    .maybeSingle()

  if (!data || data.revogada_em) return null

  // Atualiza ultimo_uso em background (não bloqueia requisição)
  supabase
    .from('api_keys')
    .update({ ultimo_uso: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => { /* ignore */ }, () => { /* ignore */ })

  return data.empresa_id
}

export async function criarApiKey(empresaId: string, nome: string, env: 'live' | 'test' = 'live') {
  const { plaintext, hash, prefix } = gerarApiKey(env)
  const { data, error } = await supabase
    .from('api_keys')
    .insert({
      empresa_id: empresaId,
      key_hash: hash,
      prefix,
      nome,
    })
    .select('id, prefix, nome, created_at')
    .single()

  if (error) throw new Error(`Erro ao criar API key: ${error.message}`)

  return {
    id: data.id,
    prefix: data.prefix,
    nome: data.nome,
    plaintext,               // ← só retorna nessa resposta; nunca mais
    created_at: data.created_at,
  }
}

export async function listarApiKeys(empresaId: string) {
  const { data } = await supabase
    .from('api_keys')
    .select('id, prefix, nome, ultimo_uso, revogada_em, created_at')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: false })
  return data || []
}

export async function revogarApiKey(id: string) {
  const { error } = await supabase
    .from('api_keys')
    .update({ revogada_em: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}
