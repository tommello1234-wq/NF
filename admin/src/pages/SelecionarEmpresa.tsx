import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, ChevronRight, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useEmpresaAtual, type EmpresaResumo } from '../lib/empresaContext'

/**
 * Splash de seleção de workspace pós-login. Cada empresa tem seu próprio
 * "painel" — mesmo deploy, mesma URL, mas dados isolados via contexto
 * global (`empresaContext`). A escolha é persistida em localStorage e só
 * troca quando o usuário clicar "Trocar empresa" no topo.
 *
 * Cor do card vem do hash do nome — assim cada empresa tem uma cor
 * consistente entre sessões mas não precisa cadastrar manualmente.
 */
export default function SelecionarEmpresa() {
  const navigate = useNavigate()
  const { empresas, setEmpresaId, loading } = useEmpresaAtual()

  // Se só tem 1 empresa → auto-seleciona e pula a splash (conta restrita)
  useEffect(() => {
    if (!loading && empresas.length === 1) {
      setEmpresaId(empresas[0].id)
      navigate('/nfse', { replace: true })
    }
    if (!loading && empresas.length === 0) {
      navigate('/empresas', { replace: true })
    }
  }, [loading, empresas, setEmpresaId, navigate])

  function escolher(empresa: EmpresaResumo) {
    setEmpresaId(empresa.id)
    navigate('/nfse')
  }

  async function logout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-light-secondary text-muted">
        Carregando empresas...
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-light-secondary p-6">
      <div className="mx-auto flex max-w-4xl flex-col">
        <header className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10">
              <ShieldCheck size={22} className="text-accent" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-dark">NFe Admin</h1>
              <p className="text-sm text-muted">Em qual empresa você quer trabalhar agora?</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="text-xs font-medium text-muted hover:text-dark"
          >
            Sair
          </button>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          {empresas.map((empresa) => (
            <CardEmpresa key={empresa.id} empresa={empresa} onClick={() => escolher(empresa)} />
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          Os dados de cada empresa ficam isolados — clientes, produtos, NFS-e e NF-e nunca se misturam.
          Você pode trocar de empresa a qualquer momento no topo do painel.
        </p>
      </div>
    </div>
  )
}

function CardEmpresa({ empresa, onClick }: { empresa: EmpresaResumo; onClick: () => void }) {
  const cor = corDaEmpresa(empresa.nome || empresa.razao_social || empresa.id)
  const cnpjFmt = formatarCnpj(empresa.cnpj)
  const cidade = empresa.endereco_cidade
    ? `${empresa.endereco_cidade}${empresa.endereco_uf ? ` / ${empresa.endereco_uf}` : ''}`
    : null
  const ambiente = empresa.ambiente_sefaz === 1 ? 'Produção' : empresa.ambiente_sefaz === 2 ? 'Homologação' : null

  return (
    <button
      onClick={onClick}
      className="group flex items-stretch overflow-hidden rounded-2xl bg-white text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-accent/40"
    >
      <div
        className="flex w-2 shrink-0"
        style={{ background: cor.bar }}
        aria-hidden
      />
      <div className="flex flex-1 items-center gap-4 p-5">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: cor.bg, color: cor.fg }}
        >
          <Building2 size={26} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="truncate text-base font-bold text-dark">
            {empresa.nome || empresa.razao_social || '(sem nome)'}
          </div>
          {empresa.razao_social && empresa.nome && empresa.razao_social !== empresa.nome && (
            <div className="truncate text-xs text-muted">{empresa.razao_social}</div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-dark">
            {cnpjFmt && <span>CNPJ {cnpjFmt}</span>}
            {cidade && <span>{cidade}</span>}
            {ambiente && (
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  empresa.ambiente_sefaz === 1
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-100 text-amber-700'
                }`}
              >
                {ambiente}
              </span>
            )}
          </div>
        </div>
        <ChevronRight size={18} className="shrink-0 text-muted transition-colors group-hover:text-accent" />
      </div>
    </button>
  )
}

/** Formata 14 dígitos em XX.XXX.XXX/XXXX-XX. Aceita string já formatada. */
function formatarCnpj(cnpj?: string | null): string | null {
  if (!cnpj) return null
  const digits = cnpj.replace(/\D/g, '')
  if (digits.length !== 14) return cnpj
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`
}

/**
 * Cor estável derivada do nome — assim a mesma empresa pega sempre a mesma
 * cor sem precisar cadastrar manualmente. Usa um hash simples DJB2.
 */
function corDaEmpresa(seed: string): { bar: string; bg: string; fg: string } {
  let hash = 5381
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) >>> 0
  }
  const paletas = [
    { bar: '#0ea5e9', bg: '#e0f2fe', fg: '#0369a1' }, // sky
    { bar: '#10b981', bg: '#d1fae5', fg: '#047857' }, // emerald
    { bar: '#8b5cf6', bg: '#ede9fe', fg: '#6d28d9' }, // violet
    { bar: '#f59e0b', bg: '#fef3c7', fg: '#b45309' }, // amber
    { bar: '#ec4899', bg: '#fce7f3', fg: '#be185d' }, // pink
    { bar: '#06b6d4', bg: '#cffafe', fg: '#0e7490' }, // cyan
  ]
  return paletas[hash % paletas.length]
}
