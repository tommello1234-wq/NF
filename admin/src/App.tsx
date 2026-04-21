import { useEffect, useState } from 'react'
import { Routes, Route, Link, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Building2, ShieldCheck, FileText, LogOut } from 'lucide-react'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Empresas from './pages/Empresas'
import EmpresaDetalhe from './pages/EmpresaDetalhe'
import Notas from './pages/Notas'

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
    { to: '/notas', label: 'Notas Emitidas', icon: FileText },
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
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
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
  return <Layout>{children}</Layout>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/empresas" element={<RequireAuth><Empresas /></RequireAuth>} />
      <Route path="/empresas/:id" element={<RequireAuth><EmpresaDetalhe /></RequireAuth>} />
      <Route path="/notas" element={<RequireAuth><Notas /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/empresas" replace />} />
    </Routes>
  )
}
