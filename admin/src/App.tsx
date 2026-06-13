import { useEffect, useState } from 'react'
import { Routes, Route, Link, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Building2, ShieldCheck, CreditCard, FileSignature, FileText, LogOut, Package, Plug, ReceiptText, Repeat, Settings2, ShoppingCart, Users } from 'lucide-react'
import { supabase } from './lib/supabase'
import { EmpresaProvider, useEmpresaAtual } from './lib/empresaContext'
import Login from './pages/Login'
import Empresas from './pages/Empresas'
import EmpresaDetalhe from './pages/EmpresaDetalhe'
import Notas from './pages/Notas'
import Nfse from './pages/Nfse'
import Nfe from './pages/Nfe'
import Clientes from './pages/Clientes'
import Produtos from './pages/Produtos'
import Vendas from './pages/Vendas'
import Darfs from './pages/Darfs'
import Fiscal from './pages/Fiscal'
import IntegracoesTicto from './pages/IntegracoesTicto'
import IntegracoesStripe from './pages/IntegracoesStripe'
import SelecionarEmpresa from './pages/SelecionarEmpresa'

function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState<string | null>(null)
  const { empresaAtual } = useEmpresaAtual()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email || null))
  }, [])

  async function logout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  // Flags por workspace. Defaults seguros: NFS-e ligado (mais comum), NF-e
  // desligado (precisa SEFAZ/CSC configurado). UPWARD fica só com NFS-e
  // e some "Vendas/NF-e" do menu; NORTE-LAB ativa NF-e e ganha esses itens.
  const emiteNfse = empresaAtual?.emite_nfse !== false
  const emiteNfe = empresaAtual?.emite_nfe === true
  const usaStripe = empresaAtual?.usa_stripe === true
  const usaTicto = empresaAtual?.usa_ticto === true

  const nav = [
    { to: '/empresas', label: 'Empresas', icon: Building2, show: true },
    { to: '/clientes', label: 'Clientes', icon: Users, show: true },
    { to: '/produtos', label: 'Produtos & Serviços', icon: Package, show: true },
    { to: '/vendas', label: 'Vendas (NFC-e auto)', icon: ShoppingCart, show: emiteNfe },
    { to: '/fiscal', label: 'Fiscal', icon: Settings2, show: true },
    { to: '/nfse', label: 'NFS-e', icon: FileSignature, show: emiteNfse },
    { to: '/nfe', label: 'NF-e / NFC-e', icon: FileText, show: emiteNfe },
    { to: '/integracoes/ticto', label: 'Integração Ticto', icon: Plug, show: usaTicto },
    { to: '/integracoes/stripe', label: 'Integração Stripe', icon: CreditCard, show: usaStripe },
    { to: '/notas', label: 'Notas (legado)', icon: FileText, show: true },
    { to: '/darfs', label: 'DARF', icon: ReceiptText, show: true },
  ].filter((item) => item.show)

  return (
    <div className="flex h-screen bg-light-secondary">
      <aside className="flex w-60 flex-col bg-dark text-white">
        <div className="flex items-center gap-2 p-5 border-b border-white/10">
          <ShieldCheck size={22} className="text-accent" />
          <div>
            <div className="font-bold">NFe Admin</div>
            <div className="text-xs text-white/50">Painel administrativo</div>
          </div>
        </div>
        <nav className="flex-1 p-3">
          {nav.map(({ to, label, icon: Icon }) => {
            const active = location.pathname.startsWith(to)
            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active ? 'bg-accent/20 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon size={16} />
                {label}
              </Link>
            )
          })}
        </nav>
        <div className="border-t border-white/10 p-3">
          <div className="mb-2 px-2 text-xs text-white/50 truncate">{email}</div>
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/5 hover:text-white"
          >
            <LogOut size={16} /> Sair
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <EmpresaTopBar />
        <div className="p-6">{children}</div>
      </main>
    </div>
  )
}

/**
 * Barra de "workspace ativo" — mostra qual empresa está selecionada com
 * uma cor derivada do nome (mesma lógica da splash `/selecionar-empresa`)
 * e um botão pra trocar. Não é mais um <select>, pra forçar a passagem
 * consciente pela splash e evitar troca acidental no meio do trabalho.
 */
function EmpresaTopBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { empresaAtual, clearEmpresa, loading } = useEmpresaAtual()

  // Tela /empresas é o CRUD global, não faz sentido o filtro de workspace.
  if (location.pathname.startsWith('/empresas')) return null

  if (loading) {
    return (
      <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-black/[0.06] bg-white px-6 py-2 text-xs text-muted">
        <Building2 size={14} /> Carregando empresa...
      </div>
    )
  }

  if (!empresaAtual) return null

  const cor = corDaEmpresa(empresaAtual.nome || empresaAtual.razao_social || empresaAtual.id)
  const ambiente = empresaAtual.ambiente_sefaz === 1 ? 'PROD' : empresaAtual.ambiente_sefaz === 2 ? 'HOMOL' : null

  function trocar() {
    clearEmpresa()
    navigate('/selecionar-empresa')
  }

  return (
    <div
      className="sticky top-0 z-30 flex items-center gap-3 border-b px-6 py-2 shadow-sm backdrop-blur"
      style={{ background: cor.bg, borderColor: cor.bar }}
    >
      <div
        className="flex h-7 w-7 items-center justify-center rounded-lg"
        style={{ background: cor.bar, color: '#fff' }}
      >
        <Building2 size={14} />
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-[10px] uppercase tracking-wide" style={{ color: cor.fg, opacity: 0.7 }}>
          Empresa ativa
        </span>
        <span className="text-sm font-bold" style={{ color: cor.fg }}>
          {empresaAtual.nome || empresaAtual.razao_social}
        </span>
      </div>
      {ambiente && (
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
            empresaAtual.ambiente_sefaz === 1
              ? 'bg-emerald-600 text-white'
              : 'bg-amber-500 text-white'
          }`}
        >
          {ambiente}
        </span>
      )}
      <div className="flex-1" />
      <button
        onClick={trocar}
        className="flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1 text-xs font-medium shadow-sm hover:shadow"
        style={{ borderColor: cor.bar, color: cor.fg }}
      >
        <Repeat size={12} />
        Trocar empresa
      </button>
    </div>
  )
}

/**
 * Mesma função usada no `SelecionarEmpresa.tsx` — duplicada de propósito
 * pra não criar uma dependência cruzada só por causa de uma constante de
 * 6 cores. Se mudar uma, mudar a outra.
 */
function corDaEmpresa(seed: string): { bar: string; bg: string; fg: string } {
  let hash = 5381
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) >>> 0
  }
  const paletas = [
    { bar: '#0ea5e9', bg: '#e0f2fe', fg: '#0369a1' },
    { bar: '#10b981', bg: '#d1fae5', fg: '#047857' },
    { bar: '#8b5cf6', bg: '#ede9fe', fg: '#6d28d9' },
    { bar: '#f59e0b', bg: '#fef3c7', fg: '#b45309' },
    { bar: '#ec4899', bg: '#fce7f3', fg: '#be185d' },
    { bar: '#06b6d4', bg: '#cffafe', fg: '#0e7490' },
  ]
  return paletas[hash % paletas.length]
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [logged, setLogged] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setLogged(!!data.session)
      setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_ev, session) => {
      setLogged(!!session)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  if (loading) return <div className="flex h-screen items-center justify-center text-muted">Carregando...</div>
  if (!logged) return <Navigate to="/login" replace />
  return <EmpresaProvider>{children}</EmpresaProvider>
}

/**
 * Wrapper que garante uma empresa selecionada antes de renderizar a tela.
 * Se o `empresaContext` está sem `empresaId` (primeiro login ou após
 * clicar "Trocar empresa"), manda pra splash `/selecionar-empresa`.
 *
 * A página `/empresas` é exceção — é onde o usuário cadastra a primeira
 * empresa, então não pode exigir empresa selecionada (chicken & egg).
 */
function RequireEmpresa({ children }: { children: React.ReactNode }) {
  const { empresaId, empresas, loading } = useEmpresaAtual()
  if (loading) {
    return <div className="flex h-screen items-center justify-center text-muted">Carregando empresa...</div>
  }
  // Sem nenhuma empresa cadastrada — manda criar a primeira.
  if (empresas.length === 0) return <Navigate to="/empresas" replace />
  // Tem empresas mas nenhuma selecionada — splash.
  if (!empresaId) return <Navigate to="/selecionar-empresa" replace />
  return <Layout>{children}</Layout>
}

/** Igual ao RequireEmpresa mas sem exigir empresa — pra /empresas e /selecionar-empresa. */
function SemEmpresa({ children, layout = true }: { children: React.ReactNode; layout?: boolean }) {
  if (layout) return <Layout>{children}</Layout>
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/selecionar-empresa"
        element={
          <RequireAuth>
            <SemEmpresa layout={false}>
              <SelecionarEmpresa />
            </SemEmpresa>
          </RequireAuth>
        }
      />
      <Route
        path="/empresas"
        element={
          <RequireAuth>
            <SemEmpresa>
              <Empresas />
            </SemEmpresa>
          </RequireAuth>
        }
      />
      <Route
        path="/empresas/:id"
        element={
          <RequireAuth>
            <SemEmpresa>
              <EmpresaDetalhe />
            </SemEmpresa>
          </RequireAuth>
        }
      />
      <Route path="/clientes" element={<RequireAuth><RequireEmpresa><Clientes /></RequireEmpresa></RequireAuth>} />
      <Route path="/produtos" element={<RequireAuth><RequireEmpresa><Produtos /></RequireEmpresa></RequireAuth>} />
      <Route path="/vendas" element={<RequireAuth><RequireEmpresa><Vendas /></RequireEmpresa></RequireAuth>} />
      <Route path="/fiscal" element={<RequireAuth><RequireEmpresa><Fiscal /></RequireEmpresa></RequireAuth>} />
      <Route path="/notas" element={<RequireAuth><RequireEmpresa><Notas /></RequireEmpresa></RequireAuth>} />
      <Route path="/nfse" element={<RequireAuth><RequireEmpresa><Nfse /></RequireEmpresa></RequireAuth>} />
      <Route path="/nfe" element={<RequireAuth><RequireEmpresa><Nfe /></RequireEmpresa></RequireAuth>} />
      <Route path="/integracoes/ticto" element={<RequireAuth><RequireEmpresa><IntegracoesTicto /></RequireEmpresa></RequireAuth>} />
      <Route path="/integracoes/stripe" element={<RequireAuth><RequireEmpresa><IntegracoesStripe /></RequireEmpresa></RequireAuth>} />
      <Route path="/darfs" element={<RequireAuth><RequireEmpresa><Darfs /></RequireEmpresa></RequireAuth>} />
      <Route path="*" element={<Navigate to="/selecionar-empresa" replace />} />
    </Routes>
  )
}
