import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate('/empresas')
    })
  }, [navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    setLoading(false)
    if (error) {
      toast.error('Erro no login', { description: error.message })
      return
    }
    navigate('/empresas')
  }

  return (
    <div className="flex h-screen items-center justify-center bg-light-secondary p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10">
            <ShieldCheck size={24} className="text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-dark">NFe Admin</h1>
            <p className="text-sm text-muted">Acesse o painel administrativo</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-dark">E-mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-dark">Senha</label>
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
              className="w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </div>

        <p className="mt-4 text-xs text-center text-muted">
          Usuários são criados manualmente no Supabase Auth do projeto NFe.
        </p>
      </form>
    </div>
  )
}
