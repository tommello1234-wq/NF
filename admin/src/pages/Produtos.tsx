import { useEffect, useMemo, useState } from 'react'
import { Archive, ArchiveRestore, ArrowDownAZ, ArrowUpAZ, ArrowUpDown, CheckCircle2, ChevronLeft, ChevronRight, Download, Edit2, FileDown, Filter, Package, Plus, Power, PowerOff, RefreshCw, Search, Trash2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { apiDeleteWithInfo, apiGet, apiPatch, apiPost } from '../lib/api'
import { useEmpresaAtual } from '../lib/empresaContext'
import ImportXlsxModal from '../components/ImportXlsxModal'
import AuditLogPanel from '../components/AuditLogPanel'
import {
  PRODUTOS_IMPORT_COLUMNS,
  downloadXlsx,
  parseProdutoRow,
  produtoToExportRow,
  type ProdutoPayload,
} from '../lib/xlsx-utils'

interface Produto {
  id: string
  empresa_id: string
  // Migration 019 — separa estado arquivado de ativo
  arquivado?: boolean
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
  gtin: string | null
  cest: string | null
  peso_liquido: string | number | null
  peso_bruto: string | number | null
  unidade_tributavel: string | null
  ex_tipi: string | null
  aliquota_ipi: string | number | null
  cst_pis: string | null
  cst_cofins: string | null
  cst_ipi: string | null
  info_adicional_produto: string | null
  estoque: string | number | null
  codigo_lc116: string | null
  codigo_tributario_municipal: string | null
  codigo_nbs: string | null
  cnae: string | null
  aliquota_iss: string | number | null
  iss_retido: boolean
  tipo: 'produto' | 'servico'
  ativo: boolean
  // ---- novos campos (migration 016) ----
  referencia?: string | null
  marca?: string | null
  controla_estoque?: boolean
  venda_somente_com_os?: boolean
  observacao?: string | null
  // CFOPs
  cfop_venda_dentro?: string | null
  cfop_devolucao_dentro?: string | null
  cfop_remessa_garantia_dentro?: string | null
  cfop_transferencia_dentro?: string | null
  cfop_venda_futura_dentro?: string | null
  cfop_entrega_venda_dentro?: string | null
  cfop_venda_fora?: string | null
  cfop_devolucao_fora?: string | null
  cfop_remessa_garantia_fora?: string | null
  cfop_transferencia_fora?: string | null
  cfop_venda_futura_fora?: string | null
  cfop_entrega_venda_fora?: string | null
  cfop_compra_dentro?: string | null
  cfop_compra_fora?: string | null
  // ICMS
  csosn?: string | null
  cst_icms?: string | null
  cst_icms_venda_futura?: string | null
  cst_icms_entrega?: string | null
  aliquota_credito_icms?: string | number | null
  percentual_base_calculo_icms?: string | number | null
  // ICMS-ST
  aliquota_icms_st?: string | number | null
  percentual_mva?: string | number | null
  percentual_reducao_bc_st?: string | number | null
  // IPI extra
  codigo_enquadramento_ipi?: string | null
  tipo_calculo_ipi?: string | null
  valor_unitario_ipi?: string | number | null
  qtde_total_ipi?: string | number | null
  classe_enquadramento_ipi?: string | null
  cnpj_produtor_ipi?: string | null
  codigo_selo_controle_ipi?: string | null
  qtde_selo_controle_ipi?: string | number | null
  // PIS/COFINS extra
  tipo_calculo_pis?: string | null
  valor_unitario_pis?: string | number | null
  qtde_total_pis?: string | number | null
  tipo_calculo_cofins?: string | null
  valor_unitario_cofins?: string | number | null
  qtde_total_cofins?: string | number | null
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
  gtin: '',
  cest: '',
  peso_liquido: 0,
  peso_bruto: 0,
  unidade_tributavel: '',
  ex_tipi: '',
  aliquota_ipi: 0,
  cst_pis: '',
  cst_cofins: '',
  cst_ipi: '',
  info_adicional_produto: '',
  estoque: 0,
  codigo_lc116: '',
  codigo_tributario_municipal: '',
  codigo_nbs: '',
  cnae: '',
  aliquota_iss: 0,
  iss_retido: false,
  tipo: 'produto' as 'produto' | 'servico',
  ativo: true,
  // novos
  referencia: '',
  marca: '',
  controla_estoque: true,
  venda_somente_com_os: false,
  observacao: '',
  cfop_venda_dentro: '',
  cfop_devolucao_dentro: '',
  cfop_remessa_garantia_dentro: '',
  cfop_transferencia_dentro: '',
  cfop_venda_futura_dentro: '',
  cfop_entrega_venda_dentro: '',
  cfop_venda_fora: '',
  cfop_devolucao_fora: '',
  cfop_remessa_garantia_fora: '',
  cfop_transferencia_fora: '',
  cfop_venda_futura_fora: '',
  cfop_entrega_venda_fora: '',
  cfop_compra_dentro: '',
  cfop_compra_fora: '',
  csosn: '',
  cst_icms: '',
  cst_icms_venda_futura: '',
  cst_icms_entrega: '',
  aliquota_credito_icms: 0,
  percentual_base_calculo_icms: 0,
  aliquota_icms_st: 0,
  percentual_mva: 0,
  percentual_reducao_bc_st: 0,
  codigo_enquadramento_ipi: '',
  tipo_calculo_ipi: 'percentual',
  valor_unitario_ipi: 0,
  qtde_total_ipi: 0,
  classe_enquadramento_ipi: '',
  cnpj_produtor_ipi: '',
  codigo_selo_controle_ipi: '',
  qtde_selo_controle_ipi: 0,
  tipo_calculo_pis: 'percentual',
  valor_unitario_pis: 0,
  qtde_total_pis: 0,
  tipo_calculo_cofins: 'percentual',
  valor_unitario_cofins: 0,
  qtde_total_cofins: 0,
}

type AbaFiscal = 'cfop-saida' | 'icms' | 'icms-st' | 'cfop-entrada' | 'ipi' | 'pis' | 'cofins'
type AbaPrincipal = 'dados' | 'estoque' | 'fiscal' | 'outros'

function money(value: unknown) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))
}

/**
 * Determina se um produto está na aba "Arquivados".
 *
 * Só considera arquivado quando a coluna `arquivado` existe e é true.
 * Produtos `ativo=false` (desativados via toggle) NÃO são arquivados —
 * eles ficam na aba principal junto com os ativos.
 */
function isArquivado(p: { arquivado?: boolean; ativo: boolean }): boolean {
  return p.arquivado === true
}

/**
 * Cabeçalho de coluna clicável (ordenação 3-clicks: A-Z → Z-A → padrão).
 * Quando ativo: mostra ícone verde + funil. Outras colunas têm ícone discreto cinza.
 */
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

/** Extrai o valor numérico/string da coluna `col` de um produto para sort. */
function valorParaSort(
  p: { descricao: string; ncm: string | null; cfop_venda_dentro?: string | null; cfop?: string | null; valor_unitario: string | number | null; tipo: string; ativo: boolean },
  col: 'descricao' | 'fiscal' | 'valor' | 'tipo' | 'status',
): string | number {
  switch (col) {
    case 'descricao': return (p.descricao || '').toLowerCase()
    case 'fiscal': return (p.ncm || p.cfop_venda_dentro || p.cfop || '').toLowerCase()
    case 'valor': return Number(p.valor_unitario || 0)
    case 'tipo': return (p.tipo || '').toLowerCase()
    case 'status': return p.ativo ? 1 : 0
  }
}

