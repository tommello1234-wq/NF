import { supabase } from './supabase'

const API_URL = (import.meta.env.VITE_API_URL as string) || (import.meta.env.PROD ? '/api' : 'http://localhost:3001')

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Não autenticado')
  return { Authorization: `Bearer ${token}` }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: await authHeaders() })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
  return res.json()
}

export async function apiPost<T>(
  path: string,
  body?: unknown,
  options?: { signal?: AbortSignal },
): Promise<T> {
  // Não anexa Content-Type quando não há body — Fastify rejeita POST com
  // header JSON e body vazio (FST_ERR_CTP_EMPTY_JSON_BODY).
  const headers: Record<string, string> = { ...(await authHeaders()) }
  if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers,
    body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
    signal: options?.signal,
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
  if (res.status === 204) return undefined as T
  return res.json()
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { ...(await authHeaders()) }
  if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API_URL}${path}`, {
    method: 'PATCH',
    headers,
    body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
  return res.json()
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, { method: 'DELETE', headers: await authHeaders() })
  if (!res.ok && res.status !== 204) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
}

/**
 * Variante do apiDelete que devolve o status + body em vez de lançar.
 * Útil quando o backend pode responder 409 com sugestões de fallback
 * (ex: inativar em vez de excluir).
 */
export async function apiDeleteWithInfo(
  path: string,
): Promise<
  | { ok: true }
  | { ok: false; status: number; body: { error?: string; codigo?: string; sugestao?: string } }
> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, { method: 'DELETE', headers: await authHeaders() })
  } catch (err) {
    // "Failed to fetch" tipicamente = backend offline / CORS / DNS
    throw new Error(
      `Servidor não respondeu (${(err as Error).message}). ` +
      `Verifique se o backend está rodando em ${API_URL}.`,
    )
  }
  if (res.ok || res.status === 204) return { ok: true }
  const body = await res.json().catch(() => ({}))
  return { ok: false, status: res.status, body }
}

export async function apiDownload(path: string): Promise<Blob> {
  const res = await fetch(`${API_URL}${path}`, { headers: await authHeaders() })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
  return res.blob()
}

export async function apiPostDownload(path: string, body?: unknown): Promise<Blob> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
  return res.blob()
}

export async function apiUpload(path: string, formData: FormData): Promise<unknown> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: await authHeaders(),
    body: formData,
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
  return res.json()
}
