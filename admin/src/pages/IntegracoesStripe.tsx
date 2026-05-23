import { useEffect, useState } from 'react'
import { Check, Copy, CreditCard, Edit2, Plus, RefreshCw, Save, Sparkles, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/api'
import { useEmpresaAtual } from '../lib/empresaContext'

interface Servico {
  id: string
  descricao: string
  codigo_lc116: string | null
  ativo: boolean
}

interface Mapeamento {
  id: string
  empresa_id: string
  stripe_price_id: string
  produto_id: string
  valor_unitario_override: string | number | null
  ativo: boolean
  created_at: string
  produtos?: { id: string; descricao: string; codigo_lc116: string | null; ativo: boolean } | null
}

interface StripeConfig {
  empresa_id: string
  empresa_nome: string
  secret_configurado: boolean
  webhook_path: string
  produto_default_id: string | null
  produto_default: { id: string; descricao: string; codigo_lc116: string | null; aliquota_iss?: number | null; ativo: boolean } | null
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

// URL pública pra Stripe chamar — em prod usa o origin atual; em dev aponta
// direto pro backend Fastify em localhost:3001.
const PUBLIC_BASE = import.meta.env.PROD
  ? (typeof window !== 'undefined' ? window.location.origin : '')
  : 'http://localhost:3001'

function dateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString('pt-BR') : '-'
}

function money(value: unknown) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))
}