export default function Produtos() {
  const { empresaId, empresaAtual } = useEmpresaAtual()
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [removerAlvo, setRemoverAlvo] = useState<Produto | null>(null)
  const [removendo, setRemovendo] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [aba, setAba] = useState<AbaPrincipal>('dados')
  const [abaFiscal, setAbaFiscal] = useState<AbaFiscal>('cfop-saida')
  const [abaLista, setAbaLista] = useState<'ativos' | 'arquivados' | 'log'>('ativos')
  // Ordenação por coluna: null = ordem original
  const [sortColuna, setSortColuna] = useState<'descricao' | 'fiscal' | 'valor' | 'tipo' | 'status' | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  // Multi-select em lote
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [confirmBulk, setConfirmBulk] = useState<'arquivar' | 'remover' | null>(null)
  const [executandoBulk, setExecutandoBulk] = useState(false)
  // Busca + paginação
  const [busca, setBusca] = useState('')
  const [pagina, setPagina] = useState(1)
  const [porPagina, setPorPagina] = useState<number>(50)

  function exportarXlsx() {
    if (produtos.length === 0) {
      toast.warning('Nada para exportar — lista vazia')
      return
    }
    const rows = produtos.map(produtoToExportRow)
    const date = new Date().toISOString().slice(0, 10)
    const empresaSlug = (empresaAtual?.nome || empresaAtual?.razao_social || 'empresa')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
    downloadXlsx(
      `exportacao-produtos-${empresaSlug}-${date}.xlsx`,
      empresaAtual?.nome || empresaAtual?.razao_social || 'Produtos',
      [...PRODUTOS_IMPORT_COLUMNS],
      rows,
    )
    toast.success(`${produtos.length} produtos exportados`)
  }

  function baixarModelo() {
    downloadXlsx(
      'planilha_modelo_importacao_produtos.xlsx',
      'Produtos',
      [...PRODUTOS_IMPORT_COLUMNS],
      [],
    )
    toast.success('Modelo de importação baixado')
  }

  useEffect(() => {
    if (empresaId) loadProdutos(empresaId)
    else {
      setProdutos([])
      setLoading(false)
    }
  }, [empresaId])

  // Reset paginação quando muda aba, busca ou porPagina
  useEffect(() => { setPagina(1) }, [abaLista, busca, porPagina])

  // ---- Pipeline filtragem + ordenação (memoizado, usado pela tabela e pelo footer de paginação) ----
  const ordenados = useMemo(() => {
    let filtrados = produtos.filter((p) => (abaLista === 'ativos' ? !isArquivado(p) : isArquivado(p)))
    const termo = busca.trim().toLowerCase()
    if (termo) {
      const normalize = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      const term = normalize(termo)
      filtrados = filtrados.filter((p) =>
        normalize(p.descricao).includes(term) ||
        normalize(p.referencia).includes(term) ||
        normalize(p.codigo_interno).includes(term) ||
        normalize(p.ncm).includes(term) ||
        normalize(p.gtin).includes(term) ||
        normalize(p.cest).includes(term) ||
        normalize(p.marca).includes(term) ||
        normalize(p.cfop_venda_dentro).includes(term),
      )
    }
    return sortColuna
      ? [...filtrados].sort((a, b) => {
          const va = valorParaSort(a, sortColuna)
          const vb = valorParaSort(b, sortColuna)
          const cmp = typeof va === 'number' && typeof vb === 'number'
            ? va - vb
            : String(va).localeCompare(String(vb), 'pt-BR', { sensitivity: 'base' })
          return sortDir === 'asc' ? cmp : -cmp
        })
      : [...filtrados].sort((a, b) => {
          const aa = a.ativo ? 1 : 0
          const ab = b.ativo ? 1 : 0
          if (aa !== ab) return ab - aa
          return (a.descricao || '').localeCompare(b.descricao || '', 'pt-BR', { sensitivity: 'base' })
        })
  }, [produtos, abaLista, busca, sortColuna, sortDir])

  const totalPaginas = porPagina === 0 ? 1 : Math.max(1, Math.ceil(ordenados.length / porPagina))
  const paginaCorrigida = Math.min(pagina, totalPaginas)
  const listaPaginada = porPagina === 0
    ? ordenados
    : ordenados.slice((paginaCorrigida - 1) * porPagina, paginaCorrigida * porPagina)

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
    setAba('dados')
    setAbaFiscal('cfop-saida')
    setShowModal(true)
  }

  function openEdit(produto: Produto) {
    setForm({
      ...emptyForm,
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
      gtin: produto.gtin || '',
      cest: produto.cest || '',
      peso_liquido: Number(produto.peso_liquido || 0),
      peso_bruto: Number(produto.peso_bruto || 0),
      unidade_tributavel: produto.unidade_tributavel || '',
      ex_tipi: produto.ex_tipi || '',
      aliquota_ipi: Number(produto.aliquota_ipi || 0),
      cst_pis: produto.cst_pis || '',
      cst_cofins: produto.cst_cofins || '',
      cst_ipi: produto.cst_ipi || '',
      info_adicional_produto: produto.info_adicional_produto || '',
      estoque: Number(produto.estoque || 0),
      codigo_lc116: produto.codigo_lc116 || '',
      codigo_tributario_municipal: produto.codigo_tributario_municipal || '',
      codigo_nbs: produto.codigo_nbs || '',
      cnae: produto.cnae || '',
      aliquota_iss: Number(produto.aliquota_iss || 0),
      iss_retido: Boolean(produto.iss_retido),
      tipo: produto.tipo || 'produto',
      ativo: produto.ativo,
      referencia: produto.referencia || '',
      marca: produto.marca || '',
      controla_estoque: produto.controla_estoque ?? true,
      venda_somente_com_os: produto.venda_somente_com_os ?? false,
      observacao: produto.observacao || '',
      cfop_venda_dentro: produto.cfop_venda_dentro || '',
      cfop_devolucao_dentro: produto.cfop_devolucao_dentro || '',
      cfop_remessa_garantia_dentro: produto.cfop_remessa_garantia_dentro || '',
      cfop_transferencia_dentro: produto.cfop_transferencia_dentro || '',
      cfop_venda_futura_dentro: produto.cfop_venda_futura_dentro || '',
      cfop_entrega_venda_dentro: produto.cfop_entrega_venda_dentro || '',
      cfop_venda_fora: produto.cfop_venda_fora || '',
      cfop_devolucao_fora: produto.cfop_devolucao_fora || '',
      cfop_remessa_garantia_fora: produto.cfop_remessa_garantia_fora || '',
      cfop_transferencia_fora: produto.cfop_transferencia_fora || '',
      cfop_venda_futura_fora: produto.cfop_venda_futura_fora || '',
      cfop_entrega_venda_fora: produto.cfop_entrega_venda_fora || '',
      cfop_compra_dentro: produto.cfop_compra_dentro || '',
      cfop_compra_fora: produto.cfop_compra_fora || '',
      csosn: produto.csosn || produto.cst_csosn || '',
      cst_icms: produto.cst_icms || '',
      cst_icms_venda_futura: produto.cst_icms_venda_futura || '',
      cst_icms_entrega: produto.cst_icms_entrega || '',
      aliquota_credito_icms: Number(produto.aliquota_credito_icms || 0),
      percentual_base_calculo_icms: Number(produto.percentual_base_calculo_icms || 0),
      aliquota_icms_st: Number(produto.aliquota_icms_st || 0),
      percentual_mva: Number(produto.percentual_mva || 0),
      percentual_reducao_bc_st: Number(produto.percentual_reducao_bc_st || 0),
      codigo_enquadramento_ipi: produto.codigo_enquadramento_ipi || '',
      tipo_calculo_ipi: produto.tipo_calculo_ipi || 'percentual',
      valor_unitario_ipi: Number(produto.valor_unitario_ipi || 0),
      qtde_total_ipi: Number(produto.qtde_total_ipi || 0),
      classe_enquadramento_ipi: produto.classe_enquadramento_ipi || '',
      cnpj_produtor_ipi: produto.cnpj_produtor_ipi || '',
      codigo_selo_controle_ipi: produto.codigo_selo_controle_ipi || '',
      qtde_selo_controle_ipi: Number(produto.qtde_selo_controle_ipi || 0),
      tipo_calculo_pis: produto.tipo_calculo_pis || 'percentual',
      valor_unitario_pis: Number(produto.valor_unitario_pis || 0),
      qtde_total_pis: Number(produto.qtde_total_pis || 0),
      tipo_calculo_cofins: produto.tipo_calculo_cofins || 'percentual',
      valor_unitario_cofins: Number(produto.valor_unitario_cofins || 0),
      qtde_total_cofins: Number(produto.qtde_total_cofins || 0),
    })
    setAba('dados')
    setAbaFiscal('cfop-saida')
    setShowModal(true)
  }

  async function save() {
    if (!form.empresa_id || !form.descricao.trim()) {
      toast.warning('Preencha empresa e descrição')
      return
    }

    const payload = {
      ...form,
      valor_unitario: Number(form.valor_unitario || 0),
      origem: Number(form.origem || 0),
      aliquota_icms: Number(form.aliquota_icms || 0),
      aliquota_pis: Number(form.aliquota_pis || 0),
      aliquota_cofins: Number(form.aliquota_cofins || 0),
      aliquota_ipi: Number(form.aliquota_ipi || 0),
      aliquota_iss: Number(form.aliquota_iss || 0),
      peso_liquido: Number(form.peso_liquido || 0),
      peso_bruto: Number(form.peso_bruto || 0),
      estoque: Number(form.estoque || 0),
      aliquota_credito_icms: Number(form.aliquota_credito_icms || 0),
      percentual_base_calculo_icms: Number(form.percentual_base_calculo_icms || 0),
      aliquota_icms_st: Number(form.aliquota_icms_st || 0),
      percentual_mva: Number(form.percentual_mva || 0),
      percentual_reducao_bc_st: Number(form.percentual_reducao_bc_st || 0),
      valor_unitario_ipi: Number(form.valor_unitario_ipi || 0),
      qtde_total_ipi: Number(form.qtde_total_ipi || 0),
      qtde_selo_controle_ipi: Number(form.qtde_selo_controle_ipi || 0),
      valor_unitario_pis: Number(form.valor_unitario_pis || 0),
      qtde_total_pis: Number(form.qtde_total_pis || 0),
      valor_unitario_cofins: Number(form.valor_unitario_cofins || 0),
      qtde_total_cofins: Number(form.qtde_total_cofins || 0),
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

  /** Abre o modal de remoção (com escolha entre excluir/inativar). */
  function pedirRemover(produto: Produto) {
    setRemoverAlvo(produto)
  }

  async function executarExclusao() {
    if (!removerAlvo) return
    setRemovendo(true)
    try {
      const res = await apiDeleteWithInfo(`/admin/produtos/${removerAlvo.id}`)
      if (res.ok) {
        toast.success(`Produto "${removerAlvo.descricao}" excluído`)
        setRemoverAlvo(null)
        await loadProdutos()
        return
      }
      if (res.status === 409 && res.body.sugestao === 'inativar') {
        toast.warning('Produto está em uso', {
          description: 'Já foi usado em vendas, notas ou O.S. — use "Apenas inativar" pra escondê-lo da lista.',
          duration: 6000,
        })
        return
      }
      toast.error('Erro ao excluir', { description: res.body.error || `HTTP ${res.status}` })
    } catch (err) {
      console.error('[Produtos.remove] DELETE falhou:', err)
      toast.error('Erro inesperado ao excluir', { description: (err as Error).message })
    } finally {
      setRemovendo(false)
    }
  }

  async function executarArquivamento() {
    if (!removerAlvo) return
    setRemovendo(true)
    try {
      await apiPost(`/admin/produtos/${removerAlvo.id}/inativar`)
      toast.success(`Produto "${removerAlvo.descricao}" arquivado`)
      setRemoverAlvo(null)
      await loadProdutos()
    } catch (err) {
      console.error('[Produtos.arquivar] falhou:', err)
      toast.error('Erro ao arquivar', { description: (err as Error).message })
    } finally {
      setRemovendo(false)
    }
  }

  /** Restaura um produto arquivado (volta pra aba Ativos). */
  async function restaurar(produto: Produto) {
    try {
      await apiPost(`/admin/produtos/${produto.id}/restaurar`)
      toast.success(`Produto "${produto.descricao}" restaurado`)
      await loadProdutos()
    } catch (err) {
      console.error('[Produtos.restaurar] falhou:', err)
      toast.error('Erro ao restaurar', { description: (err as Error).message })
    }
  }

  /**
   * Toggle inline ativo↔desativado. NÃO move pra aba Arquivados — só muda o
   * status visual. Pra arquivar de fato, usa a lixeira → "Arquivar".
   */
  async function alternarAtivo(produto: Produto) {
    const novoEstado = !produto.ativo
    // Optimistic update
    setProdutos((current) => current.map((p) => (p.id === produto.id ? { ...p, ativo: novoEstado } : p)))
    try {
      await apiPatch(`/admin/produtos/${produto.id}`, { ativo: novoEstado })
      toast.success(novoEstado ? 'Produto ativado' : 'Produto desativado', { duration: 1500 })
    } catch (err) {
      setProdutos((current) => current.map((p) => (p.id === produto.id ? { ...p, ativo: !novoEstado } : p)))
      toast.error('Erro ao alterar status', { description: (err as Error).message })
    }
  }

  // ---- Multi-select ----
  function toggleSelecionado(id: string) {
    setSelecionados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selecionarTodosVisiveis(ids: string[], deveSelecionar: boolean) {
    setSelecionados((prev) => {
      const next = new Set(prev)
      if (deveSelecionar) ids.forEach((id) => next.add(id))
      else ids.forEach((id) => next.delete(id))
      return next
    })
  }

  function limparSelecao() {
    setSelecionados(new Set())
  }

  /** Marca TODOS os produtos da aba+busca atual (todas as páginas). */
  function selecionarTodosFiltrados() {
    setSelecionados(new Set(ordenados.map((p) => p.id)))
  }

  /** Executa ação em lote sobre os selecionados. */
  async function executarBulkAction(acao: 'ativar' | 'desativar' | 'arquivar' | 'desarquivar' | 'remover') {
    const ids = [...selecionados]
    if (ids.length === 0) return
    setExecutandoBulk(true)
    try {
      const res = await apiPost<{ sucesso: number; total: number; falhas: Array<{ id: string; erro: string }> }>(
        '/admin/produtos/bulk-action',
        { ids, acao },
      )
      const palavras: Record<string, string> = {
        ativar: 'ativados', desativar: 'desativados',
        arquivar: 'arquivados', desarquivar: 'restaurados', remover: 'removidos',
      }
      if (res.sucesso === res.total) {
        toast.success(`${res.sucesso} produto(s) ${palavras[acao]}`)
      } else {
        toast.warning(`${res.sucesso}/${res.total} produto(s) ${palavras[acao]} — ${res.falhas.length} falharam`)
      }
      limparSelecao()
      setConfirmBulk(null)
      await loadProdutos()
    } catch (err) {
      console.error('[Produtos.bulkAction] falhou:', err)
      toast.error(`Erro ao ${acao}`, { description: (err as Error).message })
    } finally {
      setExecutandoBulk(false)
    }
  }

  /**
   * Click na coluna para ordenar.
   * Ciclo: nada → asc → desc → nada (volta à ordem importada)
   */
  function clickColuna(col: NonNullable<typeof sortColuna>) {
    if (sortColuna !== col) {
      setSortColuna(col)
      setSortDir('asc')
    } else if (sortDir === 'asc') {
      setSortDir('desc')
    } else {
      setSortColuna(null) // 3º click → volta ao padrão
    }
  }

  const input = 'w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30'
  const label = 'mb-1 block text-xs font-medium text-muted-dark'

  const setFormField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  function renderAbaDados() {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={label}>Empresa</label>
            <input className={input} value={empresaAtual?.nome || empresaAtual?.razao_social || '—'} disabled readOnly />
          </div>
          <div>
            <label className={label}>Tipo</label>
            <select className={input} value={form.tipo} onChange={(e) => setFormField('tipo', e.target.value as 'produto' | 'servico')}>
              <option value="produto">Produto</option>
              <option value="servico">Serviço</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className={label}>Descrição / Nome *</label>
            <input className={input} value={form.descricao} onChange={(e) => setFormField('descricao', e.target.value)} />
          </div>
          <div>
            <label className={label}>Código interno</label>
            <input className={input} value={form.codigo_interno} onChange={(e) => setFormField('codigo_interno', e.target.value)} />
          </div>
          <div>
            <label className={label}>Referência</label>
            <input className={input} value={form.referencia} onChange={(e) => setFormField('referencia', e.target.value)} />
          </div>
          <div>
            <label className={label}>Código GTIN / EAN</label>
            <input className={input} placeholder="código de barras ou SEM GTIN" value={form.gtin} onChange={(e) => setFormField('gtin', e.target.value.toUpperCase())} />
          </div>
          <div>
            <label className={label}>Marca / Grife</label>
            <input className={input} value={form.marca} onChange={(e) => setFormField('marca', e.target.value)} />
          </div>
          <div>
            <label className={label}>Unidade</label>
            <input className={input} value={form.unidade} onChange={(e) => setFormField('unidade', e.target.value.toUpperCase())} />
          </div>
          <div>
            <label className={label}>Unidade tributável (opcional)</label>
            <input className={input} placeholder="default = unidade" value={form.unidade_tributavel} onChange={(e) => setFormField('unidade_tributavel', e.target.value.toUpperCase())} />
          </div>
          <div>
            <label className={label}>Valor unitário</label>
            <input className={input} type="number" min="0" step="0.01" value={form.valor_unitario} onChange={(e) => setFormField('valor_unitario', Number(e.target.value))} />
          </div>
          <div className="flex items-end gap-4 pb-2">
            <label className="flex items-center gap-2 text-sm text-muted-dark">
              <input type="checkbox" checked={form.ativo} onChange={(e) => setFormField('ativo', e.target.checked)} />
              Ativo
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-dark">
              <input type="checkbox" checked={form.venda_somente_com_os} onChange={(e) => setFormField('venda_somente_com_os', e.target.checked)} />
              Venda somente com O.S.
            </label>
          </div>
        </div>
        <div>
          <label className={label}>Observação</label>
          <textarea className={input} rows={2} value={form.observacao} onChange={(e) => setFormField('observacao', e.target.value)} />
        </div>
      </div>
    )
  }

  function renderAbaEstoque() {
    return (
      <div className="space-y-4">
        <label className="flex items-center gap-2 text-sm text-muted-dark">
          <input type="checkbox" checked={form.controla_estoque} onChange={(e) => setFormField('controla_estoque', e.target.checked)} />
          Controlar estoque deste produto
        </label>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className={label}>Estoque atual</label>
            <input className={input} type="number" min="0" step="0.0001" value={form.estoque} onChange={(e) => setFormField('estoque', Number(e.target.value))} />
          </div>
          <div>
            <label className={label}>Peso líquido (kg)</label>
            <input className={input} type="number" min="0" step="0.001" value={form.peso_liquido} onChange={(e) => setFormField('peso_liquido', Number(e.target.value))} />
          </div>
          <div>
            <label className={label}>Peso bruto (kg)</label>
            <input className={input} type="number" min="0" step="0.001" value={form.peso_bruto} onChange={(e) => setFormField('peso_bruto', Number(e.target.value))} />
          </div>
        </div>
      </div>
    )
  }

  function renderTabBtn<T extends string>(value: T, current: T, onClick: (v: T) => void, text: string) {
    const active = value === current
    return (
      <button
        type="button"
        onClick={() => onClick(value)}
        className={`whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
          active ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-dark'
        }`}
      >
        {text}
      </button>
    )
  }

  function renderAbaFiscal() {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={label}>NCM — Nomenclatura Comum do Mercosul</label>
            <input className={input} placeholder="ex: 90031990" value={form.ncm} onChange={(e) => setFormField('ncm', e.target.value.replace(/\D/g, ''))} />
          </div>
          <div>
            <label className={label}>CEST — Código Especificador da Subst. Tributária</label>
            <input className={input} placeholder="opcional" value={form.cest} onChange={(e) => setFormField('cest', e.target.value.replace(/\D/g, ''))} />
          </div>
          <div>
            <label className={label}>Origem da mercadoria</label>
            <select className={input} value={form.origem} onChange={(e) => setFormField('origem', Number(e.target.value))}>
              <option value={0}>0 — Nacional</option>
              <option value={1}>1 — Estrangeira (Importação direta)</option>
              <option value={2}>2 — Estrangeira (Adquirida no mercado interno)</option>
              <option value={3}>3 — Nacional com conteúdo importação ≥ 40%</option>
              <option value={4}>4 — Nacional, processo produtivo básico</option>
              <option value={5}>5 — Nacional com conteúdo importação ≤ 40%</option>
              <option value={6}>6 — Estrangeira sem similar nacional</option>
              <option value={7}>7 — Estrangeira sem similar nacional, mercado interno</option>
              <option value={8}>8 — Nacional com conteúdo importação &gt; 70%</option>
            </select>
          </div>
          <div>
            <label className={label}>CFOP padrão (legado, sobrescrito pelos CFOPs específicos)</label>
            <input className={input} value={form.cfop} onChange={(e) => setFormField('cfop', e.target.value.replace(/\D/g, ''))} />
          </div>
        </div>

        <div className="border-t border-black/[0.06] pt-3">
          <div className="mb-3 flex flex-wrap gap-1 border-b border-black/[0.06]">
            {renderTabBtn<AbaFiscal>('cfop-saida', abaFiscal, setAbaFiscal, 'CFOP Saída')}
            {renderTabBtn<AbaFiscal>('icms', abaFiscal, setAbaFiscal, 'ICMS')}
            {renderTabBtn<AbaFiscal>('icms-st', abaFiscal, setAbaFiscal, 'ICMS-ST')}
            {renderTabBtn<AbaFiscal>('cfop-entrada', abaFiscal, setAbaFiscal, 'CFOP Entrada')}
            {renderTabBtn<AbaFiscal>('ipi', abaFiscal, setAbaFiscal, 'IPI')}
            {renderTabBtn<AbaFiscal>('pis', abaFiscal, setAbaFiscal, 'PIS')}
            {renderTabBtn<AbaFiscal>('cofins', abaFiscal, setAbaFiscal, 'COFINS')}
          </div>

          {abaFiscal === 'cfop-saida' && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-dark">Operações Dentro do Estado</p>
                <p className="mb-2 text-[11px] text-muted">Quando o destinatário está no mesmo estado.</p>
                <div className="grid gap-3 md:grid-cols-3">
                  <div><label className={label}>Venda</label><input className={input} placeholder="5102" value={form.cfop_venda_dentro} onChange={(e) => setFormField('cfop_venda_dentro', e.target.value.replace(/\D/g, ''))} /></div>
                  <div><label className={label}>Devolução de compra</label><input className={input} placeholder="5202" value={form.cfop_devolucao_dentro} onChange={(e) => setFormField('cfop_devolucao_dentro', e.target.value.replace(/\D/g, ''))} /></div>
                  <div><label className={label}>Remessa em garantia</label><input className={input} placeholder="5949" value={form.cfop_remessa_garantia_dentro} onChange={(e) => setFormField('cfop_remessa_garantia_dentro', e.target.value.replace(/\D/g, ''))} /></div>
                  <div><label className={label}>Transferência</label><input className={input} placeholder="5152" value={form.cfop_transferencia_dentro} onChange={(e) => setFormField('cfop_transferencia_dentro', e.target.value.replace(/\D/g, ''))} /></div>
                  <div><label className={label}>NF-e de Venda Futura (O.S.)</label><input className={input} value={form.cfop_venda_futura_dentro} onChange={(e) => setFormField('cfop_venda_futura_dentro', e.target.value.replace(/\D/g, ''))} /></div>
                  <div><label className={label}>NF-e de Entrega (Venda)</label><input className={input} value={form.cfop_entrega_venda_dentro} onChange={(e) => setFormField('cfop_entrega_venda_dentro', e.target.value.replace(/\D/g, ''))} /></div>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-dark">Operações Fora do Estado</p>
                <p className="mb-2 text-[11px] text-muted">Quando o destinatário está em outro estado.</p>
                <div className="grid gap-3 md:grid-cols-3">
                  <div><label className={label}>Venda</label><input className={input} placeholder="6102" value={form.cfop_venda_fora} onChange={(e) => setFormField('cfop_venda_fora', e.target.value.replace(/\D/g, ''))} /></div>
                  <div><label className={label}>Devolução de compra</label><input className={input} placeholder="6202" value={form.cfop_devolucao_fora} onChange={(e) => setFormField('cfop_devolucao_fora', e.target.value.replace(/\D/g, ''))} /></div>
                  <div><label className={label}>Remessa em garantia</label><input className={input} placeholder="6949" value={form.cfop_remessa_garantia_fora} onChange={(e) => setFormField('cfop_remessa_garantia_fora', e.target.value.replace(/\D/g, ''))} /></div>
                  <div><label className={label}>Transferência</label><input className={input} placeholder="6152" value={form.cfop_transferencia_fora} onChange={(e) => setFormField('cfop_transferencia_fora', e.target.value.replace(/\D/g, ''))} /></div>
                  <div><label className={label}>NF-e de Venda Futura (O.S.)</label><input className={input} value={form.cfop_venda_futura_fora} onChange={(e) => setFormField('cfop_venda_futura_fora', e.target.value.replace(/\D/g, ''))} /></div>
                  <div><label className={label}>NF-e de Entrega (Venda)</label><input className={input} value={form.cfop_entrega_venda_fora} onChange={(e) => setFormField('cfop_entrega_venda_fora', e.target.value.replace(/\D/g, ''))} /></div>
                </div>
              </div>
            </div>
          )}

          {abaFiscal === 'icms' && (
            <div className="space-y-4">
              <p className="text-[11px] text-muted">Preencha CSOSN se a empresa for do Simples (CRT=1/4) ou CST se for do Regime Normal (CRT=3). O builder escolhe automaticamente.</p>
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <label className={label}>CSOSN (Simples Nacional)</label>
                  <input className={input} placeholder="ex: 102, 500" value={form.csosn} onChange={(e) => setFormField('csosn', e.target.value)} />
                </div>
                <div>
                  <label className={label}>CST ICMS (Regime Normal)</label>
                  <input className={input} placeholder="ex: 00, 20, 40" value={form.cst_icms} onChange={(e) => setFormField('cst_icms', e.target.value)} />
                </div>
                <div>
                  <label className={label}>CST p/ NF-e de Venda Futura (O.S.)</label>
                  <input className={input} value={form.cst_icms_venda_futura} onChange={(e) => setFormField('cst_icms_venda_futura', e.target.value)} />
                </div>
                <div>
                  <label className={label}>CST p/ NF-e de Entrega (Venda)</label>
                  <input className={input} value={form.cst_icms_entrega} onChange={(e) => setFormField('cst_icms_entrega', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Alíquota ICMS %</label>
                  <input className={input} type="number" min="0" max="100" step="0.01" value={form.aliquota_icms} onChange={(e) => setFormField('aliquota_icms', Number(e.target.value))} />
                </div>
                <div>
                  <label className={label}>Alíquota crédito ICMS %</label>
                  <input className={input} type="number" min="0" max="100" step="0.01" value={form.aliquota_credito_icms} onChange={(e) => setFormField('aliquota_credito_icms', Number(e.target.value))} />
                </div>
                <div>
                  <label className={label}>% Base de cálculo ICMS</label>
                  <input className={input} type="number" min="0" max="100" step="0.01" value={form.percentual_base_calculo_icms} onChange={(e) => setFormField('percentual_base_calculo_icms', Number(e.target.value))} />
                </div>
              </div>
            </div>
          )}

          {abaFiscal === 'icms-st' && (
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className={label}>Alíquota ICMS-ST %</label>
                <input className={input} type="number" min="0" max="100" step="0.01" value={form.aliquota_icms_st} onChange={(e) => setFormField('aliquota_icms_st', Number(e.target.value))} />
              </div>
              <div>
                <label className={label}>% MVA</label>
                <input className={input} type="number" min="0" step="0.01" value={form.percentual_mva} onChange={(e) => setFormField('percentual_mva', Number(e.target.value))} />
              </div>
              <div>
                <label className={label}>% Redução BC ST</label>
                <input className={input} type="number" min="0" max="100" step="0.01" value={form.percentual_reducao_bc_st} onChange={(e) => setFormField('percentual_reducao_bc_st', Number(e.target.value))} />
              </div>
            </div>
          )}

          {abaFiscal === 'cfop-entrada' && (
            <div className="grid gap-3 md:grid-cols-2">
              <div><label className={label}>Compra — Dentro do Estado</label><input className={input} placeholder="1102" value={form.cfop_compra_dentro} onChange={(e) => setFormField('cfop_compra_dentro', e.target.value.replace(/\D/g, ''))} /></div>
              <div><label className={label}>Compra — Fora do Estado</label><input className={input} placeholder="2102" value={form.cfop_compra_fora} onChange={(e) => setFormField('cfop_compra_fora', e.target.value.replace(/\D/g, ''))} /></div>
            </div>
          )}

          {abaFiscal === 'ipi' && (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <label className={label}>CST IPI</label>
                  <input className={input} placeholder="ex: 49, 53" value={form.cst_ipi} onChange={(e) => setFormField('cst_ipi', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Código enquadramento legal</label>
                  <input className={input} value={form.codigo_enquadramento_ipi} onChange={(e) => setFormField('codigo_enquadramento_ipi', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Tipo de cálculo</label>
                  <select className={input} value={form.tipo_calculo_ipi} onChange={(e) => setFormField('tipo_calculo_ipi', e.target.value)}>
                    <option value="percentual">Percentual</option>
                    <option value="valor">Valor por unidade</option>
                  </select>
                </div>
                <div>
                  <label className={label}>Alíquota IPI %</label>
                  <input className={input} type="number" min="0" max="100" step="0.01" value={form.aliquota_ipi} onChange={(e) => setFormField('aliquota_ipi', Number(e.target.value))} />
                </div>
                <div>
                  <label className={label}>Valor por unidade</label>
                  <input className={input} type="number" min="0" step="0.0001" value={form.valor_unitario_ipi} onChange={(e) => setFormField('valor_unitario_ipi', Number(e.target.value))} />
                </div>
                <div>
                  <label className={label}>Qtde. total un. padrão</label>
                  <input className={input} type="number" min="0" step="0.0001" value={form.qtde_total_ipi} onChange={(e) => setFormField('qtde_total_ipi', Number(e.target.value))} />
                </div>
                <div>
                  <label className={label}>Ex. TIPI</label>
                  <input className={input} value={form.ex_tipi} onChange={(e) => setFormField('ex_tipi', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Classe de enquadramento</label>
                  <input className={input} value={form.classe_enquadramento_ipi} onChange={(e) => setFormField('classe_enquadramento_ipi', e.target.value)} />
                </div>
                <div>
                  <label className={label}>CNPJ do Produtor</label>
                  <input className={input} value={form.cnpj_produtor_ipi} onChange={(e) => setFormField('cnpj_produtor_ipi', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Código selo controle</label>
                  <input className={input} value={form.codigo_selo_controle_ipi} onChange={(e) => setFormField('codigo_selo_controle_ipi', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Qtde. selo controle</label>
                  <input className={input} type="number" min="0" step="1" value={form.qtde_selo_controle_ipi} onChange={(e) => setFormField('qtde_selo_controle_ipi', Number(e.target.value))} />
                </div>
              </div>
            </div>
          )}

          {abaFiscal === 'pis' && (
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className={label}>CST PIS</label>
                <input className={input} placeholder="ex: 01, 49" value={form.cst_pis} onChange={(e) => setFormField('cst_pis', e.target.value)} />
              </div>
              <div>
                <label className={label}>Tipo de cálculo</label>
                <select className={input} value={form.tipo_calculo_pis} onChange={(e) => setFormField('tipo_calculo_pis', e.target.value)}>
                  <option value="percentual">Percentual</option>
                  <option value="valor">Valor por unidade</option>
                </select>
              </div>
              <div>
                <label className={label}>Alíquota %</label>
                <input className={input} type="number" min="0" max="100" step="0.01" value={form.aliquota_pis} onChange={(e) => setFormField('aliquota_pis', Number(e.target.value))} />
              </div>
              <div>
                <label className={label}>Valor por unidade</label>
                <input className={input} type="number" min="0" step="0.0001" value={form.valor_unitario_pis} onChange={(e) => setFormField('valor_unitario_pis', Number(e.target.value))} />
              </div>
              <div>
                <label className={label}>Qtde. total un. padrão</label>
                <input className={input} type="number" min="0" step="0.0001" value={form.qtde_total_pis} onChange={(e) => setFormField('qtde_total_pis', Number(e.target.value))} />
              </div>
            </div>
          )}

          {abaFiscal === 'cofins' && (
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className={label}>CST COFINS</label>
                <input className={input} placeholder="ex: 01, 49" value={form.cst_cofins} onChange={(e) => setFormField('cst_cofins', e.target.value)} />
              </div>
              <div>
                <label className={label}>Tipo de cálculo</label>
                <select className={input} value={form.tipo_calculo_cofins} onChange={(e) => setFormField('tipo_calculo_cofins', e.target.value)}>
                  <option value="percentual">Percentual</option>
                  <option value="valor">Valor por unidade</option>
                </select>
              </div>
              <div>
                <label className={label}>Alíquota %</label>
                <input className={input} type="number" min="0" max="100" step="0.01" value={form.aliquota_cofins} onChange={(e) => setFormField('aliquota_cofins', Number(e.target.value))} />
              </div>
              <div>
                <label className={label}>Valor por unidade</label>
                <input className={input} type="number" min="0" step="0.0001" value={form.valor_unitario_cofins} onChange={(e) => setFormField('valor_unitario_cofins', Number(e.target.value))} />
              </div>
              <div>
                <label className={label}>Qtde. total un. padrão</label>
                <input className={input} type="number" min="0" step="0.0001" value={form.qtde_total_cofins} onChange={(e) => setFormField('qtde_total_cofins', Number(e.target.value))} />
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderAbaOutros() {
    if (form.tipo === 'servico') {
      return (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className={label}>Item LC 116 / Código tributação nacional</label>
              <input className={input} placeholder="ex: 1.05" value={form.codigo_lc116} onChange={(e) => setFormField('codigo_lc116', e.target.value)} />
            </div>
            <div>
              <label className={label}>Código tributário municipal</label>
              <input className={input} value={form.codigo_tributario_municipal} onChange={(e) => setFormField('codigo_tributario_municipal', e.target.value)} />
            </div>
            <div>
              <label className={label}>Código NBS (opcional)</label>
              <input className={input} value={form.codigo_nbs} onChange={(e) => setFormField('codigo_nbs', e.target.value)} />
            </div>
            <div>
              <label className={label}>CNAE (opcional)</label>
              <input className={input} value={form.cnae} onChange={(e) => setFormField('cnae', e.target.value)} />
            </div>
            <div>
              <label className={label}>Alíquota ISS %</label>
              <input className={input} type="number" min="0" max="100" step="0.01" value={form.aliquota_iss} onChange={(e) => setFormField('aliquota_iss', Number(e.target.value))} />
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm text-muted-dark">
              <input type="checkbox" checked={form.iss_retido} onChange={(e) => setFormField('iss_retido', e.target.checked)} />
              ISS retido pelo tomador
            </label>
          </div>
        </div>
      )
    }
    return (
      <div className="space-y-4">
        <div>
          <label className={label}>Informação adicional do produto (vai para &lt;infAdProd&gt; em cada item)</label>
          <textarea className={input} rows={3} value={form.info_adicional_produto} onChange={(e) => setFormField('info_adicional_produto', e.target.value)} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
            <Package size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">Produtos e serviços</h1>
            <p className="text-sm text-muted">{empresaAtual?.nome || 'Selecione uma empresa'}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={baixarModelo} title="Baixar planilha modelo de importação (vazia)" className="inline-flex items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm hover:bg-light-secondary">
            <FileDown size={14} /> Modelo
          </button>
          <button onClick={exportarXlsx} disabled={!empresaId || produtos.length === 0} title="Exportar produtos para xlsx (formato ssÓtica)" className="inline-flex items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm hover:bg-light-secondary disabled:opacity-50">
            <Download size={14} /> Exportar
          </button>
          <button onClick={() => setShowImport(true)} disabled={!empresaId} title="Importar lista a partir de xlsx" className="inline-flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-accent hover:bg-accent/10 disabled:opacity-50">
            <Upload size={14} /> Importar
          </button>
          <button onClick={() => loadProdutos()} className="inline-flex items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm hover:bg-light-secondary">
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
            placeholder="Buscar por descrição, referência, código, NCM, GTIN, marca..."
            className="w-full rounded-lg border border-black/[0.08] bg-white py-2 pl-9 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          {busca && (
            <button
              onClick={() => setBusca('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-dark"
              title="Limpar busca"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-dark">
          <span>Por página:</span>
          <select
            value={porPagina}
            onChange={(e) => setPorPagina(Number(e.target.value))}
            className="rounded-lg border border-black/[0.08] bg-white px-2 py-1.5 text-sm"
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={500}>500</option>
          </select>
        </div>
      </div>

      {/* Tabs Ativos / Arquivados */}
      {(() => {
        const qtdAtivos = produtos.filter((p) => !isArquivado(p)).length
        const qtdArquivados = produtos.filter((p) => isArquivado(p)).length
        return (
          <div className="flex flex-wrap gap-1 border-b border-black/[0.06]">
            {[
              { k: 'ativos', label: 'Produtos', count: qtdAtivos },
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
          entidade="produto"
          onReverter={() => void loadProdutos()}
        />
      )}

      {/* Toolbar de ações em lote — aparece só quando há selecionados */}
      {abaLista !== 'log' && selecionados.size > 0 && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-accent/40 bg-accent/5 p-3 shadow-sm">
          <div className="text-sm font-semibold text-dark">
            <strong>{selecionados.size}</strong> produto{selecionados.size > 1 ? 's' : ''} selecionado{selecionados.size > 1 ? 's' : ''}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => executarBulkAction('ativar')}
              disabled={executandoBulk}
              className="inline-flex items-center gap-1 rounded-lg border border-success/30 bg-success/5 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/10 disabled:opacity-50"
            >
              <Power size={13} /> Ativar
            </button>
            <button
              onClick={() => executarBulkAction('desativar')}
              disabled={executandoBulk}
              className="inline-flex items-center gap-1 rounded-lg border border-black/[0.08] bg-white px-3 py-1.5 text-xs font-medium text-muted-dark hover:bg-light-secondary disabled:opacity-50"
            >
              <PowerOff size={13} /> Desativar
            </button>
            {abaLista === 'ativos' ? (
              <button
                onClick={() => setConfirmBulk('arquivar')}
                disabled={executandoBulk}
                className="inline-flex items-center gap-1 rounded-lg border border-warning/30 bg-warning/5 px-3 py-1.5 text-xs font-medium text-warning-dark hover:bg-warning/10 disabled:opacity-50"
              >
                <Archive size={13} /> Arquivar
              </button>
            ) : (
              <button
                onClick={() => executarBulkAction('desarquivar')}
                disabled={executandoBulk}
                className="inline-flex items-center gap-1 rounded-lg border border-success/30 bg-success/5 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/10 disabled:opacity-50"
              >
                <ArchiveRestore size={13} /> Restaurar
              </button>
            )}
            <button
              onClick={() => setConfirmBulk('remover')}
              disabled={executandoBulk}
              className="inline-flex items-center gap-1 rounded-lg border border-error/30 bg-error/5 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/10 disabled:opacity-50"
            >
              <Trash2 size={13} /> Remover
            </button>
            <button
              onClick={selecionarTodosFiltrados}
              disabled={executandoBulk || selecionados.size >= ordenados.length}
              className="inline-flex items-center gap-1 rounded-lg border border-accent/30 bg-accent/5 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
              title={`Marcar todos os ${ordenados.length} produto(s) filtrado(s), de todas as páginas`}
            >
              <CheckCircle2 size={13} /> Selecionar todos ({ordenados.length})
            </button>
            <button
              onClick={limparSelecao}
              disabled={executandoBulk}
              className="inline-flex items-center gap-1 rounded-lg border border-black/[0.08] bg-white px-3 py-1.5 text-xs text-muted-dark hover:bg-light-secondary disabled:opacity-50"
            >
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
                // Checkbox "selecionar todos os visíveis na página atual"
                const visiveis = listaPaginada.map((p) => p.id)
                const todosSelecionados = visiveis.length > 0 && visiveis.every((id) => selecionados.has(id))
                const algunsSelecionados = visiveis.some((id) => selecionados.has(id)) && !todosSelecionados
                return (
                  <th className="w-10 px-3 py-3 text-left">
                    <input
                      type="checkbox"
                      ref={(el) => { if (el) el.indeterminate = algunsSelecionados }}
                      checked={todosSelecionados}
                      onChange={(e) => selecionarTodosVisiveis(visiveis, e.target.checked)}
                      className="h-4 w-4 cursor-pointer accent-accent"
                      title={todosSelecionados ? 'Desmarcar todos' : 'Marcar todos visíveis'}
                    />
                  </th>
                )
              })()}
              <ColunaSort col="descricao" label="Descrição" current={sortColuna} dir={sortDir} onClick={clickColuna} />
              <ColunaSort col="fiscal" label="Fiscal" current={sortColuna} dir={sortDir} onClick={clickColuna} />
              <ColunaSort col="valor" label="Valor" current={sortColuna} dir={sortDir} onClick={clickColuna} />
              <ColunaSort col="tipo" label="Tipo" current={sortColuna} dir={sortDir} onClick={clickColuna} />
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
                    ? `Nenhum produto encontrado para "${busca}".`
                    : abaLista === 'ativos' ? 'Nenhum produto cadastrado.' : 'Nenhum produto arquivado.'}
                </td></tr>
              )
              return listaPaginada.map((produto) => (
              <tr key={produto.id} className={`border-b border-black/[0.04] hover:bg-light-secondary ${selecionados.has(produto.id) ? 'bg-accent/5' : ''}`}>
                <td className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={selecionados.has(produto.id)}
                    onChange={() => toggleSelecionado(produto.id)}
                    className="h-4 w-4 cursor-pointer accent-accent"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-dark">{produto.descricao}</div>
                  <div className="text-xs text-muted">{produto.referencia || produto.codigo_interno || '-'}</div>
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  <div>NCM {produto.ncm || '-'}</div>
                  <div>CFOP {produto.cfop_venda_dentro || produto.cfop || '-'}</div>
                </td>
                <td className="px-4 py-3 font-medium">{money(produto.valor_unitario)}</td>
                <td className="px-4 py-3 capitalize">{produto.tipo}</td>
                {abaLista === 'ativos' && (
                  <td className="px-4 py-3">
                    <button
                      onClick={() => alternarAtivo(produto)}
                      title={produto.ativo ? 'Clique para desativar (continua em Ativos)' : 'Clique para ativar'}
                      className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        produto.ativo
                          ? 'bg-success-bg text-success hover:bg-success/20'
                          : 'bg-light-secondary text-muted-dark hover:bg-success/10'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-6 rounded-full transition-colors ${produto.ativo ? 'bg-success' : 'bg-neutral-300'} relative`}
                      >
                        <span
                          className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${produto.ativo ? 'left-3' : 'left-0.5'}`}
                        />
                      </span>
                      {produto.ativo ? 'Ativo' : 'Desativado'}
                    </button>
                  </td>
                )}
                <td className="px-4 py-3 text-right">
                  {abaLista === 'arquivados' ? (
                    <>
                      <button onClick={() => restaurar(produto)} className="mr-2 inline-flex items-center gap-1 rounded-lg border border-success/30 bg-success/5 px-2 py-1 text-xs text-success hover:bg-success/10" title="Restaurar produto (volta pra Ativos)">
                        <ArchiveRestore size={13} /> Restaurar
                      </button>
                      <button onClick={() => pedirRemover(produto)} className="rounded-lg border border-error/20 p-2 text-error hover:bg-error/5" title="Excluir definitivamente">
                        <Trash2 size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => openEdit(produto)} className="mr-2 rounded-lg border border-black/[0.08] p-2 hover:bg-white" title="Editar">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => pedirRemover(produto)} className="rounded-lg border border-error/20 p-2 text-error hover:bg-error/5" title="Excluir / Arquivar">
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
              <span className="ml-1 text-muted">(filtrados de {produtos.filter((p) => (abaLista === 'ativos' ? !isArquivado(p) : isArquivado(p))).length})</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPagina(1)}
              disabled={paginaCorrigida === 1}
              className="rounded border border-black/[0.08] bg-white px-2 py-1 text-xs hover:bg-light-secondary disabled:opacity-30"
              title="Primeira página"
            >
              «
            </button>
            <button
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={paginaCorrigida === 1}
              className="inline-flex items-center rounded border border-black/[0.08] bg-white px-2 py-1 text-xs hover:bg-light-secondary disabled:opacity-30"
            >
              <ChevronLeft size={14} /> Anterior
            </button>
            <span className="px-2 text-xs">
              Pág. <strong>{paginaCorrigida}</strong> / {totalPaginas}
            </span>
            <button
              onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              disabled={paginaCorrigida >= totalPaginas}
              className="inline-flex items-center rounded border border-black/[0.08] bg-white px-2 py-1 text-xs hover:bg-light-secondary disabled:opacity-30"
            >
              Próxima <ChevronRight size={14} />
            </button>
            <button
              onClick={() => setPagina(totalPaginas)}
              disabled={paginaCorrigida >= totalPaginas}
              className="rounded border border-black/[0.08] bg-white px-2 py-1 text-xs hover:bg-light-secondary disabled:opacity-30"
              title="Última página"
            >
              »
            </button>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={() => !saving && setShowModal(false)}>
          <div className="w-full max-w-4xl rounded-lg bg-white" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-black/[0.06] p-5">
              <h3 className="font-semibold text-dark">{form.id ? 'Editar produto' : 'Novo produto'}</h3>
              <button onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>

            <div className="flex gap-1 border-b border-black/[0.06] px-4">
              {renderTabBtn<AbaPrincipal>('dados', aba, setAba, 'Dados Principais')}
              {form.tipo === 'produto' && renderTabBtn<AbaPrincipal>('estoque', aba, setAba, 'Estoque / Peso')}
              {form.tipo === 'produto' && renderTabBtn<AbaPrincipal>('fiscal', aba, setAba, 'Informações Fiscais (NF-e/NFC-e)')}
              {renderTabBtn<AbaPrincipal>('outros', aba, setAba, form.tipo === 'servico' ? 'NFS-e' : 'Outros')}
            </div>

            <div className="max-h-[72vh] overflow-y-auto p-5">
              {aba === 'dados' && renderAbaDados()}
              {aba === 'estoque' && form.tipo === 'produto' && renderAbaEstoque()}
              {aba === 'fiscal' && form.tipo === 'produto' && renderAbaFiscal()}
              {aba === 'outros' && renderAbaOutros()}
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
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !executandoBulk && setConfirmBulk(null)}
        >
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-black/[0.06] p-5">
              <h3 className="font-semibold text-dark">
                {confirmBulk === 'arquivar' ? 'Arquivar em lote' : 'Remover em lote'}
              </h3>
              <p className="mt-2 text-sm text-muted">
                Você vai {confirmBulk === 'arquivar' ? 'arquivar' : 'remover definitivamente'}{' '}
                <strong className="text-dark">{selecionados.size} produto{selecionados.size > 1 ? 's' : ''}</strong>.
              </p>
              {confirmBulk === 'remover' && (
                <p className="mt-2 text-xs text-error">
                  ⚠️ Produtos já usados em vendas/notas/O.S. não vão poder ser removidos — esses ficam intactos.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-black/[0.06] bg-light-secondary/40 p-3">
              <button
                onClick={() => setConfirmBulk(null)}
                disabled={executandoBulk}
                className="rounded-lg border border-black/[0.08] bg-white px-4 py-2 text-sm disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => executarBulkAction(confirmBulk)}
                disabled={executandoBulk}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                  confirmBulk === 'remover' ? 'bg-error hover:bg-error/90' : 'bg-warning hover:bg-warning/90'
                }`}
              >
                {executandoBulk ? 'Aplicando...' : confirmBulk === 'arquivar' ? 'Sim, arquivar todos' : 'Sim, remover todos'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport && empresaId && (
        <ImportXlsxModal<ProdutoPayload>
          titulo="Importar produtos (xlsx)"
          empresaId={empresaId}
          empresaNome={empresaAtual?.nome || empresaAtual?.razao_social || '—'}
          bulkEndpoint="/admin/produtos/bulk"
          bulkKey="produtos"
          parseRow={parseProdutoRow}
          permiteAtualizar={false}
          onClose={() => setShowImport(false)}
          onConcluido={() => void loadProdutos()}
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
              <h3 className="font-semibold text-dark">Remover produto</h3>
              <p className="mt-2 text-sm text-muted">
                O que deseja fazer com <strong className="text-dark">"{removerAlvo.descricao}"</strong>?
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
