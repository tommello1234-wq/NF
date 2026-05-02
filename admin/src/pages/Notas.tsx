import { useEffect, useState } from 'react'
import { Download, FileText, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { apiDownload, apiGet, apiPost } from '../lib/api'

interface Empresa {
  id: string
  nome: string
  razao_social: string
  cnpj: string
  serie_nfe?: number
  serie_nfce?: number
}

interface Cliente {
  id: string
  nome: string
  cpf_cnpj: string
  ativo: boolean
}

interface Produto {
  id: string
  descricao: string
  codigo_interno?: string | null
  ncm?: string | null
  cfop?: string | null
  unidade?: string | null
  cst_csosn?: string | null
  aliquota_icms?: string | number | null
  aliquota_pis?: string | number | null
  aliquota_cofins?: string | number | null
  valor_unitario: string | number | null
  ativo: boolean
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
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [notas, setNotas] = useState<Nota[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    empresa_id: '',
    cliente_id: '',
    produto_id: '',
    tipo: 'nfe',
    serie: 1,
    destinatario_nome: 'Consumidor final',
    destinatario_cpf_cnpj: '00000000000',
    descricao: 'Prestacao de servico',
    quantidade: 1,
    valor_unitario: 100,
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
        setForm((current) => ({ ...current, empresa_id: empresasData[0].id, serie: empresasData[0].serie_nfe || 1 }))
        await loadCadastros(empresasData[0].id)
      }
      await loadNotas()
    } catch (err) {
      toast.error('Erro ao carregar notas', { description: (err as Error).message })
    }
  }

  async function loadCadastros(empresaId: string) {
    const [clientesData, produtosData] = await Promise.all([
      apiGet<Cliente[]>(`/admin/clientes?empresa_id=${empresaId}&ativo=true`).catch(() => []),
      apiGet<Produto[]>(`/admin/produtos?empresa_id=${empresaId}&ativo=true`).catch(() => []),
    ])
    setClientes(clientesData)
    setProdutos(produtosData)
  }

  async function changeEmpresa(empresaId: string) {
    const empresa = empresas.find((item) => item.id === empresaId)
    setForm((current) => ({
      ...current,
      empresa_id: empresaId,
      cliente_id: '',
      produto_id: '',
      serie: current.tipo === 'nfce' ? empresa?.serie_nfce || 1 : empresa?.serie_nfe || 1,
    }))
    if (empresaId) await loadCadastros(empresaId)
  }

  function changeTipo(tipo: string) {
    const empresa = empresas.find((item) => item.id === form.empresa_id)
    setForm((current) => ({
      ...current,
      tipo,
      serie: tipo === 'nfce' ? empresa?.serie_nfce || 1 : empresa?.serie_nfe || 1,
    }))
  }

  function changeCliente(clienteId: string) {
    const cliente = clientes.find((item) => item.id === clienteId)
    setForm((current) => ({
      ...current,
      cliente_id: clienteId,
      destinatario_nome: cliente?.nome || current.destinatario_nome,
      destinatario_cpf_cnpj: cliente?.cpf_cnpj || current.destinatario_cpf_cnpj,
    }))
  }

  function changeProduto(produtoId: string) {
    const produto = produtos.find((item) => item.id === produtoId)
    const valorUnitario = Number(produto?.valor_unitario || form.valor_unitario || 0)
    setForm((current) => ({
      ...current,
      produto_id: produtoId,
      descricao: produto?.descricao || current.descricao,
      valor_unitario: valorUnitario,
      valor_total: valorUnitario * Number(current.quantidade || 1),
    }))
  }

  function changeQuantidade(value: number) {
    const quantidade = Number(value || 1)
    setForm((current) => ({
      ...current,
      quantidade,
      valor_total: quantidade * Number(current.valor_unitario || 0),
    }))
  }

  function changeValorUnitario(value: number) {
    const valorUnitario = Number(value || 0)
    setForm((current) => ({
      ...current,
      valor_unitario: valorUnitario,
      valor_total: valorUnitario * Number(current.quantidade || 1),
    }))
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
        valor_unitario: Number(form.valor_unitario),
        quantidade: Number(form.quantidade),
        serie: Number(form.serie),
        cliente_id: form.cliente_id || null,
        produto_id: form.produto_id || null,
      })
      toast.success('Pre-NF-e gerada', { description: nota.aviso || undefined })
      await loadNotas()
    } catch (err) {
      toast.error('Erro ao gerar pre-NF-e', { description: (err as Error).message })
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
            <h1 className="text-2xl font-bold text-dark">Pre-NF-e</h1>
            <p className="text-sm text-muted">XML 4.00 e DANFE de conferencia antes da transmissao SEFAZ</p>
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
          <h2 className="font-semibold text-dark">Gerar pre-NF-e</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="xl:col-span-2">
            <label className={label}>Empresa emitente</label>
            <select
              className={input}
              value={form.empresa_id}
              onChange={(event) => changeEmpresa(event.target.value)}
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
              onChange={(event) => changeTipo(event.target.value)}
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
            <label className={label}>Cliente cadastrado</label>
            <select
              className={input}
              value={form.cliente_id}
              onChange={(event) => changeCliente(event.target.value)}
            >
              <option value="">Preencher manualmente</option>
              {clientes.map((cliente) => (
                <option key={cliente.id} value={cliente.id}>{cliente.nome}</option>
              ))}
            </select>
          </div>
          <div className="xl:col-span-2">
            <label className={label}>Produto/servico cadastrado</label>
            <select
              className={input}
              value={form.produto_id}
              onChange={(event) => changeProduto(event.target.value)}
            >
              <option value="">Preencher manualmente</option>
              {produtos.map((produto) => (
                <option key={produto.id} value={produto.id}>{produto.descricao}</option>
              ))}
            </select>
          </div>
          {form.produto_id && (
            <div className="xl:col-span-4 rounded-lg border border-info/20 bg-info-bg p-3 text-xs text-info">
              {(() => {
                const produto = produtos.find((item) => item.id === form.produto_id)
                return produto
                  ? `Fiscal do item: NCM ${produto.ncm || '-'} | CFOP ${produto.cfop || '-'} | CST/CSOSN ${produto.cst_csosn || '-'} | ICMS ${produto.aliquota_icms || 0}% | PIS ${produto.aliquota_pis || 0}% | COFINS ${produto.aliquota_cofins || 0}%`
                  : ''
              })()}
            </div>
          )}
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
            <label className={label}>Quantidade</label>
            <input
              className={input}
              type="number"
              step="0.01"
              min="0.01"
              value={form.quantidade}
              onChange={(event) => changeQuantidade(Number(event.target.value))}
            />
          </div>
          <div>
            <label className={label}>Valor unitario</label>
            <input
              className={input}
              type="number"
              step="0.01"
              min="0.01"
              value={form.valor_unitario}
              onChange={(event) => changeValorUnitario(Number(event.target.value))}
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
          Este fluxo gera XML de pre-NF-e e DANFE de conferencia. Para validade fiscal ainda falta assinar o XML, transmitir para SEFAZ e receber protocolo autorizado.
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={emitir}
            disabled={saving}
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? 'Gerando...' : 'Gerar pre-NF-e'}
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
