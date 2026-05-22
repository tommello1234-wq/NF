/**
 * Vendas — espelha o módulo de Vendas do ssÓtica.
 *
 * Cada Venda pode emitir NFC-e automaticamente. Na listagem, cada linha mostra
 * o dropdown "Documentos Fiscais" (Abrir / Imprimir DANFE / Enviar) quando a
 * venda já tem nota_fiscal_id vinculada.
 */

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, FileText, Plus, RefreshCw, ShoppingCart, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { apiDelete, apiGet, apiPost } from '../lib/api'
import { useEmpresaAtual } from '../lib/empresaContext'

interface Cliente {
  id: string
  nome: string
  cpf_cnpj: string
}

interface Produto {
  id: string
  descricao: string
  valor_unitario: string | number | null
  unidade: string
}

interface VendaItem {
  id?: string
  produto_id: string
  descricao?: string
  quantidade: number
  valor_unitario: number
  desconto?: number
  acrescimo?: number
  valor_total?: number
}

interface VendaPagamento {
  forma_pagamento: string
  valor: number
  parcelas?: number
  primeiro_vencimento?: string
  codigo_autorizacao?: string
}

interface Venda {
  id: string
  empresa_id: string
  cliente_id: string | null
  funcionario: string | null
  observacao: string | null
  valor_produtos: string | number
  valor_desconto: string | number
  valor_acrescimo: string | number
  valor_total: string | number
  status: string
  nota_fiscal_id: string | null
  emitir_nfce_automatico: boolean
  created_at: string
  clientes?: { nome: string; cpf_cnpj: string } | null
  notas_fiscais?: { id: string; status: string; numero: number | null; chave_acesso: string | null; qr_code_nfce: string | null } | null
}

function money(v: unknown) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0))
}

