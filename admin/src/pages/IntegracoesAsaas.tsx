import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Copy, KeyRound, Landmark, Play, RefreshCw, Save, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { apiGet, apiPost } from '../lib/api'
import { useEmpresaAtual } from '../lib/empresaContext'

interface Servico {
  id: string
  descricao: string
  codigo_lc116: string | null
  ativo: boolean
}

interface AsaasConfig {
  empresa_id: string
  empresa_nome: string
  token_configurado: boolean
  api_key_configurada: boolean
  api_key_sandbox: boolean | null
  webhook_path: string
  produto_default_id: string | null
  produto_default: { id: string; descricao: string; codigo_lc116: string | null } | null
}

interface WebhookEvent {
  id: string
  external_id: string
  event_type: string | null
  status: string
  erro: string | null
  recebido_em: string
  nota_fiscal_id: string | null
  payload: { payment?: { id?: string; value?: number; billingType?: string; installment?: string | null } }
}

const PUBLIC_BASE = import.meta.env.PROD
  ? (typeof window !== 'undefined' ? window.location.origin : '')
  : 'http://localhost:3001'

/** Eventos que o webhook processa — e que devem ser marcados no Asaas. */
const EVENTOS_ASAAS = [
  { codigo: 'PAYMENT_CONFIRMED', nome: 'Cobrança confirmada', faz: 'emite a NFS-e (cartão aprovado)' },
  { codigo: 'PAYMENT_RECEIVED', nome: 'Cobrança recebida', faz: 'emite a NFS-e (PIX e boleto pagos)' },
  { codigo: 'PAYMENT_REFUNDED', nome: 'Cobrança estornada', faz: 'cancela a NFS-e' },
]
const EVENTOS_ACIONAM = new Set(EVENTOS_ASAAS.map((e) => e.codigo))

function dateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString('pt-BR') : '-'
}

function money(value: unknown) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))
}

async function copiar(texto: string, oQue: string) {
  try {
    await navigator.clipboard.writeText(texto)
    toast.success(`${oQue} copiado`)
  } catch {
    toast.error('Não consegui copiar — selecione e copie à mão')
  }
}

