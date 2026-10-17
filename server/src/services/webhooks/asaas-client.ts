import type { AsaasCustomer, AsaasInstallment, AsaasPayment } from './asaas-types.js'

/**
 * Cliente mínimo da API v3 do Asaas — só leitura.
 *
 * O ambiente sai da própria chave: as de sandbox têm `_hmlg_` no meio
 * (`$aact_hmlg_...`), as de produção não. Assim não existe um segundo campo
 * "ambiente" pra alguém esquecer de trocar.
 */

const BASE_PROD = 'https://api.asaas.com/v3'
const BASE_SANDBOX = 'https://api-sandbox.asaas.com/v3'

export function ehChaveSandbox(apiKey: string): boolean {
  return apiKey.includes('_hmlg_')
}

function baseUrl(apiKey: string): string {
  return ehChaveSandbox(apiKey) ? BASE_SANDBOX : BASE_PROD
}

export class AsaasApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

async function get<T>(apiKey: string, path: string): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(`${baseUrl(apiKey)}${path}`, {
      signal: ctrl.signal,
      headers: {
        access_token: apiKey,
        accept: 'application/json',
        // O Asaas recusa chamadas sem User-Agent em contas criadas a partir de 2024.
        'user-agent': 'nfe-api',
      },
    })
    const text = await res.text()
    if (!res.ok) {
      let detalhe = text.slice(0, 200)
      try {
        const j = JSON.parse(text) as { errors?: Array<{ description?: string }> }
        detalhe = j.errors?.map((e) => e.description).filter(Boolean).join(' | ') || detalhe
      } catch {
        /* resposta não-JSON: mantém o texto cru */
      }
      const msg =
        res.status === 401
          ? 'Chave da API do Asaas inválida ou revogada'
          : `Asaas respondeu ${res.status}: ${detalhe}`
      throw new AsaasApiError(msg, res.status)
    }
    return JSON.parse(text) as T
  } finally {
    clearTimeout(timer)
  }
}

export function buscarCliente(apiKey: string, customerId: string): Promise<AsaasCustomer> {
  return get<AsaasCustomer>(apiKey, `/customers/${encodeURIComponent(customerId)}`)
}

export function buscarParcelamento(apiKey: string, installmentId: string): Promise<AsaasInstallment> {
  return get<AsaasInstallment>(apiKey, `/installments/${encodeURIComponent(installmentId)}`)
}

/**
 * Todas as cobranças com um status, paginando a API (máx. 100 por página).
 * A ordem da API é estável, ao contrário da lista da tela do Asaas.
 */
export async function listarCobrancasPorStatus(
  apiKey: string,
  status: 'RECEIVED' | 'CONFIRMED',
): Promise<AsaasPayment[]> {
  const todas: AsaasPayment[] = []
  for (let offset = 0; offset < 50_000; offset += 100) {
    const r = await get<{ data?: AsaasPayment[]; hasMore?: boolean }>(
      apiKey,
      `/payments?status=${status}&limit=100&offset=${offset}`,
    )
    todas.push(...(r.data || []))
    if (!r.hasMore) break
  }
  return todas
}

/** Todas as parcelas de um parcelamento — pra saber se o estorno foi total. */
export async function listarParcelas(apiKey: string, installmentId: string): Promise<AsaasPayment[]> {
  const r = await get<{ data?: AsaasPayment[] }>(
    apiKey,
    `/payments?installment=${encodeURIComponent(installmentId)}&limit=100`,
  )
  return r.data || []
}

/**
 * Valida a chave sem efeito colateral. Devolve o nome da conta pra o painel
 * mostrar "conectado a X" — confirma que a chave é da conta certa.
 */
export async function validarChave(apiKey: string): Promise<{ nome: string; sandbox: boolean }> {
  const sandbox = ehChaveSandbox(apiKey)
  try {
    const conta = await get<{ name?: string; companyName?: string }>(
      apiKey,
      '/myAccount/commercialInfo',
    )
    return { nome: conta.companyName || conta.name || 'conta Asaas', sandbox }
  } catch (e) {
    // Chave inválida é inválida em qualquer endpoint — não adianta insistir.
    if (e instanceof AsaasApiError && e.status === 401) throw e
    // Algumas contas não expõem os dados comerciais; a listagem de clientes
    // (que é o que o webhook usa de fato) basta pra provar que a chave funciona.
    await get<unknown>(apiKey, '/customers?limit=1')
    return { nome: 'conta Asaas', sandbox }
  }
}