export default function IntegracoesStripe() {
  const { empresaId } = useEmpresaAtual()
  const [config, setConfig] = useState<StripeConfig | null>(null)
  const [secretInput, setSecretInput] = useState('')
  const [savingSecret, setSavingSecret] = useState(false)
  const [showSecret, setShowSecret] = useState(false)

  const [servicos, setServicos] = useState<Servico[]>([])
  const [mapeamentos, setMapeamentos] = useState<Mapeamento[]>([])
  const [eventos, setEventos] = useState<WebhookEvent[]>([])

  const [defaultProdutoSelect, setDefaultProdutoSelect] = useState('')
  const [savingDefault, setSavingDefault] = useState(false)

  const [showMapModal, setShowMapModal] = useState(false)
  const [mapForm, setMapForm] = useState<{ id?: string; stripe_price_id: string; produto_id: string; valor_unitario_override: number | string; ativo: boolean }>({
    stripe_price_id: '',
    produto_id: '',
    valor_unitario_override: '',
    ativo: true,
  })
  const [savingMap, setSavingMap] = useState(false)

  const webhookUrl = config ? `${PUBLIC_BASE}${config.webhook_path}` : ''

  useEffect(() => {
    if (empresaId) loadAll(empresaId)
    else {
      setConfig(null)
      setServicos([])
      setMapeamentos([])
      setEventos([])
    }
  }, [empresaId])

  async function loadAll(id: string) {
    try {
      const [cfg, srvs, maps, evts] = await Promise.all([
        apiGet<StripeConfig>(`/admin/empresas/${id}/stripe-config`),
        apiGet<Servico[]>(`/admin/produtos?empresa_id=${id}&tipo=servico&ativo=true`),
        apiGet<Mapeamento[]>(`/admin/stripe-mapeamento?empresa_id=${id}`).catch(() => []),
        apiGet<WebhookEvent[]>(`/admin/webhook-events?empresa_id=${id}&provider=stripe`).catch(() => []),
      ])
      setConfig(cfg)
      setServicos(srvs)
      setMapeamentos(maps)
      setEventos(evts)
      setDefaultProdutoSelect(cfg.produto_default_id || '')
    } catch (err) {
      toast.error('Erro ao carregar', { description: (err as Error).message })
    }
  }

  async function salvarProdutoDefault() {
    if (!empresaId) return
    setSavingDefault(true)
    try {
      await apiPost(`/admin/empresas/${empresaId}/stripe-produto-default`, {
        produto_id: defaultProdutoSelect || null,
      })
      toast.success(defaultProdutoSelect ? 'Produto padrão salvo' : 'Produto padrão removido')
      const cfg = await apiGet<StripeConfig>(`/admin/empresas/${empresaId}/stripe-config`)
      setConfig(cfg)
      setDefaultProdutoSelect(cfg.produto_default_id || '')
    } catch (err) {
      toast.error('Erro ao salvar produto padrão', { description: (err as Error).message })
    } finally {
      setSavingDefault(false)
    }
  }

  async function salvarSecret() {
    if (!empresaId) return
    const trimmed = secretInput.trim()
    if (trimmed && !trimmed.startsWith('whsec_')) {
      toast.warning('Stripe secrets começam com "whsec_". Confira o valor copiado.')
      return
    }
    setSavingSecret(true)
    try {
      await apiPost(`/admin/empresas/${empresaId}/stripe-secret`, { secret: trimmed })
      toast.success(trimmed ? 'Webhook secret salvo' : 'Webhook secret removido')
      setSecretInput('')
      const cfg = await apiGet<StripeConfig>(`/admin/empresas/${empresaId}/stripe-config`)
      setConfig(cfg)
    } catch (err) {
      toast.error('Erro ao salvar secret', { description: (err as Error).message })
    } finally {
      setSavingSecret(false)
    }
  }

  function copyWebhook() {
    if (!webhookUrl) return
    navigator.clipboard.writeText(webhookUrl)
    toast.success('URL copiada')
  }

  function openNewMap() {
    setMapForm({ stripe_price_id: '', produto_id: '', valor_unitario_override: '', ativo: true })
    setShowMapModal(true)
  }

  function openEditMap(m: Mapeamento) {
    setMapForm({
      id: m.id,
      stripe_price_id: m.stripe_price_id,
      produto_id: m.produto_id,
      valor_unitario_override: m.valor_unitario_override ? Number(m.valor_unitario_override) : '',
      ativo: m.ativo,
    })
    setShowMapModal(true)
  }

  async function saveMap() {
    if (!empresaId) return
    if (!mapForm.stripe_price_id.trim() || !mapForm.produto_id) {
      toast.warning('Preencha price_id Stripe e selecione o serviço')
      return
    }
    if (!mapForm.stripe_price_id.trim().startsWith('price_')) {
      toast.warning('Stripe price IDs começam com "price_". Confira o valor.')
      return
    }
    setSavingMap(true)
    try {
      const payload = {
        empresa_id: empresaId,
        stripe_price_id: mapForm.stripe_price_id.trim(),
        produto_id: mapForm.produto_id,
        valor_unitario_override:
          mapForm.valor_unitario_override === '' || mapForm.valor_unitario_override == null
            ? null
            : Number(mapForm.valor_unitario_override),
        ativo: mapForm.ativo,
      }
      if (mapForm.id) await apiPatch(`/admin/stripe-mapeamento/${mapForm.id}`, payload)
      else await apiPost('/admin/stripe-mapeamento', payload)
      toast.success(mapForm.id ? 'Mapeamento atualizado' : 'Mapeamento criado')
      setShowMapModal(false)
      const maps = await apiGet<Mapeamento[]>(`/admin/stripe-mapeamento?empresa_id=${empresaId}`)
      setMapeamentos(maps)
    } catch (err) {
      toast.error('Erro ao salvar mapeamento', { description: (err as Error).message })
    } finally {
      setSavingMap(false)
    }
  }

  async function removeMap(m: Mapeamento) {
    if (!confirm(`Remover mapeamento Stripe price_id=${m.stripe_price_id}?`)) return
    try {
      await apiDelete(`/admin/stripe-mapeamento/${m.id}`)
      toast.success('Mapeamento removido')
      const maps = await apiGet<Mapeamento[]>(`/admin/stripe-mapeamento?empresa_id=${empresaId}`)
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
            <CreditCard size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">Integração Stripe</h1>
            <p className="text-sm text-muted">Webhook automático: invoice.payment_succeeded → emite NFS-e</p>
          </div>
        </div>
        <button
          onClick={() => empresaId && loadAll(empresaId)}
          className="inline-flex items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-4 py-2 text-sm hover:bg-light-secondary"
        >
          <RefreshCw size={14} /> Atualizar
        </button>
      </div>

      {/* Configuração URL + Secret */}
      <section className="rounded-lg border border-black/[0.06] bg-white p-5">
        <h2 className="mb-3 font-semibold text-dark">Configuração no Stripe Dashboard</h2>
        <div className="space-y-3 text-sm">
          <div>
            <div className={label}>URL do webhook (cole no Stripe Dashboard → Developers → Webhooks → Add endpoint)</div>
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
              Evento mínimo: <strong>invoice.payment_succeeded</strong> (assinatura paga, incluindo renovação automática). Opcionais úteis: <em>invoice.payment_failed</em>, <em>charge.refunded</em>.
            </p>
          </div>

          <div>
            <div className={label}>Signing Secret (whsec_...)</div>
            <div className="flex items-center gap-2">
              {config?.secret_configurado && !secretInput && (
                <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-3 py-1 text-xs font-semibold text-success">
                  <Check size={12} /> Secret configurado
                </span>
              )}
              <input
                className={input}
                type={showSecret ? 'text' : 'password'}
                value={secretInput}
                onChange={(ev) => setSecretInput(ev.target.value)}
                placeholder={config?.secret_configurado ? 'Cole novo secret pra substituir' : 'whsec_...'}
              />
              <button
                onClick={() => setShowSecret((v) => !v)}
                className="rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-xs hover:bg-light-secondary"
              >
                {showSecret ? 'Ocultar' : 'Mostrar'}
              </button>
              <button
                onClick={salvarSecret}
                disabled={savingSecret || !secretInput.trim()}
                className="inline-flex items-center gap-1 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
              >
                <Save size={12} /> {savingSecret ? 'Salvando…' : 'Salvar secret'}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              O secret é cifrado (AES-256-GCM) antes de ser salvo. Stripe gera ele quando você cria o webhook endpoint — só é mostrado uma vez logo após criar.
            </p>
          </div>
        </div>
      </section>

      {/* Produto padrão (fallback) — economia de cadastro pra empresa que vende um tipo só */}
      <section className="rounded-lg border border-accent/30 bg-accent/[0.04] p-5">
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <Sparkles size={18} />
          </div>
          <div>
            <h2 className="font-semibold text-dark">Produto padrão (recomendado pra SaaS)</h2>
            <p className="text-xs text-muted-dark">
              Se você vende um único tipo de serviço (ex: assinatura SaaS / licenciamento), configure o produto padrão aqui e <strong>nunca mais precisa cadastrar price_id manualmente</strong>. Qualquer payment link novo da Stripe vai usar esse produto automaticamente. Mapeamentos explícitos abaixo continuam tendo prioridade.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[260px]">
            <label className={label}>Produto padrão pra invoices sem mapeamento explícito</label>
            <select
              className={input}
              value={defaultProdutoSelect}
              onChange={(ev) => setDefaultProdutoSelect(ev.target.value)}
              disabled={servicos.length === 0}
            >
              <option value="">— nenhum (rejeitar invoice sem mapeamento) —</option>
              {servicos.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.descricao} {s.codigo_lc116 ? `· LC116 ${s.codigo_lc116}` : '· SEM LC116!'}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={salvarProdutoDefault}
            disabled={savingDefault || defaultProdutoSelect === (config?.produto_default_id || '')}
            className="inline-flex items-center gap-1 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
          >
            <Save size={14} /> {savingDefault ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
        {config?.produto_default && (
          <div className="mt-3 flex items-center gap-2 text-xs text-success">
            <Check size={12} />
            <span>
              Configurado: <strong>{config.produto_default.descricao}</strong>
              {config.produto_default.codigo_lc116 && ` · LC116 ${config.produto_default.codigo_lc116}`}
              {' '}— qualquer payment link Stripe sem mapeamento explícito vai usar esse.
            </span>
          </div>
        )}
        {servicos.length === 0 && (
          <p className="mt-3 text-xs text-warning">
            Cadastre pelo menos um <strong>serviço</strong> em /produtos antes de configurar o produto padrão.
          </p>
        )}
      </section>

      {/* Mapeamento price_id → serviço */}
      <section className="rounded-lg border border-black/[0.06] bg-white">
        <div className="flex items-center justify-between border-b border-black/[0.06] p-5">
          <div>
            <h2 className="font-semibold text-dark">Mapeamento Stripe price_id → serviço (opcional)</h2>
            <p className="text-xs text-muted">Só precisa cadastrar aqui se algum price_id específico tem que sair com serviço/LC 116 diferente do padrão acima.</p>
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
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Stripe price_id</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Serviço</th>
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
                <td className="px-4 py-3 font-mono text-xs">{m.stripe_price_id}</td>
                <td className="px-4 py-3">
                  <div className="font-medium text-dark">{m.produtos?.descricao || '-'}</div>
                  <div className="text-xs text-muted">LC 116: {m.produtos?.codigo_lc116 || '— sem LC 116 cadastrado'}</div>
                </td>
                <td className="px-4 py-3">{m.valor_unitario_override ? money(m.valor_unitario_override) : <span className="text-muted">usar valor pago no invoice</span>}</td>
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
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Stripe event ID</th>
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
                <label className={label}>Stripe price_id</label>
                <input
                  className={input}
                  value={mapForm.stripe_price_id}
                  onChange={(ev) => setMapForm((f) => ({ ...f, stripe_price_id: ev.target.value }))}
                  placeholder="price_1ABCxyz..."
                />
                <p className="mt-1 text-[11px] text-muted">Encontra no Stripe Dashboard → Products → seu produto → Pricing. Começa com <code>price_</code>.</p>
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
                <label className={label}>Override de valor (R$) — deixe vazio pra usar amount_paid do invoice</label>
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
