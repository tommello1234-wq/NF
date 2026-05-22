/**
 * Painel reutilizável para a aba "Log" de Produtos/Clientes.
 *
 * Lista entradas do audit_log com filtro de busca + botão Reverter
 * com modal de confirmação.
 */

import { useEffect, useState } from 'react'
import { CheckCircle2, History, RefreshCw, RotateCcw, Search, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { apiGet, apiPost } from '../lib/api'

interface LogEntry {
  id: string
  empresa_id: string
  entidade: 'produto' | 'cliente'
  entidade_id: string | null
  tipo_acao: string
  descricao: string
  payload_antes: Record<string, unknown> | null
  payload_depois: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  reversivel: boolean
  revertida: boolean
  revertida_em: string | null
  created_at: string
}

interface Props {
  empresaId: string
  entidade: 'produto' | 'cliente'
  /** Disparado quando o user reverte algo (pra recarregar a lista principal). */
  onReverter?: () => void
}

const ACAO_LABELS: Record<string, { label: string; cor: string }> = {
  arquivar: { label: 'Arquivado', cor: 'bg-warning-bg text-warning-dark' },
  desarquivar: { label: 'Restaurado', cor: 'bg-success-bg text-success' },
  ativar: { label: 'Ativado', cor: 'bg-success-bg text-success' },
  desativar: { label: 'Desativado', cor: 'bg-neutral-100 text-neutral-700' },
  importar_massa: { label: 'Importação em massa', cor: 'bg-info-bg text-info' },
  criar: { label: 'Criado', cor: 'bg-success-bg text-success' },
  editar: { label: 'Editado', cor: 'bg-info-bg text-info' },
  excluir: { label: 'Excluído', cor: 'bg-error-bg text-error' },
  // Ações em lote
  lote_ativar: { label: 'Lote: ativados', cor: 'bg-success-bg text-success' },
  lote_desativar: { label: 'Lote: desativados', cor: 'bg-neutral-100 text-neutral-700' },
  lote_arquivar: { label: 'Lote: arquivados', cor: 'bg-warning-bg text-warning-dark' },
  lote_desarquivar: { label: 'Lote: restaurados', cor: 'bg-success-bg text-success' },
  lote_remover: { label: 'Lote: removidos', cor: 'bg-error-bg text-error' },
}

function tagAcao(tipo: string) {
  return ACAO_LABELS[tipo] || { label: tipo, cor: 'bg-neutral-100 text-neutral-700' }
}

export default function AuditLogPanel({ empresaId, entidade, onReverter }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [alvoReverter, setAlvoReverter] = useState<LogEntry | null>(null)
  const [revertendo, setRevertendo] = useState(false)

  async function carregar() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ empresa_id: empresaId, entidade })
      if (busca.trim()) params.set('busca', busca.trim())
      const data = await apiGet<LogEntry[]>(`/admin/audit-log?${params.toString()}`)
      setLogs(data)
    } catch (err) {
      toast.error('Erro ao carregar log', { description: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, entidade])

  async function confirmarReverter() {
    if (!alvoReverter) return
    setRevertendo(true)
    try {
      await apiPost(`/admin/audit-log/${alvoReverter.id}/reverter`)
      toast.success('Ação revertida com sucesso')
      setAlvoReverter(null)
      await carregar()
      if (onReverter) onReverter()
    } catch (err) {
      toast.error('Erro ao reverter', { description: (err as Error).message })
    } finally {
      setRevertendo(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Header de busca */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <History size={18} className="text-muted" />
          <h3 className="text-sm font-semibold text-dark">
            Histórico de ações ({entidade === 'produto' ? 'Produtos' : 'Clientes'})
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && carregar()}
              placeholder="Buscar por descrição..."
              className="rounded-lg border border-black/[0.08] bg-white py-1.5 pl-7 pr-3 text-xs"
            />
          </div>
          <button
            onClick={carregar}
            className="inline-flex items-center gap-1 rounded-lg border border-black/[0.08] bg-white px-2.5 py-1.5 text-xs hover:bg-light-secondary"
          >
            <RefreshCw size={12} /> Atualizar
          </button>
        </div>
      </div>

      {/* Tabela */}
      <section className="overflow-hidden rounded-lg border border-black/[0.06] bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/[0.06]">
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Data</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Ação</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Descrição</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">Carregando...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-muted">
                Nenhuma ação registrada ainda. Crie/edite/arquive algo pra começar.
              </td></tr>
            ) : logs.map((log) => {
              const t = tagAcao(log.tipo_acao)
              const data = new Date(log.created_at)
              const dataStr = data.toLocaleDateString('pt-BR') + ' ' + data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
              return (
                <tr key={log.id} className="border-b border-black/[0.04] hover:bg-light-secondary">
                  <td className="px-4 py-3 text-xs text-muted-dark">{dataStr}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.cor}`}>
                      {t.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">{log.descricao}</td>
                  <td className="px-4 py-3">
                    {log.revertida ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600">
                        <XCircle size={11} /> Revertida
                      </span>
                    ) : log.reversivel ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] text-success">
                        <CheckCircle2 size={11} /> Pode reverter
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-muted">
                        Não reversível
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {log.reversivel && !log.revertida && (
                      <button
                        onClick={() => setAlvoReverter(log)}
                        className="inline-flex items-center gap-1 rounded-lg border border-warning/30 bg-warning/5 px-2.5 py-1 text-xs text-warning-dark hover:bg-warning/10"
                        title="Desfazer essa ação"
                      >
                        <RotateCcw size={13} /> Reverter
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {/* Modal de confirmação */}
      {alvoReverter && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !revertendo && setAlvoReverter(null)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-black/[0.06] p-5">
              <h3 className="font-semibold text-dark">Reverter ação?</h3>
              <p className="mt-2 text-sm text-muted">
                Você está prestes a desfazer:
              </p>
              <div className="mt-2 rounded-lg bg-light-secondary p-3 text-sm">
                <div className="font-medium text-dark">{alvoReverter.descricao}</div>
                <div className="mt-1 text-xs text-muted">
                  Registrado em {new Date(alvoReverter.created_at).toLocaleString('pt-BR')}
                </div>
              </div>
              <p className="mt-3 text-xs text-muted">
                Essa operação criará uma nova entrada no log para você poder reverter de volta se mudar de ideia.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-black/[0.06] bg-light-secondary/40 p-3">
              <button
                onClick={() => setAlvoReverter(null)}
                disabled={revertendo}
                className="rounded-lg border border-black/[0.08] bg-white px-4 py-2 text-sm disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarReverter}
                disabled={revertendo}
                className="inline-flex items-center gap-2 rounded-lg bg-warning px-4 py-2 text-sm font-semibold text-white hover:bg-warning/90 disabled:opacity-50"
              >
                <RotateCcw size={14} /> {revertendo ? 'Revertendo...' : 'Sim, reverter'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
