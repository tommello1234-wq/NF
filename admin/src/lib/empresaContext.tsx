import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react'
import { apiGet } from './api'
import type { EmpresaCampos } from './camposPendentes'

export interface EmpresaResumo extends EmpresaCampos {
  id: string
  nome: string
  razao_social: string
  cnpj: string
  ambiente_sefaz?: number
}

interface EmpresaCtx {
  empresas: EmpresaResumo[]
  empresaId: string
  empresaAtual?: EmpresaResumo
  loading: boolean
  setEmpresaId: (id: string) => void
  clearEmpresa: () => void
  reload: () => Promise<void>
}

const STORAGE_KEY = 'nfe_admin_empresa_id'
const Ctx = createContext<EmpresaCtx | null>(null)

export function EmpresaProvider({ children }: { children: ReactNode }) {
  const [empresas, setEmpresas] = useState<EmpresaResumo[]>([])
  const [empresaId, setEmpresaIdState] = useState<string>(() => localStorage.getItem(STORAGE_KEY) || '')
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await apiGet<EmpresaResumo[]>('/admin/empresas')
      setEmpresas(list)
      const saved = localStorage.getItem(STORAGE_KEY) || ''
      // Mantém escolha do usuário se ainda for válida. Não auto-seleciona
      // a primeira empresa — a tela /selecionar-empresa cuida disso pra
      // forçar uma decisão consciente e isolar workspaces por empresa.
      const valido = saved && list.some((e) => e.id === saved)
      if (!valido && saved) {
        localStorage.removeItem(STORAGE_KEY)
        setEmpresaIdState('')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload().catch(() => {})
  }, [reload])

  // Sincroniza com outras abas do mesmo navegador.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY && e.newValue && e.newValue !== empresaId) {
        setEmpresaIdState(e.newValue)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [empresaId])

  const setEmpresaId = useCallback((id: string) => {
    setEmpresaIdState(id)
    localStorage.setItem(STORAGE_KEY, id)
  }, [])

  const clearEmpresa = useCallback(() => {
    setEmpresaIdState('')
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  const empresaAtual = empresas.find((e) => e.id === empresaId)

  return (
    <Ctx.Provider value={{ empresas, empresaId, empresaAtual, loading, setEmpresaId, clearEmpresa, reload }}>
      {children}
    </Ctx.Provider>
  )
}

export function useEmpresaAtual(): EmpresaCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useEmpresaAtual chamado fora de EmpresaProvider')
  return ctx
}
