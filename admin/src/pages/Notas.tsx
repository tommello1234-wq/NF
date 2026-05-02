import { useEffect, useState } from 'react'
import { Download, FileText, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { apiDownload, apiGet, apiPost } from '../lib/api'

interface Empresa {
  id: string
  nome: string
  razao_social: string
  cnpj: string
}

interface Nota {
  id: string
  empresa_id: string
  tipo: 'nfe' | 'nfce'
  numero: number | null
  serie: number | null
  chave_acesso: string | null
  protocolo: string | null
  status: string
  destinatario_nome: string | null
  destinatario_cpf_cnpj: string | null
  valor_total: string | number | null
  emitida_em: string | null
  created_at: string
  empresas?: {
    nome: string
    razao_social: string
    cnpj: string
  } | null
}

function money(value: unknown) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))
}

function dateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString('pt-BR') : '-'
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '')
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function Notas() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [notas, setNotas] = useState<Nota[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    empresa_id: '',
    tipo: 'nfe',
    serie: 1,
    destinatario_nome: 'Consumidor final',
    destinatario_cpf_cnpj: '00000000000',
    descricao: 'Prestacao de servico',
    valor_total: 100,
  })

  useEffect(() => {
    loadInitial()
  }, [])

  async function loadInitial() {
    try {
      const empresasData = await apiGet<Empresa[]>('/admin/empresas')
      setEmpresas(empresasData)
      if (empresasData[0]) {
        setForm((current) => ({ ...current, empresa_id: empresasData[0].id }))
      }
      await loadNotas()
    } catch (err) {
      toast.error('Erro ao carregar notas', { description: (err as Error).message })
    }
  }

  async function loadNotas() {
    setLoading(true)
    try {
      setNotas(await apiGet<Nota[]>('/admin/notas'))
    } catch (err) {
      toast.error('Erro ao buscar notas', { description: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }

  async function emitir() {
    if (!form.empresa_id) {
      toast.warning('Cadastre ou selecione uma empresa')
      return
    }
    if (!form.destinatario_nome.trim() || !form.descricao.trim() || Number(form.valor_total) <= 0) {
      toast.warning('Preencha destinatario, descricao e valor')
      return
    }

    setSaving(true)
    try {
      const nota = await apiPost<Nota & { aviso?: string }>('/admin/notas/emitir-simples', {
        ...form,
        destinatario_cpf_cnpj: onlyDigits(form.destinatario_cpf_cnpj),
        valor_total: Number(form.valor_total),
        serie: Number(form.serie),
      })
      toast.success('Nota simples gerada', { description: nota.aviso || undefined })
      await loadNotas()
    } catch (err) {
      toast.error('Erro ao gerar nota', { description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  async function baixar(nota: Nota, tipo: 'xml' | 'danfe') {
    try {
      const blob = await apiDownload(`/admin/notas/${nota.id}/${tipo}`)
      const ext = tipo === 'xml' ? 'xml' : 'pdf'
      downloadBlob(blob, `nota-${nota.chave_acesso || nota.id}.${ext}`)
    } catch (err) {
      toast.error(`Erro ao baixar ${tipo.toUpperCase()}`, { description: (err as Error).message })
    }
  }

  const input = 'w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30'
  const label = 'mb-1 block text-xs font-medium text-muted-dark'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
            <FileText size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">Notas fiscais simples</h1>
            <p className="text-sm text-muted">Geracao operacional com XML e DANFE para teste local</p>
          </div>
        </div>
        <button
          onClick={loadNotas}
          className="inline-flex items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-4 py-2 text-sm hover:bg-light-secondary"
        >
          <RefreshCw size={14} /> Atualizar
        </button>
      </div>

      <section className="rounded-lg border border-black/[0.06] bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <Plus size={18} className="text-accent" />
          <h2 className="font-semibold text-dark">Gerar nova nota</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="xl:col-span-2">
            <label className={label}>Empresa emitente</label>
            <select
              className={input}
              value={form.empresa_id}
              onChange={(event) => setForm((current) => ({ ...current, empresa_id: event.target.value }))}
            >
              <option value="">Selecione</option>
              {empresas.map((empresa) => (
                <option key={empresa.id} value={empresa.id}>
                  {empresa.nome} - {empresa.cnpj}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Tipo</label>
            <select
              className={input}
              value={form.tipo}
              onChange={(event) => setForm((current) => ({ ...current, tipo: event.target.value }))}
            >
              <option value="nfe">NF-e</option>
              <option value="nfce">NFC-e</option>
            </select>
          </div>
          <div>
            <label className={label}>Serie</label>
            <input
              className={input}
              type="number"
              min={1}
              value={form.serie}
              onChange={(event) => setForm((current) => ({ ...current, serie: Number(event.target.value) }))}
            />
          </div>
          <div className="xl:col-span-2">
            <label className={label}>Destinatario</label>
            <input
              className={input}
              value={form.destinatario_nome}
              onChange={(event) => setForm((current) => ({ ...current, destinatario_nome: event.target.value }))}
            />
          </div>
          <div>
            <label className={label}>CPF/CNPJ destinatario</label>
            <input
              className={input}
              value={form.destinatario_cpf_cnpj}
              onChange={(event) => setForm((current) => ({ ...current, destinatario_cpf_cnpj: event.target.value }))}
            />
          </div>
          <div>
            <label className={label}>Valor total</label>
            <input
              className={input}
              type="number"
              step="0.01"
              min="0.01"
              value={form.valor_total}
              onChange={(event) => setForm((current) => ({ ...current, valor_total: Number(event.target.value) }))}
            />
          </div>
          <div className="xl:col-span-4">
            <label className={label}>Descricao</label>
            <input
              className={input}
              value={form.descricao}
              onChange={(event) => setForm((current) => ({ ...current, descricao: event.target.value }))}
            />
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-warning/30 bg-warning-bg p-3 text-xs text-warning">
          Este fluxo gera documento de teste sem transmissao para SEFAZ e sem validade fiscal.
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={emitir}
            disabled={saving}
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? 'Gerando...' : 'Gerar nota simples'}
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-black/[0.06] bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/[0.06]">
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Numero</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Empresa</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Destinatario</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Valor</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Status</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Emissao</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted">Carregando...</td></tr>
            ) : notas.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-muted">Nenhuma nota gerada.</td></tr>
            ) : notas.map((nota) => (
              <tr key={nota.id} className="border-b border-black/[0.04] hover:bg-light-secondary">
                <td className="px-4 py-3">
                  <div className="font-semibold text-dark">{nota.numero || '-'}</div>
                  <div className="text-xs text-muted">{nota.tipo.toUpperCase()} serie {nota.serie || 1}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-dark">{nota.empresas?.nome || '-'}</div>
                  <div className="text-xs text-muted">{nota.empresas?.cnpj || '-'}</div>
                </td>
                <td className="px-4 py-3">
                  <div>{nota.destinatario_nome || '-'}</div>
                  <div className="text-xs text-muted">{nota.destinatario_cpf_cnpj || '-'}</div>
                </td>
                <td className="px-4 py-3 font-medium">{money(nota.valor_total)}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-semibold text-success">
                    {nota.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-muted">{dateTime(nota.emitida_em || nota.created_at)}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => baixar(nota, 'xml')}
                    className="mr-2 rounded-lg border border-black/[0.08] px-3 py-1.5 text-xs hover:bg-white"
                  >
                    XML
                  </button>
                  <button
                    onClick={() => baixar(nota, 'danfe')}
                    className="inline-flex items-center gap-1 rounded-lg border border-black/[0.08] px-3 py-1.5 text-xs hover:bg-white"
                  >
                    <Download size={12} /> DANFE
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
