import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'

/**
 * Tela de definir senha — o destino do link "Reset Password" do Supabase.
 *
 * O painel não tinha isso: os usuários são criados na mão no Supabase Auth, e
 * quem esquecia a senha não tinha caminho de volta. O e-mail de recuperação
 * chega com a sessão no fragmento da URL (#access_token=...&type=recovery); o
 * App captura esse fragmento e manda pra cá já autenticado. Aqui a pessoa só
 * escolhe a senha nova.
 *
 * Quem digita a senha é sempre o dono da conta — o painel nunca recebe nem
 * mostra senha de ninguém.
 */
export default function DefinirSenha() {
  const navigate = useNavigate()
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [temSessao, setTemSessao] = useState<boolean | null>(null)

  // A sessão pode ainda estar sendo montada a partir do fragmento da URL —
  // por isso escuta em vez de decidir na primeira leitura.
  useEffect(() => {
    let vivo = true
    supabase.auth.getSession().then(({ data }) => {
      if (vivo && data.session) setTemSessao(true)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_ev, session) => {
      if (vivo && session) setTemSessao(true)
    })
    const limite = setTimeout(() => {
      if (vivo) setTemSessao((atual) => (atual === null ? false : atual))
    }, 6000)
    return () => {
      vivo = false
      listener.subscription.unsubscribe()
      clearTimeout(limite)
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (senha !== confirmacao) {
      toast.error('As senhas não coincidem')
      return
    }
    if (senha.length < 8) {
      toast.error('A senha precisa ter pelo menos 8 caracteres')
      return
    }
    setSalvando(true)
    const { error } = await supabase.auth.updateUser({ password: senha })
    setSalvando(false)
    if (error) {
      toast.error('Não foi possível salvar a senha', { description: error.message })
      return
    }
    toast.success('Senha definida — você já está dentro')
    navigate('/selecionar-empresa', { replace: true })
  }

  if (temSessao === null) {
    return (
      <div className="flex h-screen items-center justify-center text-muted">
        Validando o link...
      </div>
    )
  }

  // Link velho, já usado, ou expirado (o padrão do Supabase é 1 hora).
  if (temSessao === false) {
    return (
      <div className="flex h-screen items-center justify-center bg-light-secondary p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <h1 className="mb-2 text-lg font-bold text-dark">Link inválido ou expirado</h1>
          <p className="mb-5 text-sm text-muted">
            Links de recuperação valem por 1 hora e só podem ser usados uma vez. Peça um novo
            e-mail de recuperação e abra o link mais recente.
          </p>
          <button
            onClick={() => navigate('/login', { replace: true })}
            className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            Voltar ao login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen items-center justify-center bg-light-secondary p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10">
            <KeyRound size={24} className="text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-dark">Definir senha</h1>
            <p className="text-sm text-muted">Escolha a senha de acesso ao painel</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-dark">Nova senha</label>
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
              autoFocus
              minLength={8}
              className="w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
            <p className="mt-1 text-xs text-muted">Pelo menos 8 caracteres.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-dark">
              Repita a senha
            </label>
            <input
              type="password"
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              required
              minLength={8}
              className="w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </div>
          <button
            type="submit"
            disabled={salvando}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {salvando ? 'Salvando...' : 'Salvar e entrar'}
          </button>
        </div>
      </form>
    </div>
  )
}
