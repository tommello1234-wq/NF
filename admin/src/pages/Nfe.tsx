import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, Code, Eye, FileSignature, FileText, Plus, QrCode, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { toast } from 'sonner'
import { apiDownload, apiGet, apiPost } from '../lib/api'
import { useEmpresaAtual } from '../lib/empresaContext'
import { camposPendentes } from '../lib/camposPendentes'

async function abrirPreviewDanfe(modelo: 55 | 65) {
  try {
    const blob = await apiDownload(`/admin/nfe/preview/${modelo}`)
    const url = URL.createObjectURL(blob.slice(0, blob.size, 'text/html'))
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (err) {
    toast.error('Erro ao gerar preview', { description: (err as Error).message })
  }
}

interface Comprovante {
  tipo: string
  label: string
  icon: string
  formato: string
  url: string
  disponivel: boolean
  motivo?: string
}
interface EventoNota {
  id: string
  tipo_evento: string
  sequencial: number
  status: string
  data_evento: string | null
  label: string
  url: string
}
interface ListaComprovantes {
  nota_id: string
  modelo: number
  status: string
  comprovantes: Comprovante[]
  eventos: EventoNota[]
}

async function abrirOuBaixar(url: string, formato: string, label: string) {
  try {
    const blob = await apiDownload(url)
    if (formato === 'html' || formato === 'png' || formato === 'pdf') {
      // Abre em nova aba (browser renderiza nativamente)
      const mime =
        formato === 'html' ? 'text/html' : formato === 'png' ? 'image/png' : 'application/pdf'
      const obj = URL.createObjectURL(blob.slice(0, blob.size, mime))
      window.open(obj, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(obj), 60_000)
    } else {
      // Força download (XML)
      const obj = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = obj
      a.download = label.toLowerCase().replace(/[^a-z0-9.-]/g, '_') + '.xml'
      a.click()
      URL.revokeObjectURL(obj)
    }
  } catch (err) {
    toast.error(`Erro ao abrir ${label}`, { description: (err as Error).message })
  }
}

function IconeFmt({ name }: { name: string }) {
  const size = 13
  if (name === 'file') return <FileText size={size} />
  if (name === 'shield') return <ShieldCheck size={size} />
  if (name === 'code') return <Code size={size} />
  if (name === 'qr') return <QrCode size={size} />
  return <FileText size={size} />
}

interface VerificacaoSefaz {
  chave_acesso: string
  ambiente: number
  consulta: {
    cStat: string
    xMotivo: string
    dhRecbto: string
    protocoloSefaz: string | null
    webservice_indisponivel?: boolean
  }
  comparacao: { status_local: string; protocolo_local: string | null; protocolo_bate: boolean }
}

/**
 * Tela de NF-e / NFC-e — esqueleto de teste (Fase 4).
 *
 * Lista as notas modelo 55 e 65 e abre um modal pra emitir.
 * Sem dados pré-cadastrados — depende de empresa, natureza e produtos
 * estarem populados nas outras telas.
 */

interface Empresa {
  id: string
  nome: string
  razao_social: string
  cnpj: string
  ie: string | null
  csc_id: string | null
  ambiente_sefaz: number
  endereco_codigo_ibge: string | null
}

interface NaturezaOperacao {
  id: string
  empresa_id: string
  nome: string
  cfop_padrao: string | null
  consumidor_final: boolean
  ativo: boolean
}

interface Produto {
  id: string
  empresa_id: string
  descricao: string
  ncm: string | null
  cfop: string | null
  cst_csosn: string | null
  valor_unitario: string | number | null
  unidade: string
  ativo: boolean
}

interface Cliente {
  id: string
  nome: string
  cpf_cnpj: string
  email: string | null
}

interface NotaFiscal {
  id: string
  empresa_id: string
  modelo: 55 | 65 | null
  tipo: 'nfe' | 'nfce' | null
  status: string
  ambiente_nfe: number | null
  serie: number | null
  numero: number | null
  chave_acesso: string | null
  protocolo: string | null
  qr_code_nfce: string | null
  destinatario_nome: string | null
  destinatario_cpf_cnpj: string | null
  valor_total: string | number | null
  motivo_rejeicao: string | null
  emitida_em: string | null
  created_at: string
  empresas?: { nome: string; razao_social: string; cnpj: string } | null
}

interface ItemForm {
  produto_id: string
  quantidade: number
  valor_unitario?: number
  valor_desconto?: number
}

export default function NfePage() {
  const { empresaId, empresas } = useEmpresaAtual()
  const empresaSelecionada = empresas.find((e) => e.id === empresaId)
  const pendentes = camposPendentes(empresaSelecionada)
  const incompleta = pendentes.length > 0
  const [notas, setNotas] = useState<NotaFiscal[]>([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [filtroModelo, setFiltroModelo] = useState<string>('')
  const [verificacao, setVerificacao] = useState<VerificacaoSefaz | null>(null)
  const [verificando, setVerificando] = useState<string | null>(null)

  async function verificarNaSefaz(notaId: string) {
    setVerificando(notaId)
    try {
      const res = await apiGet<VerificacaoSefaz>(`/admin/nfe/${notaId}/verificar-sefaz`)
      setVerificacao(res)
    } catch (err) {
      toast.error('Erro ao consultar SEFAZ', { description: (err as Error).message })
    } finally {
      setVerificando(null)
    }
  }

  async function carregarNotas() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (empresaId) params.set('empresa_id', empresaId)
      if (filtroModelo) params.set('modelo', filtroModelo)
      const data = await apiGet<NotaFiscal[]>(`/admin/nfe?${params.toString()}`)
      setNotas(data)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void carregarNotas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, filtroModelo])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileSignature className="text-accent" size={22} />
          <h1 className="text-xl font-bold">NF-e / NFC-e</h1>
          <span className="text-xs text-neutral-500 uppercase">Esqueleto de teste</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => abrirPreviewDanfe(55)}
            className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-neutral-50"
            title="Abre uma DANFE NF-e A4 com dados fake numa nova aba"
          >
            <Eye size={14} /> Preview NF-e
          </button>
          <button
            onClick={() => abrirPreviewDanfe(65)}
            className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-neutral-50"
            title="Abre uma DANFE NFC-e bobina com QR Code numa nova aba"
          >
            <Eye size={14} /> Preview NFC-e
          </button>
          <button
            onClick={() => carregarNotas()}
            className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            <RefreshCw size={14} /> Atualizar
          </button>
          <button
            onClick={() => setShowModal(true)}
            disabled={incompleta || !empresaId}
            title={
              incompleta
                ? `Empresa incompleta — preencha ${pendentes.length} campo${pendentes.length > 1 ? 's' : ''} pendente${pendentes.length > 1 ? 's' : ''} em /empresas/${empresaId}`
                : !empresaId
                ? 'Selecione uma empresa na barra superior'
                : 'Emitir nova NF-e ou NFC-e'
            }
            className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={14} /> Emitir
          </button>
        </div>
      </div>

      {incompleta && empresaSelecionada && (
        <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error-bg/50 p-3 text-sm text-error">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <div className="font-semibold">
              Empresa <strong>{empresaSelecionada.nome || empresaSelecionada.razao_social}</strong> está
              incompleta — emissão bloqueada
            </div>
            <div className="mt-1 text-xs text-error/90">
              Faltam {pendentes.length} campo{pendentes.length > 1 ? 's' : ''}:{' '}
              {pendentes.map((p) => p.label).join(', ')}.{' '}
              <a href={`/empresas/${empresaSelecionada.id}`} className="underline font-semibold">
                Abrir cadastro da empresa
              </a>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <select
          value={filtroModelo}
          onChange={(e) => setFiltroModelo(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
        >
          <option value="">Todos os modelos</option>
          <option value="55">NF-e (55)</option>
          <option value="65">NFC-e (65)</option>
        </select>
      </div>

      <div className="rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Modelo</th>
              <th className="px-3 py-2">Série/Nº</th>
              <th className="px-3 py-2">Empresa</th>
              <th className="px-3 py-2">Destinatário</th>
              <th className="px-3 py-2">Valor</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-neutral-400">
                  Carregando...
                </td>
              </tr>
            ) : notas.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-neutral-400">
                  Nenhuma nota emitida ainda.
                </td>
              </tr>
            ) : (
              notas.map((n) => {
                const modeloLabel =
                  n.modelo === 65 ? 'NFC-e' : n.modelo === 55 ? 'NF-e' : n.tipo === 'nfce' ? 'NFC-e' : n.tipo === 'nfe' ? 'NF-e' : '-'
                return (
                  <tr key={n.id} className="border-t hover:bg-neutral-50">
                    <td className="px-3 py-2">{new Date(n.created_at).toLocaleString('pt-BR')}</td>
                    <td className="px-3 py-2">{modeloLabel}</td>
                    <td className="px-3 py-2">
                      {n.serie ?? '-'}/{n.numero ?? '-'}
                    </td>
                    <td className="px-3 py-2">{n.empresas?.razao_social || '-'}</td>
                    <td className="px-3 py-2">{n.destinatario_nome || '-'}</td>
                    <td className="px-3 py-2">
                      {n.valor_total ? `R$ ${Number(n.valor_total).toFixed(2)}` : '-'}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={n.status} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1">
                        <ComprovantesDropdown notaId={n.id} />
                        <button
                          onClick={() => verificarNaSefaz(n.id)}
                          disabled={verificando === n.id || !n.chave_acesso}
                          className="inline-flex items-center gap-1 rounded-lg border border-info/30 bg-info-bg px-2 py-1 text-xs text-info hover:bg-info/10 disabled:opacity-50"
                          title="Consultar status direto na SEFAZ via NFeConsultaProtocolo4"
                        >
                          <ShieldCheck size={12} />
                          {verificando === n.id ? 'Consultando…' : 'SEFAZ'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <EmitirModal
          empresas={empresas as unknown as Empresa[]}
          empresaIdInicial={empresaId}
          onClose={() => setShowModal(false)}
          onEmitido={() => {
            setShowModal(false)
            void carregarNotas()
          }}
        />
      )}

      {verificacao && (
        <VerificacaoSefazModal verificacao={verificacao} onClose={() => setVerificacao(null)} />
      )}
    </div>
  )
}

function ComprovantesDropdown({ notaId }: { notaId: string }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<ListaComprovantes | null>(null)
  const [loading, setLoading] = useState(false)

  async function toggle() {
    if (open) { setOpen(false); return }
    setLoading(true)
    try {
      const res = await apiGet<ListaComprovantes>(`/admin/nfe/${notaId}/comprovantes`)
      setData(res)
      setOpen(true)
    } catch (err) {
      toast.error('Erro ao carregar comprovantes', { description: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={toggle}
        disabled={loading}
        className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50"
        title="Ver todos os comprovantes da nota"
      >
        <Eye size={12} /> Comprovantes <ChevronDown size={11} />
      </button>
      {open && data && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-lg border border-black/[0.08] bg-white p-2 shadow-lg">
            <div className="mb-1 px-2 py-1 text-[10px] uppercase tracking-wide text-muted">
              Documentos da nota
            </div>
            {data.comprovantes.map((c) => (
              <button
                key={c.tipo}
                disabled={!c.disponivel}
                onClick={() => { abrirOuBaixar(c.url, c.formato, c.label); setOpen(false) }}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
                title={c.motivo || c.label}
              >
                <span className="mt-0.5 text-muted-dark"><IconeFmt name={c.icon} /></span>
                <span className="flex-1">
                  <span className="font-medium text-dark">{c.label}</span>
                  <span className="ml-1 text-[10px] uppercase text-muted">{c.formato}</span>
                  {!c.disponivel && c.motivo && (
                    <span className="block text-[10px] text-muted">{c.motivo}</span>
                  )}
                </span>
              </button>
            ))}
            {data.eventos.length > 0 && (
              <>
                <div className="mt-2 mb-1 px-2 py-1 text-[10px] uppercase tracking-wide text-muted">
                  Eventos ({data.eventos.length})
                </div>
                {data.eventos.map((ev) => (
                  <button
                    key={ev.id}
                    onClick={() => { abrirOuBaixar(ev.url, 'xml', ev.label); setOpen(false) }}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-neutral-100"
                  >
                    <span className="mt-0.5 text-muted-dark"><Code size={13} /></span>
                    <span className="flex-1">
                      <span className="font-medium text-dark">{ev.label}</span>
                      <span className="ml-1 text-[10px] uppercase text-muted">xml</span>
                      <span className={`ml-2 text-[10px] ${ev.status === 'autorizado' ? 'text-success' : ev.status === 'rejeitado' ? 'text-error' : 'text-muted'}`}>
                        {ev.status}
                      </span>
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function VerificacaoSefazModal({
  verificacao,
  onClose,
}: {
  verificacao: VerificacaoSefaz
  onClose: () => void
}) {
  const { consulta, comparacao, chave_acesso, ambiente } = verificacao
  const wsIndisponivel = consulta.webservice_indisponivel === true
  const autorizada = consulta.cStat === '100' || (wsIndisponivel && comparacao.status_local === 'autorizada')
  const cancelada = consulta.cStat === '101'
  const denegada = ['110', '301', '302'].includes(consulta.cStat)
  const naoAutorizada = !autorizada && !cancelada && !wsIndisponivel
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-lg bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-black/[0.06] p-5">
          <h3 className="flex items-center gap-2 font-semibold text-dark">
            <ShieldCheck size={18} className="text-info" /> Verificação direto na SEFAZ
          </h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="space-y-3 p-5 text-sm">
          {wsIndisponivel ? (
            <div className="rounded-lg border border-warning/30 bg-warning-bg p-3 text-warning">
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle size={16} /> Webservice de consulta indisponível
              </div>
              <div className="mt-1 text-xs">{consulta.xMotivo}</div>
              <div className="mt-2 text-xs">
                A nota foi <strong>autorizada</strong> no momento da emissão (cStat 100 retornado).
                O endpoint <code>NFeConsultaProtocolo4</code> da SVRS não responde pra essa empresa/ambiente.
                Pra confirmar publicamente, use o portal SEFAZ-CE quando ele estiver de volta.
              </div>
            </div>
          ) : (
            <div className={`rounded-lg border p-3 ${autorizada ? 'border-success/30 bg-success-bg text-success' : denegada || naoAutorizada ? 'border-error/30 bg-error-bg text-error' : 'border-warning/30 bg-warning-bg text-warning'}`}>
              <div className="flex items-center gap-2 font-semibold">
                {autorizada ? <CheckCircle2 size={16} /> : <X size={16} />}
                cStat {consulta.cStat} — {consulta.xMotivo || '(sem motivo)'}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-xs">
            <Info label="Chave de acesso" value={chave_acesso.match(/.{1,4}/g)?.join(' ') || chave_acesso} />
            <Info label="Ambiente SEFAZ" value={ambiente === 1 ? 'Produção' : 'Homologação'} />
            <Info label="Recebido pela SEFAZ em" value={consulta.dhRecbto || '—'} />
            <Info label="Protocolo SEFAZ" value={consulta.protocoloSefaz || '—'} />
          </div>

          <div className="mt-3 rounded-lg border border-black/[0.06] bg-light-secondary p-3">
            <div className="mb-2 text-xs font-semibold text-muted-dark">Cruzamento com o banco local</div>
            <div className="space-y-1 text-xs">
              <div>Status local: <strong>{comparacao.status_local}</strong></div>
              <div>Protocolo local: <strong>{comparacao.protocolo_local || '—'}</strong></div>
              <div className={comparacao.protocolo_bate ? 'text-success' : 'text-error'}>
                {wsIndisponivel
                  ? (comparacao.protocolo_bate
                      ? '✓ Status local: autorizada com protocolo válido'
                      : '✗ Status local não é autorizada')
                  : (comparacao.protocolo_bate
                      ? '✓ Protocolo bate com o da SEFAZ'
                      : '✗ Protocolo NÃO bate com o da SEFAZ')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    autorizada: 'bg-green-100 text-green-700',
    rejeitada: 'bg-red-100 text-red-700',
    cancelada: 'bg-neutral-200 text-neutral-700',
    aguardando_sefaz: 'bg-yellow-100 text-yellow-800',
    emitida_teste: 'bg-blue-100 text-blue-700',
    rascunho: 'bg-neutral-100 text-neutral-600',
  }
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${map[status] || 'bg-neutral-100'}`}>
      {status}
    </span>
  )
}

function EmitirModal({
  empresas,
  onClose,
  onEmitido,
  empresaIdInicial,
}: {
  empresas: Empresa[]
  empresaIdInicial?: string
  onClose: () => void
  onEmitido: () => void
}) {
  const empresaId = empresaIdInicial || ''
  const [modelo, setModelo] = useState<55 | 65>(65)
  const [naturezaId, setNaturezaId] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [naturezas, setNaturezas] = useState<NaturezaOperacao[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [itens, setItens] = useState<ItemForm[]>([{ produto_id: '', quantidade: 1 }])
  const [forma, setForma] = useState('01')
  const [valorPago, setValorPago] = useState<number>(0)
  const [obs, setObs] = useState('')
  const [emitindo, setEmitindo] = useState(false)

  useEffect(() => {
    if (!empresaId) return
    apiGet<NaturezaOperacao[]>(`/admin/naturezas-operacao?empresa_id=${empresaId}`)
      .then(setNaturezas)
      .catch(() => setNaturezas([]))
    apiGet<Produto[]>(`/admin/produtos?empresa_id=${empresaId}&tipo=produto`)
      .then(setProdutos)
      .catch(() => setProdutos([]))
    apiGet<Cliente[]>(`/admin/clientes?empresa_id=${empresaId}`)
      .then(setClientes)
      .catch(() => setClientes([]))
  }, [empresaId])

  function adicionarItem() {
    setItens([...itens, { produto_id: '', quantidade: 1 }])
  }
  function removerItem(idx: number) {
    setItens(itens.filter((_, i) => i !== idx))
  }
  function atualizarItem(idx: number, patch: Partial<ItemForm>) {
    setItens(itens.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  const valorTotal = itens.reduce((s, it) => {
    const p = produtos.find((x) => x.id === it.produto_id)
    const valorUnit = it.valor_unitario ?? Number(p?.valor_unitario || 0)
    return s + valorUnit * (it.quantidade || 0) - (it.valor_desconto || 0)
  }, 0)

  async function handleEmitir() {
    if (!empresaId || !naturezaId || itens.length === 0) {
      toast.error('Preencha empresa, natureza e ao menos um item')
      return
    }
    setEmitindo(true)
    try {
      const res = await apiPost<{ status: string; numero?: number; chaveAcesso?: string }>(
        '/admin/nfe/emitir',
        {
          empresa_id: empresaId,
          modelo,
          natureza_operacao_id: naturezaId,
          cliente_id: clienteId || null,
          itens: itens.map((it) => ({
            produto_id: it.produto_id,
            quantidade: it.quantidade,
            valor_unitario: it.valor_unitario,
            valor_desconto: it.valor_desconto,
          })),
          pagamento: { forma, valor: valorPago || valorTotal },
          informacoes_complementares: obs || null,
        },
      )
      if (res.status === 'autorizada') {
        toast.success(`Nota ${res.numero} autorizada — chave ${res.chaveAcesso?.slice(-8)}`)
      } else {
        toast.error(`Status: ${res.status}`)
      }
      onEmitido()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setEmitindo(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Emitir NF-e / NFC-e</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-neutral-100">
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Empresa">
            <input
              value={empresas.find((e) => e.id === empresaId)?.razao_social || '—'}
              disabled
              readOnly
              className="w-full rounded border bg-neutral-50 px-2 py-1.5 text-sm text-neutral-600"
            />
          </Field>

          <Field label="Modelo">
            <select
              value={modelo}
              onChange={(e) => setModelo(Number(e.target.value) as 55 | 65)}
              className="w-full rounded border px-2 py-1.5 text-sm"
            >
              <option value={65}>NFC-e (65)</option>
              <option value={55}>NF-e (55)</option>
            </select>
          </Field>

          <Field label="Natureza de operação">
            <select
              value={naturezaId}
              onChange={(e) => setNaturezaId(e.target.value)}
              className="w-full rounded border px-2 py-1.5 text-sm"
            >
              <option value="">Selecione…</option>
              {naturezas.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.nome} {n.cfop_padrao ? `(${n.cfop_padrao})` : ''}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Cliente (opcional)">
            <select
              value={clienteId}
              onChange={(e) => setClienteId(e.target.value)}
              className="w-full rounded border px-2 py-1.5 text-sm"
            >
              <option value="">Consumidor avulso</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Itens</h3>
            <button
              onClick={adicionarItem}
              className="rounded border px-2 py-1 text-xs hover:bg-neutral-50"
            >
              + Adicionar item
            </button>
          </div>
          <div className="space-y-2">
            {itens.map((it, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2">
                <select
                  value={it.produto_id}
                  onChange={(ev) => atualizarItem(idx, { produto_id: ev.target.value })}
                  className="col-span-6 rounded border px-2 py-1 text-sm"
                >
                  <option value="">Produto…</option>
                  {produtos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.descricao}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0.0001}
                  step={0.0001}
                  value={it.quantidade}
                  onChange={(ev) => atualizarItem(idx, { quantidade: Number(ev.target.value) })}
                  className="col-span-2 rounded border px-2 py-1 text-sm"
                  placeholder="Qtd"
                />
                <input
                  type="number"
                  step={0.01}
                  value={it.valor_unitario ?? ''}
                  onChange={(ev) =>
                    atualizarItem(idx, { valor_unitario: Number(ev.target.value) || undefined })
                  }
                  className="col-span-3 rounded border px-2 py-1 text-sm"
                  placeholder="Vlr unit."
                />
                <button
                  onClick={() => removerItem(idx)}
                  className="col-span-1 rounded border px-2 py-1 text-xs hover:bg-red-50"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 text-right text-sm font-semibold">
            Total: R$ {valorTotal.toFixed(2)}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <Field label="Forma de pagamento">
            <select
              value={forma}
              onChange={(e) => setForma(e.target.value)}
              className="w-full rounded border px-2 py-1.5 text-sm"
            >
              <option value="01">01 - Dinheiro</option>
              <option value="03">03 - Cartão Crédito</option>
              <option value="04">04 - Cartão Débito</option>
              <option value="15">15 - Boleto</option>
              <option value="17">17 - PIX</option>
              <option value="99">99 - Outros</option>
            </select>
          </Field>
          <Field label="Valor pago">
            <input
              type="number"
              step={0.01}
              value={valorPago || valorTotal}
              onChange={(e) => setValorPago(Number(e.target.value))}
              className="w-full rounded border px-2 py-1.5 text-sm"
            />
          </Field>
        </div>

        <Field label="Observações (info complementares)">
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            className="w-full rounded border px-2 py-1.5 text-sm"
          />
        </Field>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded border px-4 py-2 text-sm">
            Cancelar
          </button>
          <button
            disabled={emitindo}
            onClick={handleEmitir}
            className="rounded bg-accent px-4 py-2 text-sm text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {emitindo ? 'Emitindo…' : 'Emitir'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-600">{label}</span>
      {children}
    </label>
  )
}
