import { useEffect, useState } from 'react'
import { FileSignature, Plus, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { apiGet, apiPost } from '../lib/api'

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
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [notas, setNotas] = useState<NotaFiscal[]>([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [filtroEmpresa, setFiltroEmpresa] = useState<string>('')
  const [filtroModelo, setFiltroModelo] = useState<string>('')

  async function carregarNotas() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filtroEmpresa) params.set('empresa_id', filtroEmpresa)
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
    apiGet<Empresa[]>('/admin/empresas')
      .then(setEmpresas)
      .catch((e) => toast.error((e as Error).message))
  }, [])

  useEffect(() => {
    void carregarNotas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroEmpresa, filtroModelo])

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
            onClick={() => carregarNotas()}
            className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            <RefreshCw size={14} /> Atualizar
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent/90"
          >
            <Plus size={14} /> Emitir
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <select
          value={filtroEmpresa}
          onChange={(e) => setFiltroEmpresa(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
        >
          <option value="">Todas as empresas</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.razao_social}
            </option>
          ))}
        </select>
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
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-neutral-400">
                  Carregando...
                </td>
              </tr>
            ) : notas.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-neutral-400">
                  Nenhuma nota emitida ainda.
                </td>
              </tr>
            ) : (
              notas.map((n) => (
                <tr key={n.id} className="border-t hover:bg-neutral-50">
                  <td className="px-3 py-2">{new Date(n.created_at).toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-2">{n.modelo === 65 ? 'NFC-e' : n.modelo === 55 ? 'NF-e' : '-'}</td>
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
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <EmitirModal
          empresas={empresas}
          onClose={() => setShowModal(false)}
          onEmitido={() => {
            setShowModal(false)
            void carregarNotas()
          }}
        />
      )}
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
}: {
  empresas: Empresa[]
  onClose: () => void
  onEmitido: () => void
}) {
  const [empresaId, setEmpresaId] = useState('')
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
            <select
              value={empresaId}
              onChange={(e) => setEmpresaId(e.target.value)}
              className="w-full rounded border px-2 py-1.5 text-sm"
            >
              <option value="">Selecione…</option>
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.razao_social}
                </option>
              ))}
            </select>
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
