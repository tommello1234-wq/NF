/**
 * Resolve um CEP no código IBGE do município (7 dígitos) via ViaCEP.
 *
 * Necessário porque a DPS (NFS-e Padrão Nacional) exige que o `cMun` do
 * endereço do tomador PERTENÇA ao `CEP` informado — senão rejeita com E0240.
 * A Stripe/Ticto mandam o CEP do comprador, mas não o código do município;
 * antes o sistema usava o município do EMISSOR como fallback, o que gera o
 * mismatch quando o comprador é de outra cidade.
 *
 * Cache em memória por CEP (por instância) pra não bater no ViaCEP a cada nota.
 */

export interface CepInfo {
  ibge: string
  logradouro?: string
  bairro?: string
  localidade?: string
  uf?: string
}

const cache = new Map<string, CepInfo | null>()

export async function resolverCep(cepRaw: string): Promise<CepInfo | null> {
  const cep = (cepRaw || '').replace(/\D/g, '')
  if (cep.length !== 8 || cep === '00000000') return null
  if (cache.has(cep)) return cache.get(cep) ?? null

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4000)
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    })
    clearTimeout(timer)
    if (!res.ok) {
      cache.set(cep, null)
      return null
    }
    const j = (await res.json()) as {
      erro?: boolean
      ibge?: string
      logradouro?: string
      bairro?: string
      localidade?: string
      uf?: string
    }
    if (j.erro || !j.ibge || !/^\d{7}$/.test(j.ibge)) {
      cache.set(cep, null)
      return null
    }
    const info: CepInfo = {
      ibge: j.ibge,
      logradouro: j.logradouro || undefined,
      bairro: j.bairro || undefined,
      localidade: j.localidade || undefined,
      uf: j.uf || undefined,
    }
    cache.set(cep, info)
    return info
  } catch {
    // Falha transitória (rede/timeout): NÃO cacheia — tenta de novo na próxima.
    return null
  }
}
