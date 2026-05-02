import { useEffect, useMemo, useState } from 'react'
import { Edit2, Package, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/api'

interface Empresa {
  id: string
  nome: string
}

interface Produto {
  id: string
  empresa_id: string
  descricao: string
  codigo_interno: string | null
  ncm: string | null
  cfop: string | null
  unidade: string
  valor_unitario: string | number | null
  origem: number
  cst_csosn: string | null
  aliquota_icms: string | number | null
  aliquota_pis: string | number | null
  aliquota_cofins: string | number | null
  tipo: 'produto' | 'servico'
  ativo: boolean
}

const emptyForm = {
  id: '',
  empresa_id: '',
  descricao: '',
  codigo_interno: '',
  ncm: '',
  cfop: '',
  unidade: 'UN',
  valor_unitario: 0,
  origem: 0,
  cst_csosn: '',
  aliquota_icms: 0,
  aliquota_pis: 0,
  aliquota_cofins: 0,
  tipo: 'produto' as 'produto' | 'servico',
  ativo: true,
}

function money(value: unknown) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))
}

export default function Produtos() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [empresaId, setEmpresaId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)

  const empresaAtual = useMemo(() => empresas.find((empresa) => empresa.id === empresaId), [empresas, empresaId])

  useEffect(() => {
    loadInitial()
  }, [])

  useEffect(() => {
    if (empresaId) loadProdutos(empresaId)
  }, [empresaId])

  async function loadInitial() {
    setLoading(true)
    try {
      const empresasData = await apiGet<Empresa[]>('/admin/empresas')
      setEmpresas(empresasData)
      setEmpresaId(empresasData[0]?.id || '')
      if (!empresasData[0]) setProdutos([])
    } catch (err) {
      toast.error('Erro ao carregar empresas', { description: (err as Error).message })
      setLoading(false)
    }
  }

  async function loadProdutos(id = empresaId) {
    if (!id) return
    setLoading(true)
    try {
      setProdutos(await apiGet<Produto[]>(`/admin/produtos?empresa_id=${id}`))
    } catch (err) {
      toast.error('Erro ao buscar produtos', { description: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }

  function openNew() {
    setForm({ ...emptyForm, empresa_id: empresaId })
    setShowModal(true)
  }

  function openEdit(produto: Produto) {
    setForm({
      id: produto.id,
      empresa_id: produto.empresa_id,
      descricao: produto.descricao || '',
      codigo_interno: produto.codigo_interno || '',
      ncm: produto.ncm || '',
      cfop: produto.cfop || '',
      unidade: produto.unidade || 'UN',
      valor_unitario: Number(produto.valor_unitario || 0),
      origem: Number(produto.origem || 0),
      cst_csosn: produto.cst_csosn || '',
      aliquota_icms: Number(produto.aliquota_icms || 0),
      aliquota_pis: Number(produto.aliquota_pis || 0),
      aliquota_cofins: Number(produto.aliquota_cofins || 0),
      tipo: produto.tipo || 'produto',
      ativo: produto.ativo,
    })
    setShowModal(true)
  }

  async function save() {
    if (!form.empresa_id || !form.descricao.trim()) {
      toast.warning('Preencha empresa e descricao')
      return
    }

    const payload = {
      ...form,
      valor_unitario: Number(form.valor_unitario || 0),
      origem: Number(form.origem || 0),
      aliquota_icms: Number(form.aliquota_icms || 0),
      aliquota_pis: Number(form.aliquota_pis || 0),
      aliquota_cofins: Number(form.aliquota_cofins || 0),
    }

    setSaving(true)
    try {
      if (form.id) await apiPatch(`/admin/produtos/${form.id}`, payload)
      else await apiPost('/admin/produtos', payload)
      toast.success(form.id ? 'Produto atualizado' : 'Produto criado')
      setShowModal(false)
      await loadProdutos(form.empresa_id)
    } catch (err) {
      toast.error('Erro ao salvar produto', { description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  async function remove(produto: Produto) {
    if (!confirm(`Excluir ${produto.descricao}?`)) return
    try {
      await apiDelete(`/admin/produtos/${produto.id}`)
      toast.success('Produto excluido')
      await loadProdutos()
    } catch (err) {
      toast.error('Erro ao excluir produto', { description: (err as Error).message })
    }
  }

  const input = 'w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30'
  const label = 'mb-1 block text-xs font-medium text-muted-dark'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
            <Package size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">Produtos e servicos</h1>
            <p className="text-sm text-muted">{empresaAtual?.nome || 'Selecione uma empresa'}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className={input} value={empresaId} onChange={(event) => setEmpresaId(event.target.value)}>
            {empresas.map((empresa) => (
              <option key={empresa.id} value={empresa.id}>{empresa.nome}</option>
            ))}
          </select>
          <button onClick={() => loadProdutos()} className="inline-flex items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-4 py-2 text-sm hover:bg-light-secondary">
            <RefreshCw size={14} /> Atualizar
          </button>
          <button onClick={openNew} disabled={!empresaId} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
            <Plus size={14} /> Novo
          </button>
        </div>
      </div>

      <section className="overflow-hidden rounded-lg border border-black/[0.06] bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/[0.06]">
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Descricao</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Fiscal</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Valor</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Tipo</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">Carregando...</td></tr>
            ) : produtos.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-muted">Nenhum produto cadastrado.</td></tr>
            ) : produtos.map((produto) => (
              <tr key={produto.id} className="border-b border-black/[0.04] hover:bg-light-secondary">
                <td className="px-4 py-3">
                  <div className="font-medium text-dark">{produto.descricao}</div>
                  <div className="text-xs text-muted">{produto.codigo_interno || '-'}</div>
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  <div>NCM {produto.ncm || '-'}</div>
                  <div>CFOP {produto.cfop || '-'}</div>
                </td>
                <td className="px-4 py-3 font-medium">{money(produto.valor_unitario)}</td>
                <td className="px-4 py-3 capitalize">{produto.tipo}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${produto.ativo ? 'bg-success-bg text-success' : 'bg-light-secondary text-muted-dark'}`}>
                    {produto.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openEdit(produto)} className="mr-2 rounded-lg border border-black/[0.08] p-2 hover:bg-white" title="Editar">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={() => remove(produto)} className="rounded-lg border border-error/20 p-2 text-error hover:bg-error/5" title="Excluir">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {showModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={() => !saving && setShowModal(false)}>
          <div className="w-full max-w-3xl rounded-lg bg-white" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-black/[0.06] p-5">
              <h3 className="font-semibold text-dark">{form.id ? 'Editar produto' : 'Novo produto'}</h3>
              <button onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            <div className="max-h-[72vh] space-y-4 overflow-y-auto p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className={label}>Empresa</label>
                  <select className={input} value={form.empresa_id} onChange={(event) => setForm((current) => ({ ...current, empresa_id: event.target.value }))}>
                    {empresas.map((empresa) => <option key={empresa.id} value={empresa.id}>{empresa.nome}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>Tipo</label>
                  <select className={input} value={form.tipo} onChange={(event) => setForm((current) => ({ ...current, tipo: event.target.value as 'produto' | 'servico' }))}>
                    <option value="produto">Produto</option>
                    <option value="servico">Servico</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className={label}>Descricao</label>
                  <input className={input} value={form.descricao} onChange={(event) => setForm((current) => ({ ...current, descricao: event.target.value }))} />
                </div>
                <div>
                  <label className={label}>Codigo interno</label>
                  <input className={input} value={form.codigo_interno} onChange={(event) => setForm((current) => ({ ...current, codigo_interno: event.target.value }))} />
                </div>
                <div>
                  <label className={label}>Valor unitario</label>
                  <input className={input} type="number" min="0" step="0.01" value={form.valor_unitario} onChange={(event) => setForm((current) => ({ ...current, valor_unitario: Number(event.target.value) }))} />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-4">
                <div>
                  <label className={label}>NCM</label>
                  <input className={input} value={form.ncm} onChange={(event) => setForm((current) => ({ ...current, ncm: event.target.value }))} />
                </div>
                <div>
                  <label className={label}>CFOP</label>
                  <input className={input} value={form.cfop} onChange={(event) => setForm((current) => ({ ...current, cfop: event.target.value }))} />
                </div>
                <div>
                  <label className={label}>Unidade</label>
                  <input className={input} value={form.unidade} onChange={(event) => setForm((current) => ({ ...current, unidade: event.target.value.toUpperCase() }))} />
                </div>
                <div>
                  <label className={label}>Origem</label>
                  <input className={input} type="number" min="0" max="8" value={form.origem} onChange={(event) => setForm((current) => ({ ...current, origem: Number(event.target.value) }))} />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-4">
                <div>
                  <label className={label}>CST/CSOSN</label>
                  <input className={input} value={form.cst_csosn} onChange={(event) => setForm((current) => ({ ...current, cst_csosn: event.target.value }))} />
                </div>
                <div>
                  <label className={label}>ICMS %</label>
                  <input className={input} type="number" min="0" max="100" step="0.01" value={form.aliquota_icms} onChange={(event) => setForm((current) => ({ ...current, aliquota_icms: Number(event.target.value) }))} />
                </div>
                <div>
                  <label className={label}>PIS %</label>
                  <input className={input} type="number" min="0" max="100" step="0.01" value={form.aliquota_pis} onChange={(event) => setForm((current) => ({ ...current, aliquota_pis: Number(event.target.value) }))} />
                </div>
                <div>
                  <label className={label}>COFINS %</label>
                  <input className={input} type="number" min="0" max="100" step="0.01" value={form.aliquota_cofins} onChange={(event) => setForm((current) => ({ ...current, aliquota_cofins: Number(event.target.value) }))} />
                </div>
                <label className="flex items-center gap-2 text-sm text-muted-dark">
                  <input type="checkbox" checked={form.ativo} onChange={(event) => setForm((current) => ({ ...current, ativo: event.target.checked }))} />
                  Ativo
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-black/[0.06] bg-light-secondary/40 p-3">
              <button onClick={() => setShowModal(false)} className="rounded-lg border border-black/[0.08] bg-white px-4 py-2 text-sm">Cancelar</button>
              <button onClick={save} disabled={saving} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
