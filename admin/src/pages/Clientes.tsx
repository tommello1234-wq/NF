import { useEffect, useMemo, useState } from 'react'
import { Archive, ArchiveRestore, ArrowDownAZ, ArrowUpAZ, ArrowUpDown, CheckCircle2, ChevronLeft, ChevronRight, Download, Edit2, FileDown, Filter, Plus, Power, PowerOff, RefreshCw, Search, Trash2, Upload, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { apiDeleteWithInfo, apiGet, apiPatch, apiPost } from '../lib/api'
import { useEmpresaAtual } from '../lib/empresaContext'
import ImportXlsxModal from '../components/ImportXlsxModal'
import AuditLogPanel from '../components/AuditLogPanel'
import {
  CLIENTES_IMPORT_COLUMNS,
  clienteToExportRow,
  downloadXlsx,
  parseClienteRow,
  type ClientePayload,
} from '../lib/xlsx-utils'

interface Cliente {
  id: string
  empresa_id: string
  arquivado?: boolean
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

type TipoPessoa = 'pf' | 'pj'

const emptyForm = {
  id: '',
  empresa_id: '',
  tipo_pessoa: 'pf' as TipoPessoa,
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

function inferTipo(doc: string): TipoPessoa {
  return onlyDigits(doc).length === 14 ? 'pj' : 'pf'
}

interface ViaCepResponse {
  cep?: string
  logradouro?: string
  complemento?: string
  bairro?: string
  localidade?: string
  uf?: string
  ibge?: string
  erro?: boolean | string
}

async function consultaCep(cep: string): Promise<ViaCepResponse | null> {
  const digits = onlyDigits(cep)
  if (digits.length !== 8) return null
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
    if (!res.ok) return null
    const data = (await res.json()) as ViaCepResponse
    if (data.erro) return null
    return data
  } catch {
    return null
  }
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '')
}

/** Cabeçalho clicável (3-clicks: A-Z → Z-A → padrão). */
function ColunaSort<C extends string>({
  col, label, current, dir, onClick,
}: {
  col: C
  label: string
  current: C | null
  dir: 'asc' | 'desc'
  onClick: (c: C) => void
}) {
  const active = current === col
  return (
    <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">
      <button
        onClick={() => onClick(col)}
        className={`inline-flex items-center gap-1.5 ${active ? 'text-success' : 'text-muted hover:text-dark'}`}
        title={active ? `Ordenado ${dir === 'asc' ? 'A→Z' : 'Z→A'} — clique para inverter ou voltar ao padrão` : `Ordenar por ${label}`}
      >
        <span>{label}</span>
        {active ? (
          <>
            {dir === 'asc' ? <ArrowUpAZ size={13} /> : <ArrowDownAZ size={13} />}
            <Filter size={11} className="opacity-70" />
            <CheckCircle2 size={11} className="text-success" />
          </>
        ) : (
          <ArrowUpDown size={11} className="opacity-50" />
        )}
      </button>
    </th>
  )
}

function valorParaSortCliente(
  c: { nome: string; cpf_cnpj: string; email: string | null; telefone: string | null; endereco_cidade: string | null; ativo: boolean },
  col: 'nome' | 'documento' | 'contato' | 'cidade' | 'status',
): string | number {
  switch (col) {
    case 'nome': return (c.nome || '').toLowerCase()
    case 'documento': return c.cpf_cnpj || ''
    case 'contato': return (c.email || c.telefone || '').toLowerCase()
    case 'cidade': return (c.endereco_cidade || '').toLowerCase()
    case 'status': return c.ativo ? 1 : 0
  }
}

/** Só conta arquivado quando o campo `arquivado` é true. Desativado ≠ arquivado. */
function isArquivado(c: { arquivado?: boolean; ativo: boolean }): boolean {
  return c.arquivado === true
}

function formatDoc(value: string) {
  const doc = onlyDigits(value)
  if (doc.length === 11) return doc.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  if (doc.length === 14) return doc.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  return value
}

export default function Clientes() {
  const { empresaId, empresaAtual } = useEmpresaAtual()
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [removerAlvo, setRemoverAlvo] = useState<Cliente | null>(null)
  const [removendo, setRemovendo] = useState(false)
  const [abaLista, setAbaLista] = useState<'ativos' | 'arquivados' | 'log'>('ativos')
  // Ordenação por coluna
  const [sortColuna, setSortColuna] = useState<'nome' | 'documento' | 'contato' | 'cidade' | 'status' | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  // Multi-select
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [confirmBulk, setConfirmBulk] = useState<'arquivar' | 'remover' | null>(null)
  const [executandoBulk, setExecutandoBulk] = useState(false)
  // Busca + paginação
  const [busca, setBusca] = useState('')
  const [pagina, setPagina] = useState(1)
  const [porPagina, setPorPagina] = useState<number>(50)
  useEffect(() => { setPagina(1) }, [abaLista, busca, porPagina])

  const ordenados = useMemo(() => {
    let filtrados = clientes.filter((c) => (abaLista === 'ativos' ? !isArquivado(c) : isArquivado(c)))
    const termo = busca.trim().toLowerCase()
    if (termo) {
      const normalize = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      const t = normalize(termo)
      filtrados = filtrados.filter((c) =>
        normalize(c.nome).includes(t) ||
        normalize(c.cpf_cnpj).includes(t) ||
        normalize(c.email).includes(t) ||
        normalize(c.telefone).includes(t) ||
        normalize(c.endereco_cidade).includes(t) ||
        normalize(c.endereco_uf).includes(t) ||
        normalize(c.ie).includes(t),
      )
    }
    return sortColuna
      ? [...filtrados].sort((a, b) => {
          const va = valorParaSortCliente(a, sortColuna)
          const vb = valorParaSortCliente(b, sortColuna)
          const cmp = typeof va === 'number' && typeof vb === 'number'
            ? va - vb
            : String(va).localeCompare(String(vb), 'pt-BR', { sensitivity: 'base' })
          return sortDir === 'asc' ? cmp : -cmp
        })
      : [...filtrados].sort((a, b) => {
          const aa = a.ativo ? 1 : 0
          const ab = b.ativo ? 1 : 0
          if (aa !== ab) return ab - aa
          return (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' })
        })
  }, [clientes, abaLista, busca, sortColuna, sortDir])

  const totalPaginas = porPagina === 0 ? 1 : Math.max(1, Math.ceil(ordenados.length / porPagina))
  const paginaCorrigida = Math.min(pagina, totalPaginas)
  const listaPaginada = porPagina === 0
    ? ordenados
    : ordenados.slice((paginaCorrigida - 1) * porPagina, paginaCorrigida * porPagina)

  function toggleSelecionado(id: string) {
    setSelecionados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function selecionarTodosVisiveis(ids: string[], dever: boolean) {
    setSelecionados((prev) => {
      const next = new Set(prev)
      if (dever) ids.forEach((id) => next.add(id))
      else ids.forEach((id) => next.delete(id))
      return next
    })
  }
  function limparSelecao() { setSelecionados(new Set()) }
  function selecionarTodosFiltrados() { setSelecionados(new Set(ordenados.map((c) => c.id))) }

  async function executarBulkAction(acao: 'ativar' | 'desativar' | 'arquivar' | 'desarquivar' | 'remover') {
    const ids = [...selecionados]
    if (ids.length === 0) return
    setExecutandoBulk(true)
    try {
      const res = await apiPost<{ sucesso: number; total: number; falhas: Array<{ id: string; erro: string }> }>(
        '/admin/clientes/bulk-action', { ids, acao },
      )
      const palavras: Record<string, string> = {
        ativar: 'ativados', desativar: 'desativados',
        arquivar: 'arquivados', desarquivar: 'restaurados', remover: 'removidos',
      }
      if (res.sucesso === res.total) toast.success(`${res.sucesso} cliente(s) ${palavras[acao]}`)
      else toast.warning(`${res.sucesso}/${res.total} cliente(s) ${palavras[acao]} — ${res.falhas.length} falharam`)
      limparSelecao()
      setConfirmBulk(null)
      await loadClientes()
    } catch (err) {
      toast.error(`Erro ao ${acao}`, { description: (err as Error).message })
    } finally {
      setExecutandoBulk(false)
    }
  }

  function clickColuna(col: NonNullable<typeof sortColuna>) {
    if (sortColuna !== col) {
      setSortColuna(col)
      setSortDir('asc')
    } else if (sortDir === 'asc') {
      setSortDir('desc')
    } else {
      setSortColuna(null)
    }
  }

  async function alternarAtivo(cliente: Cliente) {
    const novoEstado = !cliente.ativo
    setClientes((current) => current.map((c) => (c.id === cliente.id ? { ...c, ativo: novoEstado } : c)))
    try {
      await apiPatch(`/admin/clientes/${cliente.id}`, { ativo: novoEstado })
      toast.success(novoEstado ? 'Cliente ativado' : 'Cliente desativado', { duration: 1500 })
    } catch (err) {
      setClientes((current) => current.map((c) => (c.id === cliente.id ? { ...c, ativo: !novoEstado } : c)))
      toast.error('Erro ao alterar status', { description: (err as Error).message })
    }
  }

  function exportarXlsx() {
    if (clientes.length === 0) {
      toast.warning('Nada para exportar — lista vazia')
      return
    }
    const rows = clientes.map(clienteToExportRow)
    const cols = ['Nome / Razão Social', 'CPF / CNPJ', 'Inscrição Estadual', 'Email', 'Telefone', 'Endereço', 'Número', 'Bairro', 'Cidade', 'UF', 'CEP', 'Ativo']
    const date = new Date().toISOString().slice(0, 10)
    const empresaSlug = (empresaAtual?.nome || empresaAtual?.razao_social || 'empresa')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
    downloadXlsx(`clientes-${empresaSlug}-${date}.xlsx`, 'Clientes', cols, rows)
    toast.success(`${clientes.length} clientes exportados`)
  }

  function baixarModelo() {
    downloadXlsx(
      'planilha_modelo_importacao_clientes.xlsx',
      'Clientes',
      [...CLIENTES_IMPORT_COLUMNS],
      [],
    )
    toast.success('Modelo de importação baixado')
  }
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    if (empresaId) loadClientes(empresaId)
    else {
      setClientes([])
      setLoading(false)
    }
  }, [empresaId])

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
      tipo_pessoa: inferTipo(cliente.cpf_cnpj || ''),
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

  function trocarTipo(novo: TipoPessoa) {
    setForm((current) => ({
      ...current,
      tipo_pessoa: novo,
      // PF não tem IE — limpa quando troca pra PF
      ie: novo === 'pf' ? '' : current.ie,
    }))
  }

  const [buscandoCep, setBuscandoCep] = useState(false)

  async function handleCepChange(novoCep: string) {
    setForm((current) => ({ ...current, endereco_cep: novoCep }))
    const digits = onlyDigits(novoCep)
    if (digits.length !== 8) return
    setBuscandoCep(true)
    try {
      const data = await consultaCep(digits)
      if (!data) {
        toast.warning('CEP não encontrado')
        return
      }
      setForm((current) => ({
        ...current,
        endereco_logradouro: data.logradouro || current.endereco_logradouro,
        endereco_bairro: data.bairro || current.endereco_bairro,
        endereco_cidade: data.localidade || current.endereco_cidade,
        endereco_uf: (data.uf || current.endereco_uf || 'CE').toUpperCase().slice(0, 2),
        endereco_codigo_ibge: data.ibge || current.endereco_codigo_ibge,
      }))
    } finally {
      setBuscandoCep(false)
    }
  }

  async function save() {
    if (!form.empresa_id || !form.nome.trim() || !form.cpf_cnpj.trim()) {
      toast.warning('Preencha empresa, nome e CPF/CNPJ')
      return
    }

    const docDigits = onlyDigits(form.cpf_cnpj)
    const docEsperado = form.tipo_pessoa === 'pf' ? 11 : 14
    if (docDigits.length !== docEsperado) {
      toast.warning(form.tipo_pessoa === 'pf' ? 'CPF deve ter 11 dígitos' : 'CNPJ deve ter 14 dígitos')
      return
    }

    // tipo_pessoa é só pra UI — não vai pro backend
    const { tipo_pessoa: _ignored, ...rest } = form
    void _ignored
    const payload = {
      ...rest,
      cpf_cnpj: docDigits,
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

  function pedirRemover(cliente: Cliente) {
    setRemoverAlvo(cliente)
  }

  async function executarExclusao() {
    if (!removerAlvo) return
    setRemovendo(true)
    try {
      const res = await apiDeleteWithInfo(`/admin/clientes/${removerAlvo.id}`)
      if (res.ok) {
        toast.success(`Cliente "${removerAlvo.nome}" excluído`)
        setRemoverAlvo(null)
        await loadClientes()
        return
      }
      if (res.status === 409 && res.body.sugestao === 'inativar') {
        toast.warning('Cliente está em uso', {
          description: 'Já foi usado em vendas, notas ou O.S. — use "Apenas inativar" para escondê-lo da lista.',
          duration: 6000,
        })
        return
      }
      toast.error('Erro ao excluir', { description: res.body.error || `HTTP ${res.status}` })
    } catch (err) {
      console.error('[Clientes.remove] DELETE falhou:', err)
      toast.error('Erro inesperado ao excluir', { description: (err as Error).message })
    } finally {
      setRemovendo(false)
    }
  }

  async function executarArquivamento() {
    if (!removerAlvo) return
    setRemovendo(true)
    try {
      await apiPost(`/admin/clientes/${removerAlvo.id}/inativar`)
      toast.success(`Cliente "${removerAlvo.nome}" arquivado`)
      setRemoverAlvo(null)
      await loadClientes()
    } catch (err) {
      console.error('[Clientes.arquivar] falhou:', err)
      toast.error('Erro ao arquivar', { description: (err as Error).message })
    } finally {
      setRemovendo(false)
    }
  }

  async function restaurar(cliente: Cliente) {
    try {
      await apiPost(`/admin/clientes/${cliente.id}/restaurar`)
      toast.success(`Cliente "${cliente.nome}" restaurado`)
      await loadClientes()
    } catch (err) {
      console.error('[Clientes.restaurar] falhou:', err)
      toast.error('Erro ao restaurar', { description: (err as Error).message })
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
          <button onClick={baixarModelo} title="Baixar planilha modelo de importação (vazia)" className="inline-flex items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm hover:bg-light-secondary">
            <FileDown size={14} /> Modelo
          </button>
          <button onClick={exportarXlsx} disabled={!empresaId || clientes.length === 0} title="Exportar para xlsx (formato ssÓtica)" className="inline-flex items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm hover:bg-light-secondary disabled:opacity-50">
            <Download size={14} /> Exportar
          </button>
          <button onClick={() => setShowImport(true)} disabled={!empresaId} title="Importar lista a partir de xlsx" className="inline-flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-accent hover:bg-accent/10 disabled:opacity-50">
            <Upload size={14} /> Importar
          </button>
          <button onClick={() => loadClientes()} className="inline-flex items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm hover:bg-light-secondary">
            <RefreshCw size={14} /> Atualizar
          </button>
          <button onClick={openNew} disabled={!empresaId} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
            <Plus size={14} /> Novo
          </button>
        </div>
      </div>

      {/* Barra de busca */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[260px]">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, CPF/CNPJ, email, telefone, cidade..."
            className="w-full rounded-lg border border-black/[0.08] bg-white py-2 pl-9 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          {busca && (
            <button onClick={() => setBusca('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-dark" title="Limpar busca">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-dark">
          <span>Por página:</span>
          <select value={porPagina} onChange={(e) => setPorPagina(Number(e.target.value))} className="rounded-lg border border-black/[0.08] bg-white px-2 py-1.5 text-sm">
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={500}>500</option>
          </select>
        </div>
      </div>

      {/* Tabs Ativos / Arquivados */}
      {(() => {
        const qtdAtivos = clientes.filter((c) => !isArquivado(c)).length
        const qtdArquivados = clientes.filter((c) => isArquivado(c)).length
        return (
          <div className="flex flex-wrap gap-1 border-b border-black/[0.06]">
            {[
              { k: 'ativos', label: 'Clientes', count: qtdAtivos },
              { k: 'arquivados', label: 'Arquivados', count: qtdArquivados },
              { k: 'log', label: 'Alterações', count: 0 },
            ].map((tab) => {
              const active = abaLista === tab.k
              return (
                <button
                  key={tab.k}
                  onClick={() => { setAbaLista(tab.k as 'ativos' | 'arquivados' | 'log'); limparSelecao() }}
                  className={`whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                    active ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-dark'
                  }`}
                >
                  {tab.label}
                  {tab.count > 0 && (
                    <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? 'bg-accent text-white' : 'bg-neutral-100 text-neutral-600'}`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )
      })()}

      {abaLista === 'log' && empresaId && (
        <AuditLogPanel
          empresaId={empresaId}
          entidade="cliente"
          onReverter={() => void loadClientes()}
        />
      )}

      {/* Toolbar de ações em lote */}
      {abaLista !== 'log' && selecionados.size > 0 && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-accent/40 bg-accent/5 p-3 shadow-sm">
          <div className="text-sm font-semibold text-dark">
            <strong>{selecionados.size}</strong> cliente{selecionados.size > 1 ? 's' : ''} selecionado{selecionados.size > 1 ? 's' : ''}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => executarBulkAction('ativar')} disabled={executandoBulk}
              className="inline-flex items-center gap-1 rounded-lg border border-success/30 bg-success/5 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/10 disabled:opacity-50">
              <Power size={13} /> Ativar
            </button>
            <button onClick={() => executarBulkAction('desativar')} disabled={executandoBulk}
              className="inline-flex items-center gap-1 rounded-lg border border-black/[0.08] bg-white px-3 py-1.5 text-xs font-medium text-muted-dark hover:bg-light-secondary disabled:opacity-50">
              <PowerOff size={13} /> Desativar
            </button>
            {abaLista === 'ativos' ? (
              <button onClick={() => setConfirmBulk('arquivar')} disabled={executandoBulk}
                className="inline-flex items-center gap-1 rounded-lg border border-warning/30 bg-warning/5 px-3 py-1.5 text-xs font-medium text-warning-dark hover:bg-warning/10 disabled:opacity-50">
                <Archive size={13} /> Arquivar
              </button>
            ) : (
              <button onClick={() => executarBulkAction('desarquivar')} disabled={executandoBulk}
                className="inline-flex items-center gap-1 rounded-lg border border-success/30 bg-success/5 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/10 disabled:opacity-50">
                <ArchiveRestore size={13} /> Restaurar
              </button>
            )}
            <button onClick={() => setConfirmBulk('remover')} disabled={executandoBulk}
              className="inline-flex items-center gap-1 rounded-lg border border-error/30 bg-error/5 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/10 disabled:opacity-50">
              <Trash2 size={13} /> Remover
            </button>
            <button onClick={selecionarTodosFiltrados}
              disabled={executandoBulk || selecionados.size >= ordenados.length}
              className="inline-flex items-center gap-1 rounded-lg border border-accent/30 bg-accent/5 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
              title={`Marcar todos os ${ordenados.length} cliente(s) filtrado(s)`}>
              <CheckCircle2 size={13} /> Selecionar todos ({ordenados.length})
            </button>
            <button onClick={limparSelecao} disabled={executandoBulk}
              className="inline-flex items-center gap-1 rounded-lg border border-black/[0.08] bg-white px-3 py-1.5 text-xs text-muted-dark hover:bg-light-secondary disabled:opacity-50">
              <X size={13} /> Limpar seleção
            </button>
          </div>
        </div>
      )}

      {abaLista !== 'log' && <section className="overflow-hidden rounded-lg border border-black/[0.06] bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/[0.06]">
              {(() => {
                const visiveis = listaPaginada.map((c) => c.id)
                const todos = visiveis.length > 0 && visiveis.every((id) => selecionados.has(id))
                const alguns = visiveis.some((id) => selecionados.has(id)) && !todos
                return (
                  <th className="w-10 px-3 py-3 text-left">
                    <input
                      type="checkbox"
                      ref={(el) => { if (el) el.indeterminate = alguns }}
                      checked={todos}
                      onChange={(e) => selecionarTodosVisiveis(visiveis, e.target.checked)}
                      className="h-4 w-4 cursor-pointer accent-accent"
                    />
                  </th>
                )
              })()}
              <ColunaSort col="nome" label="Nome" current={sortColuna} dir={sortDir} onClick={clickColuna} />
              <ColunaSort col="documento" label="Documento" current={sortColuna} dir={sortDir} onClick={clickColuna} />
              <ColunaSort col="contato" label="Contato" current={sortColuna} dir={sortDir} onClick={clickColuna} />
              <ColunaSort col="cidade" label="Cidade/UF" current={sortColuna} dir={sortDir} onClick={clickColuna} />
              {abaLista === 'ativos' && (
                <ColunaSort col="status" label="Status" current={sortColuna} dir={sortDir} onClick={clickColuna} />
              )}
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {(() => {
              const colsTotal = (abaLista === 'ativos' ? 6 : 5) + 1
              if (loading) return <tr><td colSpan={colsTotal} className="px-4 py-8 text-center text-muted">Carregando...</td></tr>
              if (listaPaginada.length === 0) return (
                <tr><td colSpan={colsTotal} className="px-4 py-12 text-center text-muted">
                  {busca.trim()
                    ? `Nenhum cliente encontrado para "${busca}".`
                    : abaLista === 'ativos' ? 'Nenhum cliente cadastrado.' : 'Nenhum cliente arquivado.'}
                </td></tr>
              )
              return listaPaginada.map((cliente) => (
              <tr key={cliente.id} className={`border-b border-black/[0.04] hover:bg-light-secondary ${selecionados.has(cliente.id) ? 'bg-accent/5' : ''}`}>
                <td className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={selecionados.has(cliente.id)}
                    onChange={() => toggleSelecionado(cliente.id)}
                    className="h-4 w-4 cursor-pointer accent-accent"
                  />
                </td>
                <td className="px-4 py-3 font-medium text-dark">{cliente.nome}</td>
                <td className="px-4 py-3 font-mono text-xs">{formatDoc(cliente.cpf_cnpj)}</td>
                <td className="px-4 py-3 text-xs text-muted">
                  <div>{cliente.email || '-'}</div>
                  <div>{cliente.telefone || '-'}</div>
                </td>
                <td className="px-4 py-3 text-muted-dark">
                  {cliente.endereco_cidade ? `${cliente.endereco_cidade}/${cliente.endereco_uf || '-'}` : '-'}
                </td>
                {abaLista === 'ativos' && (
                  <td className="px-4 py-3">
                    <button
                      onClick={() => alternarAtivo(cliente)}
                      title={cliente.ativo ? 'Clique para desativar (continua em Ativos)' : 'Clique para ativar'}
                      className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        cliente.ativo
                          ? 'bg-success-bg text-success hover:bg-success/20'
                          : 'bg-light-secondary text-muted-dark hover:bg-success/10'
                      }`}
                    >
                      <span className={`inline-block h-3.5 w-6 rounded-full transition-colors ${cliente.ativo ? 'bg-success' : 'bg-neutral-300'} relative`}>
                        <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${cliente.ativo ? 'left-3' : 'left-0.5'}`} />
                      </span>
                      {cliente.ativo ? 'Ativo' : 'Desativado'}
                    </button>
                  </td>
                )}
                <td className="px-4 py-3 text-right">
                  {abaLista === 'arquivados' ? (
                    <>
                      <button onClick={() => restaurar(cliente)} className="mr-2 inline-flex items-center gap-1 rounded-lg border border-success/30 bg-success/5 px-2 py-1 text-xs text-success hover:bg-success/10" title="Restaurar cliente (volta pra Ativos)">
                        <ArchiveRestore size={13} /> Restaurar
                      </button>
                      <button onClick={() => pedirRemover(cliente)} className="rounded-lg border border-error/20 p-2 text-error hover:bg-error/5" title="Excluir definitivamente">
                        <Trash2 size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => openEdit(cliente)} className="mr-2 rounded-lg border border-black/[0.08] p-2 hover:bg-white" title="Editar">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => pedirRemover(cliente)} className="rounded-lg border border-error/20 p-2 text-error hover:bg-error/5" title="Excluir / Arquivar">
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </td>
              </tr>
              ))
            })()}
          </tbody>
        </table>
      </section>}

      {/* Footer de paginação */}
      {abaLista !== 'log' && porPagina !== 0 && ordenados.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-black/[0.06] bg-white px-4 py-2 text-sm">
          <div className="text-xs text-muted-dark">
            Mostrando <strong>{(paginaCorrigida - 1) * porPagina + 1}</strong>–
            <strong>{Math.min(paginaCorrigida * porPagina, ordenados.length)}</strong>{' '}
            de <strong>{ordenados.length}</strong>
            {busca.trim() && (
              <span className="ml-1 text-muted">(filtrados de {clientes.filter((c) => (abaLista === 'ativos' ? !isArquivado(c) : isArquivado(c))).length})</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setPagina(1)} disabled={paginaCorrigida === 1}
              className="rounded border border-black/[0.08] bg-white px-2 py-1 text-xs hover:bg-light-secondary disabled:opacity-30" title="Primeira página">«</button>
            <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={paginaCorrigida === 1}
              className="inline-flex items-center rounded border border-black/[0.08] bg-white px-2 py-1 text-xs hover:bg-light-secondary disabled:opacity-30">
              <ChevronLeft size={14} /> Anterior
            </button>
            <span className="px-2 text-xs">Pág. <strong>{paginaCorrigida}</strong> / {totalPaginas}</span>
            <button onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={paginaCorrigida >= totalPaginas}
              className="inline-flex items-center rounded border border-black/[0.08] bg-white px-2 py-1 text-xs hover:bg-light-secondary disabled:opacity-30">
              Próxima <ChevronRight size={14} />
            </button>
            <button onClick={() => setPagina(totalPaginas)} disabled={paginaCorrigida >= totalPaginas}
              className="rounded border border-black/[0.08] bg-white px-2 py-1 text-xs hover:bg-light-secondary disabled:opacity-30" title="Última página">»</button>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={() => !saving && setShowModal(false)}>
          <div className="w-full max-w-3xl rounded-lg bg-white" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-black/[0.06] p-5">
              <h3 className="font-semibold text-dark">{form.id ? 'Editar cliente' : 'Novo cliente'}</h3>
              <button onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            <div className="max-h-[72vh] space-y-4 overflow-y-auto p-5">
              <div className="rounded-lg border border-info/20 bg-info-bg p-3 text-xs text-info">
                Cadastre aqui as <strong>pessoas que compram de voce</strong> (tomadores do servico).
                Os campos sao dados do <strong>cliente</strong>, nao da sua empresa.
              </div>

              {/* Toggle PF / PJ */}
              <div>
                <label className={label}>Tipo de cliente</label>
                <div className="inline-flex rounded-lg border border-black/[0.08] bg-light-secondary p-0.5">
                  <button
                    type="button"
                    onClick={() => trocarTipo('pf')}
                    className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                      form.tipo_pessoa === 'pf'
                        ? 'bg-white text-dark shadow-sm'
                        : 'text-muted hover:text-dark'
                    }`}
                  >
                    Pessoa Fisica
                  </button>
                  <button
                    type="button"
                    onClick={() => trocarTipo('pj')}
                    className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                      form.tipo_pessoa === 'pj'
                        ? 'bg-white text-dark shadow-sm'
                        : 'text-muted hover:text-dark'
                    }`}
                  >
                    Pessoa Juridica
                  </button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className={label}>Empresa emitente (sua)</label>
                  <input className={input} value={empresaAtual?.nome || empresaAtual?.razao_social || '—'} disabled readOnly />
                  <p className="mt-1 text-[11px] text-muted">Cliente vinculado à empresa selecionada na barra superior.</p>
                </div>

                {form.tipo_pessoa === 'pf' ? (
                  <>
                    <div>
                      <label className={label}>Nome completo</label>
                      <input
                        className={input}
                        placeholder="Nome do comprador"
                        value={form.nome}
                        onChange={(event) => setForm((current) => ({ ...current, nome: event.target.value }))}
                      />
                    </div>
                    <div>
                      <label className={label}>CPF</label>
                      <input
                        className={input}
                        placeholder="000.000.000-00"
                        maxLength={14}
                        value={form.cpf_cnpj}
                        onChange={(event) => setForm((current) => ({ ...current, cpf_cnpj: event.target.value }))}
                      />
                      <p className="mt-1 text-[11px] text-muted">11 digitos (so numeros)</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className={label}>Razao social</label>
                      <input
                        className={input}
                        placeholder="Razao social da empresa cliente"
                        value={form.nome}
                        onChange={(event) => setForm((current) => ({ ...current, nome: event.target.value }))}
                      />
                    </div>
                    <div>
                      <label className={label}>CNPJ</label>
                      <input
                        className={input}
                        placeholder="00.000.000/0000-00"
                        maxLength={18}
                        value={form.cpf_cnpj}
                        onChange={(event) => setForm((current) => ({ ...current, cpf_cnpj: event.target.value }))}
                      />
                      <p className="mt-1 text-[11px] text-muted">14 digitos (so numeros)</p>
                    </div>
                    <div className="md:col-span-2">
                      <label className={label}>Inscricao estadual (opcional)</label>
                      <input
                        className={input}
                        placeholder="Deixe vazio se isento"
                        value={form.ie}
                        onChange={(event) => setForm((current) => ({ ...current, ie: event.target.value }))}
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className={label}>Email</label>
                  <input className={input} placeholder="email@exemplo.com" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
                </div>
                <div>
                  <label className={label}>Telefone</label>
                  <input className={input} placeholder="(00) 00000-0000" value={form.telefone} onChange={(event) => setForm((current) => ({ ...current, telefone: event.target.value }))} />
                </div>
              </div>
              <div className="border-t border-black/[0.06] pt-4">
                <h4 className="mb-3 text-xs font-semibold uppercase text-muted">Endereco do cliente</h4>
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="md:col-span-2">
                    <label className={label}>
                      CEP {buscandoCep && <span className="ml-1 text-info">(buscando...)</span>}
                    </label>
                    <input
                      className={input}
                      placeholder="00000-000"
                      maxLength={9}
                      value={form.endereco_cep}
                      onChange={(event) => handleCepChange(event.target.value)}
                    />
                    <p className="mt-1 text-[11px] text-muted">
                      Ao digitar o CEP, logradouro, bairro, cidade, UF e codigo IBGE sao preenchidos automaticamente.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <label className={label}>Logradouro</label>
                    <input className={input} value={form.endereco_logradouro} onChange={(event) => setForm((current) => ({ ...current, endereco_logradouro: event.target.value }))} />
                  </div>
                  <div>
                    <label className={label}>Numero</label>
                    <input className={input} placeholder="123 ou S/N" value={form.endereco_numero} onChange={(event) => setForm((current) => ({ ...current, endereco_numero: event.target.value }))} />
                  </div>
                  <div className="md:col-span-2">
                    <label className={label}>Bairro</label>
                    <input className={input} value={form.endereco_bairro} onChange={(event) => setForm((current) => ({ ...current, endereco_bairro: event.target.value }))} />
                  </div>
                  <div>
                    <label className={label}>UF</label>
                    <input className={input} maxLength={2} value={form.endereco_uf} onChange={(event) => setForm((current) => ({ ...current, endereco_uf: event.target.value.toUpperCase().slice(0, 2) }))} />
                  </div>
                  <div className="md:col-span-3">
                    <label className={label}>Cidade</label>
                    <input className={input} value={form.endereco_cidade} onChange={(event) => setForm((current) => ({ ...current, endereco_cidade: event.target.value }))} />
                  </div>
                  <div>
                    <label className={label}>
                      Cod. IBGE
                      <span className="ml-1 text-[10px] font-normal text-muted">(automatico)</span>
                    </label>
                    <input
                      className={input + ' bg-light-secondary'}
                      readOnly
                      value={form.endereco_codigo_ibge}
                      title="Preenchido automaticamente pelo CEP"
                    />
                  </div>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-muted-dark">
                <input type="checkbox" checked={form.ativo} onChange={(event) => setForm((current) => ({ ...current, ativo: event.target.checked }))} />
                Ativo
              </label>
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

      {confirmBulk && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
             onClick={() => !executandoBulk && setConfirmBulk(null)}>
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-black/[0.06] p-5">
              <h3 className="font-semibold text-dark">
                {confirmBulk === 'arquivar' ? 'Arquivar em lote' : 'Remover em lote'}
              </h3>
              <p className="mt-2 text-sm text-muted">
                Você vai {confirmBulk === 'arquivar' ? 'arquivar' : 'remover definitivamente'}{' '}
                <strong className="text-dark">{selecionados.size} cliente{selecionados.size > 1 ? 's' : ''}</strong>.
              </p>
              {confirmBulk === 'remover' && (
                <p className="mt-2 text-xs text-error">
                  ⚠️ Clientes já usados em vendas/notas/O.S. não vão poder ser removidos — esses ficam intactos.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-black/[0.06] bg-light-secondary/40 p-3">
              <button onClick={() => setConfirmBulk(null)} disabled={executandoBulk}
                className="rounded-lg border border-black/[0.08] bg-white px-4 py-2 text-sm disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={() => executarBulkAction(confirmBulk)} disabled={executandoBulk}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                  confirmBulk === 'remover' ? 'bg-error hover:bg-error/90' : 'bg-warning hover:bg-warning/90'
                }`}>
                {executandoBulk ? 'Aplicando...' : confirmBulk === 'arquivar' ? 'Sim, arquivar todos' : 'Sim, remover todos'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport && empresaId && (
        <ImportXlsxModal<ClientePayload>
          titulo="Importar clientes (xlsx)"
          empresaId={empresaId}
          empresaNome={empresaAtual?.nome || empresaAtual?.razao_social || '—'}
          bulkEndpoint="/admin/clientes/bulk"
          bulkKey="clientes"
          parseRow={parseClienteRow}
          permiteAtualizar
          onClose={() => setShowImport(false)}
          onConcluido={() => void loadClientes()}
        />
      )}

      {removerAlvo && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !removendo && setRemoverAlvo(null)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-black/[0.06] p-5">
              <h3 className="font-semibold text-dark">Remover cliente</h3>
              <p className="mt-2 text-sm text-muted">
                O que deseja fazer com <strong className="text-dark">"{removerAlvo.nome}"</strong>?
              </p>
            </div>
            <div className="space-y-2 p-5">
              <button
                onClick={executarExclusao}
                disabled={removendo}
                className="w-full rounded-lg border border-error/30 bg-white px-4 py-3 text-left text-sm hover:bg-error/5 disabled:opacity-50"
              >
                <div className="font-semibold text-error">Excluir definitivamente</div>
                <div className="mt-0.5 text-xs text-muted">
                  Remove do banco. Falha se já foi usado em alguma venda, nota fiscal ou O.S.
                </div>
              </button>
              <button
                onClick={executarArquivamento}
                disabled={removendo}
                className="w-full rounded-lg border border-warning/30 bg-white px-4 py-3 text-left text-sm hover:bg-warning/5 disabled:opacity-50"
              >
                <div className="font-semibold text-warning-dark">Arquivar (recomendado)</div>
                <div className="mt-0.5 text-xs text-muted">
                  Move para a aba "Arquivados". Não aparece mais na lista ativa nem em vendas, mas preserva o histórico fiscal. Você pode restaurar depois.
                </div>
              </button>
            </div>
            <div className="flex justify-end gap-2 border-t border-black/[0.06] bg-light-secondary/40 p-3">
              <button
                onClick={() => setRemoverAlvo(null)}
                disabled={removendo}
                className="rounded-lg border border-black/[0.08] bg-white px-4 py-2 text-sm disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
