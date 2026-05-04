import { useEffect, useState } from 'react'
import { Check, Copy, Edit2, Plug, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/api'

interface Empresa {
  id: string
  nome: string
  cnpj: string
}

interface Servico {
  id: string
  descricao: string
  codigo_lc116: string | null
  ativo: boolean
}

interface Mapeamento {
  id: string
  empresa_id: string
  ticto_product_id: string
  produto_id: string
  valor_unitario_override: string | number | null
  ativo: boolean
  created_at: string
  produtos?: { id: string; descricao: string; codigo_lc116: string | null; ativo: boolean } | null
}

interface TictoConfig {
  empresa_id: string
  empresa_nome: string
  token_configurado: boolean
  webhook_path: string
}

interface WebhookEvent {
  id: string
  provider: string
  external_id: string
  event_type: string | null
  status: string
  erro: string | null
  recebido_em: string
  processado_em: string | null
  nota_fiscal_id: string | null
  payload: Record<string, unknown>
}

const API_URL = (import.meta.env.VITE_API_URL as string) || (import.meta.env.PROD ? '/api' : 'http://localhost:3001')

function dateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString('pt-BR') : '-'
}

function money(value: unknown) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))
}

export default function IntegracoesTicto() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaId, setEmpresaId] = useState('')
  const [config, setConfig] = useState<TictoConfig | null>(null)
  const [tokenInput, setTokenInput] = useState('')
  const [savingToken, setSavingToken] = useState(false)
  const [showToken, setShowToken] = useState(false)

  const [servicos, setServicos] = useState<Servico[]>([])
  const [mapeamentos, setMapeamentos] = useState<Mapeamento[]>([])
  const [eventos, setEventos] = useState<WebhookEvent[]>([])

  const [showMapModal, setShowMapModal] = useState(false)
  const [mapForm, setMapForm] = useState<{ id?: string; ticto_product_id: string; produto_id: string; valor_unitario_override: number | string; ativo: boolean }>({
    ticto_product_id: '',
    produto_id: '',
    valor_unitario_override: '',
    ativo: true,
  })
  const [savingMap, setSavingMap] = useState(false)

  const webhookUrl = config ? `${API_URL}${config.webhook_path}` : ''

  useEffect(() => {
    loadInitial()
  }, [])

  useEffect(() => {
    if (empresaId) loadAll(empresaId)
  }, [empresaId])

  async function loadInitial() {
    try {
      const data = await apiGet<Empresa[]>('/admin/empresas')
      setEmpresas(data)
      if (data[0]) setEmpresaId(data[0].id)
    } catch (err) {
      toast.error('Erro ao carregar empresas', { description: (err as Error).message })
    }
  }

  async function loadAll(id: string) {
    try {
      const [cfg, srvs, maps, evts] = await Promise.all([
        apiGet<TictoConfig>(`/admin/empresas/${id}/ticto-config`),
        apiGet<Servico[]>(`/admin/produtos?empresa_id=${id}&tipo=servico&ativo=true`),
        apiGet<Mapeamento[]>(`/admin/ticto-mapeamento?empresa_id=${id}`),
        apiGet<WebhookEvent[]>(`/admin/webhook-events?empresa_id=${id}&provider=ticto`),
      ])
      setConfig(cfg)
      setServicos(srvs)
      setMapeamentos(maps)
      setEventos(evts)
    } catch (err) {
      toast.error('Erro ao carregar', { description: (err as Error).message })
    }
  }

  async function salvarToken() {
    if (!empresaId) return
    setSavingToken(true)
    try {
      await apiPost(`/admin/empresas/${empresaId}/ticto-token`, { token: tokenInput.trim() })
      toast.success(tokenInput.trim() ? 'Token Ticto salvo' : 'Token Ticto removido')
      setTokenInput('')
      const cfg = await apiGet<TictoConfig>(`/admin/empresas/${empresaId}/ticto-config`)
      setConfig(cfg)
    } catch (err) {
      toast.error('Erro ao salvar token', { description: (err as Error).message })
    } finally {
      setSavingToken(false)
    }
  }

  function copyWebhook() {
    if (!webhookUrl) return
    navigator.clipboard.writeText(webhookUrl)
    toast.success('URL copiada')
  }

  function openNewMap() {
    setMapForm({ ticto_product_id: '', produto_id: '', valor_unitario_override: '', ativo: true })
    setShowMapModal(true)
  }

  function openEditMap(m: Mapeamento) {
    setMapForm({
      id: m.id,
      ticto_product_id: m.ticto_product_id,
      produto_id: m.produto_id,
      valor_unitario_override: m.valor_unitario_override ? Number(m.valor_unitario_override) : '',
      ativo: m.ativo,
    })
    setShowMapModal(true)
  }

  async function saveMap() {
    if (!empresaId) return
    if (!mapForm.ticto_product_id.trim() || !mapForm.produto_id) {
      toast.warning('Preencha product_id Ticto e selecione o serviço')
      return
    }
    setSavingMap(true)
    try {
      const payload = {
        empresa_id: empresaId,
        ticto_product_id: mapForm.ticto_product_id.trim(),
        produto_id: mapForm.produto_id,
        valor_unitario_override:
          mapForm.valor_unitario_override === '' || mapForm.valor_unitario_override == null
            ? null
            : Number(mapForm.valor_unitario_override),
        ativo: mapForm.ativo,
      }
      if (mapForm.id) await apiPatch(`/admin/ticto-mapeamento/${mapForm.id}`, payload)
      else await apiPost('/admin/ticto-mapeamento', payload)
      toast.success(mapForm.id ? 'Mapeamento atualizado' : 'Mapeamento criado')
      setShowMapModal(false)
      const maps = await apiGet<Mapeamento[]>(`/admin/ticto-mapeamento?empresa_id=${empresaId}`)
      setMapeamentos(maps)
    } catch (err) {
      toast.error('Erro ao salvar mapeamento', { description: (err as Error).message })
    } finally {
      setSavingMap(false)
    }
  }

  async function removeMap(m: Mapeamento) {
    if (!confirm(`Remover mapeamento Ticto product_id=${m.ticto_product_id}?`)) return
    try {
      await apiDelete(`/admin/ticto-mapeamento/${m.id}`)
      toast.success('Mapeamento removido')
      const maps = await apiGet<Mapeamento[]>(`/admin/ticto-mapeamento?empresa_id=${empresaId}`)
      setMapeamentos(maps)
    } catch (err) {
      toast.error('Erro ao remover', { description: (err as Error).message })
    }
  }

  const input = 'w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30'
  const label = 'mb-1 block text-xs font-medium text-muted-dark'

  function statusBadge(s: string) {
    if (s === 'processado') return <span className="rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-semibold text-success">processado</span>
    if (s === 'erro') return <span className="rounded-full bg-error/10 px-2 py-0.5 text-[11px] font-semibold text-error">erro</span>
    if (s === 'ignorado') return <span className="rounded-full bg-light-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-dark">ignorado</span>
    if (s === 'processando') return <span className="rounded-full bg-info-bg px-2 py-0.5 text-[11px] font-semibold text-info">processando</span>
    return <span className="rounded-full bg-light-secondary px-2 py-0.5 text-[11px] text-muted-dark">{s}</span>
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
            <Plug size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">Integração Ticto</h1>
            <p className="text-sm text-muted">Webhook automático: compra aprovada na Ticto → emite NFS-e</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className={input} value={empresaId} onChange={(ev) => setEmpresaId(ev.target.value)}>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>{e.nome}</option>
            ))}
          </select>
          <button
            onClick={() => empresaId && loadAll(empresaId)}
            className="inline-flex items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-4 py-2 text-sm hover:bg-light-secondary"
          >
            <RefreshCw size={14} /> Atualizar
          </button>
        </div>
      </div>

      {/* Configuração URL + Token */}
      <section className="rounded-lg border border-black/[0.06] bg-white p-5">
        <h2 className="mb-3 font-semibold text-dark">Configuração no painel da Ticto</h2>
        <div className="space-y-3 text-sm">
          <div>
            <div className={label}>URL do webhook (cole no painel da Ticto)</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded-lg border border-black/[0.08] bg-light-secondary px-3 py-2 font-mono text-xs">{webhookUrl || '—'}</code>
              <button
                onClick={copyWebhook}
                disabled={!webhookUrl}
                className="rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-xs hover:bg-light-secondary disabled:opacity-40"
              >
                <Copy size={14} />
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              Versão recomendada: <strong>2.0</strong> | Tipo: <strong>Postback</strong> | Eventos: marque pelo menos <em>Venda Realizada</em>, <em>Reembolso</em> e <em>Chargeback</em>
            </p>
          </div>

          <div>
            <div className={label}>Token de validação</div>
            <div className="flex items-center gap-2">
              {config?.token_configurado && !tokenInput && (
                <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-3 py-1 text-xs font-semibold text-success">
                  <Check size={12} /> Token configurado
                </span>
              )}
              <input
                className={input}
                type={showToken ? 'text' : 'password'}
                value={tokenInput}
                onChange={(ev) => setTokenInput(ev.target.value)}
                placeholder={config?.token_configurado ? 'Cole novo token pra substituir' : 'Cole o token do painel Ticto'}
              />
              <button
                onClick={() => setShowToken((v) => !v)}
                className="rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-xs hover:bg-light-secondary"
              >
                {showToken ? 'Ocultar' : 'Mostrar'}
              </button>
              <button
                onClick={salvarToken}
                disabled={savingToken || !tokenInput.trim()}
                className="inline-flex items-center gap-1 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
              >
                <Save size={12} /> {savingToken ? 'Salvando…' : 'Salvar token'}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              O token é cifrado (AES-256-GCM) antes de ser salvo. Pega ele no painel da Ticto após criar o webhook.
            </p>
          </div>
        </div>
      </section>

      {/* Mapeamento product_id → serviço */}
      <section className="rounded-lg border border-black/[0.06] bg-white">
        <div className="flex items-center justify-between border-b border-black/[0.06] p-5">
          <div>
            <h2 className="font-semibold text-dark">Mapeamento product_id Ticto → serviço</h2>
            <p className="text-xs text-muted">Cada produto Ticto precisa estar mapeado pra um serviço (com LC 116) cadastrado.</p>
          </div>
          <button
            onClick={openNewMap}
            disabled={servicos.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
          >
            <Plus size={14} /> Novo
          </button>
        </div>
        {servicos.length === 0 && (
          <div className="border-b border-black/[0.06] bg-warning-bg p-3 text-xs text-warning">
            Cadastre pelo menos um <strong>serviço</strong> em /produtos antes de mapear.
          </div>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/[0.06]">
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Ticto product_id</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Servico</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Override valor</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {mapeamentos.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">Nenhum mapeamento.</td></tr>
            ) : mapeamentos.map((m) => (
              <tr key={m.id} className="border-b border-black/[0.04] hover:bg-light-secondary">
                <td className="px-4 py-3 font-mono text-xs">{m.ticto_product_id}</td>
                <td className="px-4 py-3">
                  <div className="font-medium text-dark">{m.produtos?.descricao || '-'}</div>
                  <div className="text-xs text-muted">LC 116: {m.produtos?.codigo_lc116 || '— sem LC 116 cadastrado'}</div>
                </td>
                <td className="px-4 py-3">{m.valor_unitario_override ? money(m.valor_unitario_override) : <span className="text-muted">usar valor da Ticto</span>}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.ativo ? 'bg-success-bg text-success' : 'bg-light-secondary text-muted-dark'}`}>
                    {m.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openEditMap(m)} className="mr-2 rounded-lg border border-black/[0.08] p-2 hover:bg-white" title="Editar">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={() => removeMap(m)} className="rounded-lg border border-error/20 p-2 text-error hover:bg-error/5" title="Remover">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Histórico de eventos */}
      <section className="rounded-lg border border-black/[0.06] bg-white">
        <div className="border-b border-black/[0.06] p-5">
          <h2 className="font-semibold text-dark">Histórico de eventos recebidos (200 últimos)</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/[0.06]">
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Recebido</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Evento</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Status</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Transaction hash</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Erro</th>
            </tr>
          </thead>
          <tbody>
            {eventos.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">Nenhum evento recebido ainda.</td></tr>
            ) : eventos.map((ev) => (
              <tr key={ev.id} className="border-b border-black/[0.04] hover:bg-light-secondary">
                <td className="px-4 py-3 text-xs text-muted">{dateTime(ev.recebido_em)}</td>
                <td className="px-4 py-3 font-mono text-xs">{ev.event_type || '-'}</td>
                <td className="px-4 py-3">{statusBadge(ev.status)}</td>
                <td className="px-4 py-3 font-mono text-xs">{ev.external_id}</td>
                <td className="px-4 py-3 text-xs text-error">{ev.erro || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {showMapModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={() => !savingMap && setShowMapModal(false)}>
          <div className="w-full max-w-lg rounded-lg bg-white" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-black/[0.06] p-5">
              <h3 className="font-semibold text-dark">{mapForm.id ? 'Editar mapeamento' : 'Novo mapeamento'}</h3>
              <button onClick={() => setShowMapModal(false)}><X size={18} /></button>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <label className={label}>Ticto product_id</label>
                <input
                  className={input}
                  value={mapForm.ticto_product_id}
                  onChange={(ev) => setMapForm((f) => ({ ...f, ticto_product_id: ev.target.value }))}
                  placeholder="ex: 268"
                />
                <p className="mt-1 text-[11px] text-muted">No webhook da Ticto vem em <code>item.product_id</code></p>
              </div>
              <div>
                <label className={label}>Serviço (catálogo)</label>
                <select
                  className={input}
                  value={mapForm.produto_id}
                  onChange={(ev) => setMapForm((f) => ({ ...f, produto_id: ev.target.value }))}
                >
                  <option value="">Selecione</option>
                  {servicos.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.descricao} {s.codigo_lc116 ? `· LC116 ${s.codigo_lc116}` : '· SEM LC116!'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label}>Override de valor (R$) — deixe vazio pra usar valor da Ticto</label>
                <input
                  className={input}
                  type="number"
                  step="0.01"
                  min="0"
                  value={mapForm.valor_unitario_override}
                  onChange={(ev) => setMapForm((f) => ({ ...f, valor_unitario_override: ev.target.value }))}
                  placeholder="(opcional)"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-dark">
                <input
                  type="checkbox"
                  checked={mapForm.ativo}
                  onChange={(ev) => setMapForm((f) => ({ ...f, ativo: ev.target.checked }))}
                />
                Ativo (webhook só dispara emissão se ativo)
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-black/[0.06] bg-light-secondary/40 p-3">
              <button onClick={() => setShowMapModal(false)} className="rounded-lg border border-black/[0.08] bg-white px-4 py-2 text-sm">Cancelar</button>
              <button onClick={saveMap} disabled={savingMap} className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
                {savingMap ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
