import { useEffect, useState } from 'react'
import { Routes, Route, Link, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Building2, ShieldCheck, FileSignature, FileText, LogOut, Package, Plug, ReceiptText, Settings2, ShoppingCart, Users } from 'lucide-react'
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

function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email || null))
  }, [])

  async function logout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const nav = [
    { to: '/empresas', label: 'Empresas', icon: Building2 },
    { to: '/clientes', label: 'Clientes', icon: Users },
    { to: '/produtos', label: 'Produtos & Serviços', icon: Package },
    { to: '/vendas', label: 'Vendas (NFC-e auto)', icon: ShoppingCart },
    { to: '/fiscal', label: 'Fiscal', icon: Settings2 },
    { to: '/nfse', label: 'NFS-e', icon: FileSignature },
    { to: '/nfe', label: 'NF-e / NFC-e', icon: FileText },
    { to: '/integracoes/ticto', label: 'Integração Ticto', icon: Plug },
    { to: '/notas', label: 'Notas (legado)', icon: FileText },
    { to: '/darfs', label: 'DARF', icon: ReceiptText },
  ]

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

function EmpresaTopBar() {
  const location = useLocation()
  const { empresas, empresaId, setEmpresaId, loading } = useEmpresaAtual()
  // Telas que não fazem sentido o filtro global (já mostram tudo ou já têm um detalhe específico).
  if (location.pathname.startsWith('/empresas')) return null

  return (
    <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-accent/20 bg-accent/10 px-6 py-2 shadow-sm backdrop-blur">
      <Building2 size={14} className="text-accent" />
      <span className="text-xs font-medium text-muted-dark">Empresa selecionada:</span>
      <select
        value={empresaId}
        onChange={(e) => setEmpresaId(e.target.value)}
        disabled={loading || empresas.length === 0}
        className="rounded-md border border-accent/30 bg-white px-2 py-1 text-sm font-medium text-dark focus:outline-none focus:ring-2 focus:ring-accent/50"
      >
        {empresas.length === 0 && <option value="">— sem empresas cadastradas —</option>}
        {empresas.map((e) => (
          <option key={e.id} value={e.id}>
            {e.nome || e.razao_social}
          </option>
        ))}
      </select>
      <span className="text-[11px] text-muted-dark/80">
        compartilhada com todas as outras abas — trocar aqui afeta clientes, produtos, NF-e, etc.
      </span>
    </div>
  )
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
  return (
    <EmpresaProvider>
      <Layout>{children}</Layout>
    </EmpresaProvider>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/empresas" element={<RequireAuth><Empresas /></RequireAuth>} />
      <Route path="/empresas/:id" element={<RequireAuth><EmpresaDetalhe /></RequireAuth>} />
      <Route path="/clientes" element={<RequireAuth><Clientes /></RequireAuth>} />
      <Route path="/produtos" element={<RequireAuth><Produtos /></RequireAuth>} />
      <Route path="/vendas" element={<RequireAuth><Vendas /></RequireAuth>} />
      <Route path="/fiscal" element={<RequireAuth><Fiscal /></RequireAuth>} />
      <Route path="/notas" element={<RequireAuth><Notas /></RequireAuth>} />
      <Route path="/nfse" element={<RequireAuth><Nfse /></RequireAuth>} />
      <Route path="/nfe" element={<RequireAuth><Nfe /></RequireAuth>} />
      <Route path="/integracoes/ticto" element={<RequireAuth><IntegracoesTicto /></RequireAuth>} />
      <Route path="/darfs" element={<RequireAuth><Darfs /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/empresas" replace />} />
    </Routes>
  )
}
