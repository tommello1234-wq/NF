import { useEffect, useMemo, useState } from 'react'
import { Edit2, Plus, RefreshCw, Trash2, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/api'

interface Empresa {
  id: string
  nome: string
  cnpj: string
}

interface Cliente {
  id: string
  empresa_id: string
  nome: string
  cpf_cnpj: string
  ie: string | null
  email: string | null
  telefone: string | null
  endereco_logradouro: string | null
  endereco_numero: string | null
  endereco_bairro: string | null
  endereco_cidade: string | null
  endereco_uf: string | null
  endereco_cep: string | null
  endereco_codigo_ibge: string | null
  ativo: boolean
}

const emptyForm = {
  id: '',
  empresa_id: '',
  nome: '',
  cpf_cnpj: '',
  ie: '',
  email: '',
  telefone: '',
  endereco_logradouro: '',
  endereco_numero: '',
  endereco_bairro: '',
  endereco_cidade: '',
  endereco_uf: 'CE',
  endereco_cep: '',
  endereco_codigo_ibge: '',
  ativo: true,
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '')
}

function formatDoc(value: string) {
  const doc = onlyDigits(value)
  if (doc.length === 11) return doc.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  if (doc.length === 14) return doc.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  return value
}

export default function Clientes() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
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
    if (empresaId) loadClientes(empresaId)
  }, [empresaId])

  async function loadInitial() {
    setLoading(true)
    try {
      const empresasData = await apiGet<Empresa[]>('/admin/empresas')
      setEmpresas(empresasData)
      setEmpresaId(empresasData[0]?.id || '')
      if (!empresasData[0]) setClientes([])
    } catch (err) {
      toast.error('Erro ao carregar empresas', { description: (err as Error).message })
      setLoading(false)
    }
  }

  async function loadClientes(id = empresaId) {
    if (!id) return
    setLoading(true)
    try {
      setClientes(await apiGet<Cliente[]>(`/admin/clientes?empresa_id=${id}`))
    } catch (err) {
      toast.error('Erro ao buscar clientes', { description: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }

  function openNew() {
    setForm({ ...emptyForm, empresa_id: empresaId })
    setShowModal(true)
  }

  function openEdit(cliente: Cliente) {
    setForm({
      id: cliente.id,
      empresa_id: cliente.empresa_id,
      nome: cliente.nome || '',
      cpf_cnpj: cliente.cpf_cnpj || '',
      ie: cliente.ie || '',
      email: cliente.email || '',
      telefone: cliente.telefone || '',
      endereco_logradouro: cliente.endereco_logradouro || '',
      endereco_numero: cliente.endereco_numero || '',
      endereco_bairro: cliente.endereco_bairro || '',
      endereco_cidade: cliente.endereco_cidade || '',
      endereco_uf: cliente.endereco_uf || 'CE',
      endereco_cep: cliente.endereco_cep || '',
      endereco_codigo_ibge: cliente.endereco_codigo_ibge || '',
      ativo: cliente.ativo,
    })
    setShowModal(true)
  }

  async function save() {
    if (!form.empresa_id || !form.nome.trim() || !form.cpf_cnpj.trim()) {
      toast.warning('Preencha empresa, nome e CPF/CNPJ')
      return
    }

    const payload = {
      ...form,
      cpf_cnpj: onlyDigits(form.cpf_cnpj),
      endereco_uf: form.endereco_uf.toUpperCase().slice(0, 2),
    }

    setSaving(true)
    try {
      if (form.id) await apiPatch(`/admin/clientes/${form.id}`, payload)
      else await apiPost('/admin/clientes', payload)
      toast.success(form.id ? 'Cliente atualizado' : 'Cliente criado')
      setShowModal(false)
      await loadClientes(form.empresa_id)
    } catch (err) {
      toast.error('Erro ao salvar cliente', { description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  async function remove(cliente: Cliente) {
    if (!confirm(`Excluir ${cliente.nome}?`)) return
    try {
      await apiDelete(`/admin/clientes/${cliente.id}`)
      toast.success('Cliente excluido')
      await loadClientes()
    } catch (err) {
      toast.error('Erro ao excluir cliente', { description: (err as Error).message })
    }
  }

  const input = 'w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30'
  const label = 'mb-1 block text-xs font-medium text-muted-dark'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
            <Users size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">Clientes</h1>
            <p className="text-sm text-muted">{empresaAtual?.nome || 'Selecione uma empresa'}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className={input} value={empresaId} onChange={(event) => setEmpresaId(event.target.value)}>
            {empresas.map((empresa) => (
              <option key={empresa.id} value={empresa.id}>{empresa.nome}</option>
            ))}
          </select>
          <button onClick={() => loadClientes()} className="inline-flex items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-4 py-2 text-sm hover:bg-light-secondary">
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
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Nome</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Documento</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Contato</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Cidade/UF</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">Carregando...</td></tr>
            ) : clientes.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-muted">Nenhum cliente cadastrado.</td></tr>
            ) : clientes.map((cliente) => (
              <tr key={cliente.id} className="border-b border-black/[0.04] hover:bg-light-secondary">
                <td className="px-4 py-3 font-medium text-dark">{cliente.nome}</td>
                <td className="px-4 py-3 font-mono text-xs">{formatDoc(cliente.cpf_cnpj)}</td>
                <td className="px-4 py-3 text-xs text-muted">
                  <div>{cliente.email || '-'}</div>
                  <div>{cliente.telefone || '-'}</div>
                </td>
                <td className="px-4 py-3 text-muted-dark">
                  {cliente.endereco_cidade ? `${cliente.endereco_cidade}/${cliente.endereco_uf || '-'}` : '-'}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cliente.ativo ? 'bg-success-bg text-success' : 'bg-light-secondary text-muted-dark'}`}>
                    {cliente.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openEdit(cliente)} className="mr-2 rounded-lg border border-black/[0.08] p-2 hover:bg-white" title="Editar">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={() => remove(cliente)} className="rounded-lg border border-error/20 p-2 text-error hover:bg-error/5" title="Excluir">
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
              <h3 className="font-semibold text-dark">{form.id ? 'Editar cliente' : 'Novo cliente'}</h3>
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
                  <label className={label}>Nome/Razao social</label>
                  <input className={input} value={form.nome} onChange={(event) => setForm((current) => ({ ...current, nome: event.target.value }))} />
                </div>
                <div>
                  <label className={label}>CPF/CNPJ</label>
                  <input className={input} value={form.cpf_cnpj} onChange={(event) => setForm((current) => ({ ...current, cpf_cnpj: event.target.value }))} />
                </div>
                <div>
                  <label className={label}>Inscricao estadual</label>
                  <input className={input} value={form.ie} onChange={(event) => setForm((current) => ({ ...current, ie: event.target.value }))} />
                </div>
                <div>
                  <label className={label}>Email</label>
                  <input className={input} value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
                </div>
                <div>
                  <label className={label}>Telefone</label>
                  <input className={input} value={form.telefone} onChange={(event) => setForm((current) => ({ ...current, telefone: event.target.value }))} />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className={label}>Logradouro</label>
                  <input className={input} value={form.endereco_logradouro} onChange={(event) => setForm((current) => ({ ...current, endereco_logradouro: event.target.value }))} />
                </div>
                <div>
                  <label className={label}>Numero</label>
                  <input className={input} value={form.endereco_numero} onChange={(event) => setForm((current) => ({ ...current, endereco_numero: event.target.value }))} />
                </div>
                <div>
                  <label className={label}>Bairro</label>
                  <input className={input} value={form.endereco_bairro} onChange={(event) => setForm((current) => ({ ...current, endereco_bairro: event.target.value }))} />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="md:col-span-2">
                  <label className={label}>Cidade</label>
                  <input className={input} value={form.endereco_cidade} onChange={(event) => setForm((current) => ({ ...current, endereco_cidade: event.target.value }))} />
                </div>
                <div>
                  <label className={label}>UF</label>
                  <input className={input} maxLength={2} value={form.endereco_uf} onChange={(event) => setForm((current) => ({ ...current, endereco_uf: event.target.value.toUpperCase().slice(0, 2) }))} />
                </div>
                <div>
                  <label className={label}>CEP</label>
                  <input className={input} value={form.endereco_cep} onChange={(event) => setForm((current) => ({ ...current, endereco_cep: event.target.value }))} />
                </div>
                <div className="md:col-span-2">
                  <label className={label}>Codigo IBGE</label>
                  <input className={input} value={form.endereco_codigo_ibge} onChange={(event) => setForm((current) => ({ ...current, endereco_codigo_ibge: event.target.value }))} />
                </div>
                <label className="mt-6 flex items-center gap-2 text-sm text-muted-dark">
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