/** Bolinha numerada do passo — vira um check quando o passo está feito. */
function Passo({ n, feito }: { n: number; feito: boolean }) {
  return (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
        feito ? 'bg-success text-white' : 'bg-accent/15 text-accent'
      }`}
    >
      {feito ? <Check size={13} /> : n}
    </span>
  )
}

export default function IntegracoesAsaas() {
  const { empresaId } = useEmpresaAtual()
  const [config, setConfig] = useState<AsaasConfig | null>(null)
  const [servicos, setServicos] = useState<Servico[]>([])
  const [eventos, setEventos] = useState<WebhookEvent[]>([])

  const [apiKeyInput, setApiKeyInput] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const [contaConectada, setContaConectada] = useState<string | null>(null)

  /** O token só aparece aqui logo depois de gerado — depois fica só cifrado no banco. */
  const [tokenGerado, setTokenGerado] = useState<string | null>(null)
  const [gerandoToken, setGerandoToken] = useState(false)

  const [produtoSelect, setProdutoSelect] = useState('')
  const [savingProduto, setSavingProduto] = useState(false)
  const [reprocessando, setReprocessando] = useState<string | null>(null)

  const webhookUrl = config ? `${PUBLIC_BASE}${config.webhook_path}` : ''

  useEffect(() => {
    setTokenGerado(null)
    setContaConectada(null)
    if (empresaId) carregar(empresaId)
    else {
      setConfig(null)
      setServicos([])
      setEventos([])
    }
  }, [empresaId])

  async function carregar(id: string) {
    try {
      const [cfg, srvs, evts] = await Promise.all([
        apiGet<AsaasConfig>(`/admin/empresas/${id}/asaas-config`),
        apiGet<Servico[]>(`/admin/produtos?empresa_id=${id}&tipo=servico&ativo=true`),
        apiGet<WebhookEvent[]>(`/admin/webhook-events?empresa_id=${id}&provider=asaas`).catch(() => []),
      ])
      setConfig(cfg)
      setServicos(srvs)
      setEventos(evts)
      setProdutoSelect(cfg.produto_default_id || '')
    } catch (err) {
      toast.error('Erro ao carregar', { description: (err as Error).message })
    }
  }

  async function salvarApiKey() {
    if (!empresaId) return
    setSavingKey(true)
    try {
      const r = await apiPost<{ conta?: string; sandbox?: boolean }>(
        `/admin/empresas/${empresaId}/asaas-api-key`,
        { api_key: apiKeyInput.trim() },
      )
      setApiKeyInput('')
      setContaConectada(r.conta || null)
      toast.success(r.sandbox ? 'Chave de SANDBOX salva' : 'Chave salva e testada', {
        description: r.conta ? `Conectado a: ${r.conta}` : undefined,
      })
      await carregar(empresaId)
    } catch (err) {
      toast.error('Chave não aceita', { description: (err as Error).message })
    } finally {
      setSavingKey(false)
    }
  }

  async function gerarToken() {
    if (!empresaId) return
    if (
      config?.token_configurado &&
      !confirm(
        'Já existe um token. Gerar outro invalida o atual: o webhook do Asaas vai parar de ser aceito até você colar o token novo lá. Continuar?',
      )
    ) {
      return
    }
    setGerandoToken(true)
    try {
      const r = await apiPost<{ token: string }>(`/admin/empresas/${empresaId}/asaas-token/gerar`)
      setTokenGerado(r.token)
      await carregar(empresaId)
    } catch (err) {
      toast.error('Erro ao gerar token', { description: (err as Error).message })
    } finally {
      setGerandoToken(false)
    }
  }

  async function salvarProduto() {
    if (!empresaId) return
    setSavingProduto(true)
    try {
      await apiPost(`/admin/empresas/${empresaId}/asaas-produto-default`, { produto_id: produtoSelect || null })
      toast.success('Serviço salvo')
      await carregar(empresaId)
    } catch (err) {
      toast.error('Erro ao salvar', { description: (err as Error).message })
    } finally {
      setSavingProduto(false)
    }
  }

  async function reprocessar(ev: WebhookEvent) {
    if (!empresaId) return
    setReprocessando(ev.id)
    try {
      const r = await apiPost<{ ok: boolean; status?: string; erro?: string }>(
        `/admin/asaas/webhook-events/${ev.id}/reprocessar`,
      )
      if (r.ok) toast.success('Processado', { description: r.status ? `Nota ${r.status}` : undefined })
      else toast.error('Ainda com erro', { description: r.erro })
      await carregar(empresaId)
    } catch (err) {
      toast.error('Erro ao reprocessar', { description: (err as Error).message })
    } finally {
      setReprocessando(null)
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

  const tudoPronto = !!(config?.api_key_configurada && config?.token_configurado && config?.produto_default_id)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
            <Landmark size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">Integração Asaas</h1>
            <p className="text-sm text-muted">Cobrança paga no Asaas → NFS-e emitida automaticamente</p>
          </div>
        </div>
        <button
          onClick={() => empresaId && carregar(empresaId)}
          className="inline-flex items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-4 py-2 text-sm hover:bg-light-secondary"
        >
          <RefreshCw size={14} /> Atualizar
        </button>
      </div>

      {tudoPronto ? (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-bg px-4 py-3 text-sm text-success">
          <ShieldCheck size={16} /> Integração completa. Toda cobrança paga no Asaas a partir de agora gera a NFS-e sozinha.
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-warning">
          <AlertTriangle size={16} /> Faltam passos abaixo — enquanto isso, as vendas do Asaas continuam sem nota.
        </div>
      )}

      {/* 1. Chave da API */}
      <section className="rounded-lg border border-black/[0.06] bg-white p-5">
        <div className="mb-3 flex items-center gap-2">
          <Passo n={1} feito={!!config?.api_key_configurada} />
          <h2 className="font-semibold text-dark">Chave da API do Asaas</h2>
        </div>
        <p className="mb-3 text-xs text-muted-dark">
          O aviso de pagamento do Asaas traz só o código do cliente. É com essa chave que o sistema busca o
          CPF/CNPJ, o nome e o endereço que vão na nota. No Asaas: <strong>Integrações → Chaves de API → Gerar chave</strong>.
        </p>
        <div className="flex items-center gap-2">
          {config?.api_key_configurada && !apiKeyInput && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-bg px-3 py-1 text-xs font-semibold text-success">
              <Check size={12} /> {contaConectada ? `Conectado a ${contaConectada}` : 'Chave configurada'}
            </span>
          )}
          <input
            className={input}
            type="password"
            autoComplete="off"
            value={apiKeyInput}
            onChange={(ev) => setApiKeyInput(ev.target.value)}
            placeholder={config?.api_key_configurada ? 'Cole uma chave nova pra substituir' : '$aact_prod_...'}
          />
          <button
            onClick={salvarApiKey}
            disabled={savingKey || !apiKeyInput.trim()}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
          >
            <Save size={12} /> {savingKey ? 'Testando…' : 'Testar e salvar'}
          </button>
        </div>
        {config?.api_key_sandbox && (
          <p className="mt-2 flex items-center gap-1 text-xs font-medium text-warning">
            <AlertTriangle size={12} /> Essa é uma chave de <strong>sandbox</strong> (teste). Ela não enxerga os clientes reais —
            para vender de verdade, use a chave de produção.
          </p>
        )}
        <p className="mt-1 text-[11px] text-muted">
          A chave é testada no Asaas antes de salvar e fica cifrada no banco. Ninguém consegue lê-la de volta pelo painel.
        </p>
      </section>

      {/* 2. Webhook */}
      <section className="rounded-lg border border-black/[0.06] bg-white p-5">
        <div className="mb-3 flex items-center gap-2">
          <Passo n={2} feito={!!config?.token_configurado} />
          <h2 className="font-semibold text-dark">Webhook no Asaas</h2>
        </div>

        <div className="space-y-4 text-sm">
          <div>
            <div className={label}>URL do webhook</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded-lg border border-black/[0.08] bg-light-secondary px-3 py-2 font-mono text-xs">
                {webhookUrl || '—'}
              </code>
              <button
                onClick={() => copiar(webhookUrl, 'URL')}
                disabled={!webhookUrl}
                className="rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-xs hover:bg-light-secondary disabled:opacity-40"
              >
                <Copy size={14} />
              </button>
            </div>
          </div>

          <div>
            <div className={label}>Token de autenticação</div>
            {tokenGerado ? (
              <div className="rounded-lg border border-warning/40 bg-warning-bg p-3">
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all font-mono text-xs text-dark">{tokenGerado}</code>
                  <button
                    onClick={() => copiar(tokenGerado, 'Token')}
                    className="rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-xs hover:bg-light-secondary"
                  >
                    <Copy size={14} />
                  </button>
                </div>
                <p className="mt-2 text-[11px] font-medium text-warning">
                  Copie agora e cole no Asaas — este token não aparece de novo. Se perder, gere outro.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {config?.token_configurado && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-3 py-1 text-xs font-semibold text-success">
                    <Check size={12} /> Token configurado
                  </span>
                )}
                <button
                  onClick={gerarToken}
                  disabled={gerandoToken || !empresaId}
                  className="inline-flex items-center gap-1 rounded-lg border border-accent/30 bg-accent/5 px-4 py-2 text-xs font-semibold text-accent hover:bg-accent/10 disabled:opacity-40"
                >
                  <KeyRound size={12} /> {gerandoToken ? 'Gerando…' : config?.token_configurado ? 'Gerar novo token' : 'Gerar token'}
                </button>
              </div>
            )}
          </div>

          <div className="rounded-lg bg-light-secondary p-4">
            <div className="mb-2 text-xs font-semibold text-dark">
              No Asaas: Integrações → Webhooks → Adicionar webhook
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-dark">
              <li><strong>URL</strong>: a de cima</li>
              <li><strong>Token de autenticação</strong>: o gerado aqui</li>
              <li><strong>Versão da API</strong>: v3</li>
              <li><strong>Fila de sincronização</strong>: ativada</li>
              <li><strong>Tipo de envio</strong>: Sequencial</li>
              <li>
                <strong>Eventos</strong> — marque só estes três:
                <ul className="mt-1 space-y-0.5">
                  {EVENTOS_ASAAS.map((e) => (
                    <li key={e.codigo}>
                      <span className="font-medium text-dark">{e.nome}</span>{' '}
                      <code className="text-[10px]">{e.codigo}</code> — {e.faz}
                    </li>
                  ))}
                </ul>
              </li>
            </ol>
            <p className="mt-2 text-[11px] text-muted">
              O cartão avisa duas vezes (confirmada e, um mês depois, recebida). O sistema reconhece que é a mesma cobrança e emite uma nota só.
              Parcelamento também sai numa nota só, pelo valor total.
            </p>
          </div>
        </div>
      </section>

      {/* 3. Serviço */}
      <section className="rounded-lg border border-black/[0.06] bg-white p-5">
        <div className="mb-3 flex items-center gap-2">
          <Passo n={3} feito={!!config?.produto_default_id} />
          <h2 className="font-semibold text-dark">Serviço que vai na nota</h2>
        </div>
        <p className="mb-3 text-xs text-muted-dark">
          O Asaas não informa qual produto foi vendido, então toda cobrança sai com este serviço (código LC 116 e alíquota de ISS).
          A descrição da cobrança no Asaas, quando existe, vai como descrição da nota.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px] flex-1">
            <select
              className={input}
              value={produtoSelect}
              onChange={(ev) => setProdutoSelect(ev.target.value)}
              disabled={servicos.length === 0}
            >
              <option value="">— escolha o serviço —</option>
              {servicos.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.descricao} {s.codigo_lc116 ? `· LC116 ${s.codigo_lc116}` : '· SEM LC116!'}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={salvarProduto}
            disabled={savingProduto || produtoSelect === (config?.produto_default_id || '')}
            className="inline-flex items-center gap-1 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
          >
            <Save size={14} /> {savingProduto ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </section>

      {/* Eventos */}
      <section className="rounded-lg border border-black/[0.06] bg-white">
        <div className="border-b border-black/[0.06] p-5">
          <h2 className="font-semibold text-dark">Avisos recebidos do Asaas</h2>
          <p className="text-xs text-muted">
            Os que deram erro podem ser reprocessados depois de corrigir a causa (chave da API, CPF do cliente no Asaas, serviço).
            O reprocessamento usa o aviso já recebido — não depende do Asaas reenviar.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/[0.06]">
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Recebido</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Evento</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Cobrança</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Status</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Detalhe</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {eventos.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  Nenhum aviso recebido ainda. Depois de configurar o webhook, a próxima cobrança paga aparece aqui.
                </td>
              </tr>
            ) : (
              eventos.map((ev) => {
                const p = ev.payload?.payment
                const podeReprocessar = ev.status === 'erro' && EVENTOS_ACIONAM.has(ev.event_type || '')
                return (
                  <tr key={ev.id} className="border-b border-black/[0.04] hover:bg-light-secondary">
                    <td className="px-4 py-3 text-xs text-muted">{dateTime(ev.recebido_em)}</td>
                    <td className="px-4 py-3 font-mono text-xs">{ev.event_type || '-'}</td>
                    <td className="px-4 py-3 text-xs">
                      <div className="font-medium text-dark">{p?.value != null ? money(p.value) : '-'}</div>
                      <div className="font-mono text-[10px] text-muted">
                        {p?.id}
                        {p?.billingType ? ` · ${p.billingType}` : ''}
                        {p?.installment ? ' · parcelado' : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3">{statusBadge(ev.status)}</td>
                    <td className="max-w-[320px] px-4 py-3 text-xs text-error">{ev.erro || ''}</td>
                    <td className="px-4 py-3 text-right">
                      {podeReprocessar && (
                        <button
                          onClick={() => reprocessar(ev)}
                          disabled={reprocessando === ev.id}
                          className="inline-flex items-center gap-1 rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
                        >
                          <Play size={11} /> {reprocessando === ev.id ? 'Processando…' : 'Reprocessar'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