export default function VendasPage() {
  const { empresaId, empresaAtual } = useEmpresaAtual()
  const [vendas, setVendas] = useState<Venda[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [filtroStatus, setFiltroStatus] = useState<string>('todas')

  useEffect(() => {
    if (empresaId) loadVendas(empresaId)
    else {
      setVendas([])
      setLoading(false)
    }
  }, [empresaId])

  async function loadVendas(id = empresaId) {
    if (!id) return
    setLoading(true)
    try {
      setVendas(await apiGet<Venda[]>(`/admin/vendas?empresa_id=${id}`))
    } catch (err) {
      toast.error('Erro ao buscar vendas', { description: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }

  async function emitirNfce(venda: Venda) {
    try {
      const res = await apiPost<{ status: string; numero?: number }>(`/admin/vendas/${venda.id}/emitir-nfce`, {})
      if (res.status === 'autorizada') toast.success(`NFC-e ${res.numero} autorizada`)
      else toast.error(`Falha — status: ${res.status}`)
      await loadVendas()
    } catch (err) {
      toast.error('Erro ao emitir NFC-e', { description: (err as Error).message })
    }
  }

  async function remove(venda: Venda) {
    if (!confirm(`Excluir venda ${venda.id.slice(0, 8)}?`)) return
    try {
      await apiDelete(`/admin/vendas/${venda.id}`)
      toast.success('Venda excluída')
      await loadVendas()
    } catch (err) {
      toast.error('Erro ao excluir', { description: (err as Error).message })
    }
  }

  const vendasFiltradas = useMemo(() => {
    if (filtroStatus === 'todas') return vendas
    return vendas.filter((v) => v.status === filtroStatus)
  }, [vendas, filtroStatus])

  const totalDia = vendas.filter((v) => v.status === 'paga').reduce((s, v) => s + Number(v.valor_total || 0), 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
            <ShoppingCart size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">Vendas</h1>
            <p className="text-sm text-muted">
              {empresaAtual?.nome || 'Selecione uma empresa'} ·{' '}
              <span className="font-semibold">{money(totalDia)}</span> em vendas pagas
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => loadVendas()}
            className="inline-flex items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-4 py-2 text-sm hover:bg-light-secondary"
          >
            <RefreshCw size={14} /> Atualizar
          </button>
          <button
            onClick={() => setShowModal(true)}
            disabled={!empresaId}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            <Plus size={14} /> Nova Venda
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-black/[0.06]">
        {[
          { k: 'todas', label: 'Todas' },
          { k: 'rascunho', label: 'Rascunho' },
          { k: 'aberta', label: 'Aberta' },
          { k: 'paga', label: 'Paga (NFC-e autorizada)' },
          { k: 'cancelada', label: 'Cancelada' },
        ].map((t) => {
          const count = t.k === 'todas' ? vendas.length : vendas.filter((v) => v.status === t.k).length
          const active = filtroStatus === t.k
          return (
            <button
              key={t.k}
              onClick={() => setFiltroStatus(t.k)}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                active ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-dark'
              }`}
            >
              {t.label}
              {count > 0 && (
                <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? 'bg-accent text-white' : 'bg-neutral-100 text-neutral-600'}`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <section className="overflow-hidden rounded-lg border border-black/[0.06] bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/[0.06]">
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Data</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Cliente</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Funcionário</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Valor</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Status</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">NFC-e</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted">Carregando…</td></tr>
            ) : vendasFiltradas.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-muted">
                {vendas.length === 0 ? 'Nenhuma venda registrada.' : 'Nenhuma venda nesse status.'}
              </td></tr>
            ) : vendasFiltradas.map((v) => (
              <tr key={v.id} className="border-b border-black/[0.04] hover:bg-light-secondary">
                <td className="px-4 py-3 text-xs">{new Date(v.created_at).toLocaleString('pt-BR')}</td>
                <td className="px-4 py-3">
                  <div className="font-medium text-dark">{v.clientes?.nome || 'Consumidor avulso'}</div>
                  <div className="text-xs text-muted">{v.clientes?.cpf_cnpj || ''}</div>
                </td>
                <td className="px-4 py-3 text-xs">{v.funcionario || '-'}</td>
                <td className="px-4 py-3 font-medium">{money(v.valor_total)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    v.status === 'paga' ? 'bg-success-bg text-success'
                    : v.status === 'cancelada' ? 'bg-error-bg text-error'
                    : v.status === 'aberta' ? 'bg-info-bg text-info'
                    : 'bg-light-secondary text-muted-dark'
                  }`}>
                    {v.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {v.notas_fiscais ? (
                    <DocumentosFiscaisDropdown nota={v.notas_fiscais} />
                  ) : v.status !== 'cancelada' ? (
                    <button
                      onClick={() => emitirNfce(v)}
                      className="rounded-md border border-accent/30 bg-accent/5 px-2 py-1 text-xs text-accent hover:bg-accent/10"
                    >
                      Emitir NFC-e
                    </button>
                  ) : (
                    <span className="text-xs text-muted">-</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {!v.nota_fiscal_id && (
                    <button onClick={() => remove(v)} className="rounded-lg border border-error/20 p-2 text-error hover:bg-error/5" title="Excluir">
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {showModal && (
        <NovaVendaModal
          onClose={() => setShowModal(false)}
          onSalvo={() => {
            setShowModal(false)
            void loadVendas()
          }}
        />
      )}
    </div>
  )
}

function DocumentosFiscaisDropdown({ nota }: { nota: NonNullable<Venda['notas_fiscais']> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md border border-info/30 bg-info-bg px-2 py-1 text-xs text-info hover:bg-info/10"
      >
        <FileText size={12} /> {nota.status === 'autorizada' ? `Autorizada nº ${nota.numero}` : nota.status} <ChevronDown size={11} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-black/[0.08] bg-white p-2 shadow-lg">
            <a
              href={`/nfe`}
              className="block rounded-md px-2 py-1.5 text-xs hover:bg-neutral-100"
            >
              Abrir nota
            </a>
            {nota.chave_acesso && (
              <div className="px-2 py-1 text-[10px] font-mono text-muted break-all">
                {nota.chave_acesso}
              </div>
            )}
            {nota.qr_code_nfce && (
              <a
                href={nota.qr_code_nfce}
                target="_blank"
                rel="noopener"
                className="block rounded-md px-2 py-1.5 text-xs hover:bg-neutral-100"
              >
                Consultar QR Code da NFC-e
              </a>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function NovaVendaModal({ onClose, onSalvo }: { onClose: () => void; onSalvo: () => void }) {
  const { empresaId, empresaAtual } = useEmpresaAtual()
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [clienteId, setClienteId] = useState('')
  const [funcionario, setFuncionario] = useState('')
  const [observacao, setObservacao] = useState('')
  const [itens, setItens] = useState<VendaItem[]>([{ produto_id: '', quantidade: 1, valor_unitario: 0 }])
  const [pagamento, setPagamento] = useState<VendaPagamento>({ forma_pagamento: '01', valor: 0, parcelas: 1 })
  const [emitirAuto, setEmitirAuto] = useState(true)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!empresaId) return
    apiGet<Cliente[]>(`/admin/clientes?empresa_id=${empresaId}`).then(setClientes).catch(() => setClientes([]))
    apiGet<Produto[]>(`/admin/produtos?empresa_id=${empresaId}&tipo=produto`).then(setProdutos).catch(() => setProdutos([]))
  }, [empresaId])

  function adicionarItem() {
    setItens([...itens, { produto_id: '', quantidade: 1, valor_unitario: 0 }])
  }
  function removerItem(idx: number) {
    setItens(itens.filter((_, i) => i !== idx))
  }
  function atualizarItem(idx: number, patch: Partial<VendaItem>) {
    setItens(itens.map((it, i) => {
      if (i !== idx) return it
      const nv = { ...it, ...patch }
      // Auto-preenche valor unitário ao selecionar produto
      if (patch.produto_id) {
        const p = produtos.find((x) => x.id === patch.produto_id)
        if (p && !it.valor_unitario) nv.valor_unitario = Number(p.valor_unitario || 0)
      }
      return nv
    }))
  }

  const valorProdutos = itens.reduce((s, it) => s + (it.valor_unitario * it.quantidade), 0)
  const valorDescontos = itens.reduce((s, it) => s + (it.desconto || 0), 0)
  const valorAcrescimos = itens.reduce((s, it) => s + (it.acrescimo || 0), 0)
  const valorTotal = valorProdutos - valorDescontos + valorAcrescimos

  async function salvar() {
    if (!empresaId) return toast.error('Selecione uma empresa')
    if (itens.some((it) => !it.produto_id)) return toast.error('Selecione o produto em todos os itens')
    if (valorTotal <= 0) return toast.error('Valor total da venda deve ser positivo')

    setSalvando(true)
    try {
      const valorPag = pagamento.valor || valorTotal
      const res = await apiPost<{ venda_id: string; nfce?: { status?: string; numero?: number } }>(
        '/admin/vendas',
        {
          empresa_id: empresaId,
          cliente_id: clienteId || null,
          funcionario: funcionario || null,
          observacao: observacao || null,
          itens: itens.map((it) => ({
            produto_id: it.produto_id,
            quantidade: it.quantidade,
            valor_unitario: it.valor_unitario,
            desconto: it.desconto || 0,
            acrescimo: it.acrescimo || 0,
          })),
          pagamentos: [{ ...pagamento, valor: valorPag }],
          emitir_nfce_automatico: emitirAuto,
        },
      )
      if (emitirAuto) {
        const nf = res.nfce as { status?: string; numero?: number; error?: string } | undefined
        if (nf?.error) toast.warning(`Venda salva, mas NFC-e falhou: ${nf.error}`)
        else if (nf?.status === 'autorizada') toast.success(`Venda salva e NFC-e ${nf.numero} autorizada`)
        else toast.warning(`Venda salva. NFC-e: ${nf?.status || 'pendente'}`)
      } else {
        toast.success('Venda salva (sem NFC-e)')
      }
      onSalvo()
    } catch (e) {
      toast.error('Erro ao salvar venda', { description: (e as Error).message })
    } finally {
      setSalvando(false)
    }
  }

  const input = 'w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30'
  const label = 'mb-1 block text-xs font-medium text-muted-dark'

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={() => !salvando && onClose()}>
      <div className="w-full max-w-4xl rounded-lg bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-black/[0.06] p-5">
          <div>
            <h3 className="font-semibold text-dark">Nova Venda</h3>
            <p className="text-xs text-muted">{empresaAtual?.nome || empresaAtual?.razao_social}</p>
          </div>
          <button onClick={onClose}><X size={18} /></button>
        </div>

        <div className="max-h-[72vh] space-y-5 overflow-y-auto p-5">
          {/* Dados principais */}
          <section>
            <div className="mb-2 text-xs font-semibold uppercase text-muted">Dados principais</div>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className={label}>Cliente</label>
                <select className={input} value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
                  <option value="">Consumidor avulso</option>
                  {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>Funcionário / Vendedor</label>
                <input className={input} value={funcionario} onChange={(e) => setFuncionario(e.target.value)} />
              </div>
              <div className="flex items-end gap-2 pb-1">
                <label className="flex items-center gap-2 text-sm text-muted-dark">
                  <input type="checkbox" checked={emitirAuto} onChange={(e) => setEmitirAuto(e.target.checked)} />
                  Emitir NFC-e automaticamente ao salvar
                </label>
              </div>
            </div>
          </section>

          {/* Itens */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase text-muted">Produtos e serviços</div>
              <button onClick={adicionarItem} className="rounded border px-2 py-1 text-xs hover:bg-neutral-50">+ Adicionar item</button>
            </div>
            <div className="space-y-2">
              {itens.map((it, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2">
                  <select
                    value={it.produto_id}
                    onChange={(ev) => atualizarItem(idx, { produto_id: ev.target.value })}
                    className="col-span-5 rounded border px-2 py-1 text-sm"
                  >
                    <option value="">Produto…</option>
                    {produtos.map((p) => <option key={p.id} value={p.id}>{p.descricao}</option>)}
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
                    value={it.valor_unitario}
                    onChange={(ev) => atualizarItem(idx, { valor_unitario: Number(ev.target.value) })}
                    className="col-span-2 rounded border px-2 py-1 text-sm"
                    placeholder="Vlr unit."
                  />
                  <input
                    type="number"
                    step={0.01}
                    value={it.desconto || 0}
                    onChange={(ev) => atualizarItem(idx, { desconto: Number(ev.target.value) })}
                    className="col-span-2 rounded border px-2 py-1 text-sm"
                    placeholder="Desconto"
                  />
                  <button
                    onClick={() => removerItem(idx)}
                    className="col-span-1 rounded border px-2 py-1 text-xs hover:bg-red-50"
                  >×</button>
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <div>Produtos: <strong>{money(valorProdutos)}</strong></div>
              <div>Descontos: <strong>{money(valorDescontos)}</strong></div>
              <div className="text-right">Total: <strong className="text-lg">{money(valorTotal)}</strong></div>
            </div>
          </section>

          {/* Pagamento */}
          <section>
            <div className="mb-2 text-xs font-semibold uppercase text-muted">Dados de pagamento</div>
            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <label className={label}>Forma de pagamento</label>
                <select className={input} value={pagamento.forma_pagamento} onChange={(e) => setPagamento({ ...pagamento, forma_pagamento: e.target.value })}>
                  <option value="01">01 - Dinheiro</option>
                  <option value="03">03 - Cartão Crédito</option>
                  <option value="04">04 - Cartão Débito</option>
                  <option value="15">15 - Boleto</option>
                  <option value="17">17 - PIX</option>
                  <option value="99">99 - Outros</option>
                </select>
              </div>
              <div>
                <label className={label}>Valor</label>
                <input className={input} type="number" step={0.01} value={pagamento.valor || valorTotal}
                       onChange={(e) => setPagamento({ ...pagamento, valor: Number(e.target.value) })} />
              </div>
              <div>
                <label className={label}>Parcelas</label>
                <input className={input} type="number" min={1} max={36} value={pagamento.parcelas || 1}
                       onChange={(e) => setPagamento({ ...pagamento, parcelas: Number(e.target.value) })} />
              </div>
              <div>
                <label className={label}>1º Vencimento</label>
                <input className={input} type="date" value={pagamento.primeiro_vencimento || ''}
                       onChange={(e) => setPagamento({ ...pagamento, primeiro_vencimento: e.target.value })} />
              </div>
            </div>
          </section>

          {/* Observação */}
          <section>
            <label className={label}>Observação (vai pra &lt;infCpl&gt; da NFC-e)</label>
            <textarea className={input} rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
          </section>
        </div>

        <div className="flex justify-end gap-2 border-t border-black/[0.06] bg-light-secondary/40 p-3">
          <button onClick={onClose} className="rounded-lg border border-black/[0.08] bg-white px-4 py-2 text-sm">Cancelar</button>
          <button onClick={salvar} disabled={salvando} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
            {salvando ? 'Salvando…' : emitirAuto ? 'Salvar + Emitir NFC-e' : 'Salvar venda'}
          </button>
        </div>
      </div>
    </div>
  )
}
