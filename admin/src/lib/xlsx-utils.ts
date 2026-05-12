/**
 * Utilitário para importar/exportar planilhas xlsx no formato do ssÓtica.
 *
 * Os 2 cabeçalhos suportados — extraídos das planilhas reais do ssÓtica em 12/05/2026:
 *   • Clientes (exportação): 41 colunas
 *   • Produtos (exportação): 32 colunas
 *   • Modelos de importação: 30 colunas cada
 *
 * Funções principais:
 *   - parseXlsxFile(file)  → linhas como Record<string, string>
 *   - downloadXlsx(...)    → baixa um xlsx montado a partir de rows + columns
 */

import * as XLSX from 'xlsx'

export interface ParsedSheet {
  headers: string[]
  rows: Record<string, string>[]
}

/**
 * Lê um arquivo xlsx (do <input type=file>) e devolve as linhas como objetos
 * indexados pelo cabeçalho. Detecta automaticamente a linha de header (1ª com ≥2
 * células preenchidas) e ignora colunas com cabeçalho vazio.
 */
export async function parseXlsxFile(file: File): Promise<ParsedSheet> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('Arquivo sem planilhas')
  const sheet = wb.Sheets[sheetName]
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' })

  // Encontra a 1ª linha com ≥2 cabeçalhos preenchidos
  let headerIdx = 0
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const filled = (matrix[i] as unknown[]).filter((c) => String(c).trim()).length
    if (filled >= 2) { headerIdx = i; break }
  }

  const rawHeaders = (matrix[headerIdx] as unknown[]).map((h) => String(h).trim())
  // Indexamos apenas colunas com header não-vazio
  const validCols: Array<{ idx: number; key: string }> = []
  rawHeaders.forEach((h, idx) => { if (h) validCols.push({ idx, key: h }) })

  const rows: Record<string, string>[] = []
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const raw = matrix[i] as unknown[]
    if (!raw || raw.every((c) => !String(c).trim())) continue
    const obj: Record<string, string> = {}
    for (const { idx, key } of validCols) {
      const v = raw[idx]
      obj[key] = v == null ? '' : String(v).trim()
    }
    rows.push(obj)
  }

  return { headers: validCols.map((c) => c.key), rows }
}

/**
 * Gera um xlsx a partir de uma lista de objetos + ordem de colunas e dispara o
 * download no navegador.
 */
export function downloadXlsx(
  filename: string,
  sheetName: string,
  columns: string[],
  rows: Array<Record<string, string | number | boolean | null | undefined>>,
) {
  const data: Array<Array<string | number | boolean | null | undefined>> = [columns]
  for (const row of rows) {
    data.push(columns.map((c) => row[c] ?? ''))
  }
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(data)
  // Largura mínima razoável
  ws['!cols'] = columns.map(() => ({ wch: 20 }))
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31)) // limite Excel
  XLSX.writeFile(wb, filename)
}

// ============================================================
// Clientes — mapeamento ssOtica ↔ schema interno
// ============================================================

/** Colunas do modelo de IMPORTAÇÃO de clientes do ssOtica (30 colunas). */
export const CLIENTES_IMPORT_COLUMNS = [
  'Nome / Razão Social', 'Apelido / Nome Fantasia', 'Data de Nascimento', 'Sexo',
  'Profissão', 'Nome do pai', 'Nome da mãe', 'CPF / CNPJ', 'RG', 'Inscrição Estadual',
  'Inscrição Municipal', 'Suframa', 'Contribuinte ICMS', 'Endereço', 'Número',
  'Complemento', 'Bairro', 'Cidade', 'UF', 'CEP', 'Email', 'Telefone', 'Celular',
  'Celular1', 'Celular2', 'Observação', 'Código Externo', 'Ativo',
  'Data do cadastro', 'Convênio',
] as const

export interface ClientePayload {
  empresa_id: string
  nome: string
  cpf_cnpj: string
  ie?: string | null
  email?: string | null
  telefone?: string | null
  endereco_logradouro?: string | null
  endereco_numero?: string | null
  endereco_bairro?: string | null
  endereco_cidade?: string | null
  endereco_uf?: string | null
  endereco_cep?: string | null
  ativo?: boolean
}

/**
 * Aceita formato de exportação OU de modelo.
 *
 * Pré-filtragem local: linhas SEM Documento (CPF/CNPJ) são descartadas — não
 * vão ser enviadas pro backend (economiza tempo de rede e validação no server).
 * Outros campos são todos opcionais.
 *
 * Retorna null quando deve descartar a linha (sem documento ou sem nome).
 */
export function parseClienteRow(row: Record<string, string>, empresaId: string): { payload: ClientePayload; problemas: string[] } | null {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = row[k]
      if (v != null && String(v).trim()) return String(v).trim()
    }
    return ''
  }

  // Documento é OBRIGATÓRIO — sem ele, linha é silenciosamente descartada
  const documento = get('Documento', 'CPF / CNPJ', 'CPF/CNPJ')
  if (!documento) return null

  // Nome também é necessário pra a coluna não-null do banco (clientes.nome NOT NULL)
  const nome = get('Nome / Razão Social', 'Nome')
  if (!nome) return null

  const problemas: string[] = []
  const cpfCnpj = documento.replace(/\D/g, '')
  if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
    problemas.push(`Documento "${documento}" não tem 11/14 dígitos — importado mesmo assim`)
  }

  const ufRaw = get('UF', 'Estado')
  const uf = ufRaw ? ufRaw.toUpperCase().slice(0, 2) : ''

  const ativoStr = get('Ativo').toLowerCase()
  const ativo = ativoStr ? !(ativoStr === 'não' || ativoStr === 'nao' || ativoStr === 'no' || ativoStr === 'false') : true

  // Email: se não for formato válido, vira null (não bloqueia a linha)
  const emailRaw = get('Email', 'email')
  const email = emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : null
  if (emailRaw && !email) problemas.push(`Email "${emailRaw}" inválido — ignorado`)

  const telefone = get('Telefone', 'telefone', 'Celular', 'celular', 'Celular1', 'celular1', 'Celular2', 'celular2', 'telefone1', 'celular3', 'celular4', 'celular5')

  return {
    payload: {
      empresa_id: empresaId,
      nome,
      cpf_cnpj: cpfCnpj,
      ie: get('Inscrição Estadual', 'RG / IE') || null,
      email,
      telefone: telefone || null,
      endereco_logradouro: get('Endereço') || null,
      endereco_numero: get('Número') || null,
      endereco_bairro: get('Bairro') || null,
      endereco_cidade: get('Cidade') || null,
      endereco_uf: uf || null,
      endereco_cep: get('CEP').replace(/\D/g, '') || null,
      ativo,
    },
    problemas,
  }
}

/** Converte um cliente do nosso schema → linha no formato de exportação ssOtica. */
export function clienteToExportRow(c: {
  nome: string
  cpf_cnpj: string
  ie?: string | null
  email?: string | null
  telefone?: string | null
  endereco_logradouro?: string | null
  endereco_numero?: string | null
  endereco_bairro?: string | null
  endereco_cidade?: string | null
  endereco_uf?: string | null
  endereco_cep?: string | null
  ativo?: boolean
}): Record<string, string> {
  return {
    'Nome / Razão Social': c.nome,
    'CPF / CNPJ': c.cpf_cnpj,
    'Inscrição Estadual': c.ie || '',
    Email: c.email || '',
    Telefone: c.telefone || '',
    Endereço: c.endereco_logradouro || '',
    Número: c.endereco_numero || '',
    Bairro: c.endereco_bairro || '',
    Cidade: c.endereco_cidade || '',
    UF: c.endereco_uf || '',
    CEP: c.endereco_cep || '',
    Ativo: c.ativo === false ? 'Não' : 'Sim',
  }
}

// ============================================================
// Produtos — mapeamento ssOtica ↔ schema interno
// ============================================================

/** Colunas do modelo de IMPORTAÇÃO de produtos do ssOtica (30 colunas). */
export const PRODUTOS_IMPORT_COLUMNS = [
  'Referência', 'Código GTIN', 'Descrição', 'Unidade', 'Fornecedor', 'Grupo',
  'Subgrupo', 'Grife', 'Cor', 'Tamanho', 'Formato', 'Ncm', 'ExtIPI', 'Cest',
  'Controlar Estoque', 'Venda Somente com OS', 'Preco de custo', 'Preco de Venda',
  'Estoque Atual', 'Estoque Minimo', 'Localização', 'Ativo', 'Código Importação',
  'Data Cadastro', 'CFOP Venda Dentro Estado', 'CFOP Venda Fora Estado',
  'CST', 'CSOSN', 'Origem Produto', 'Aliquota ICMS',
] as const

export interface ProdutoPayload {
  empresa_id: string
  descricao: string
  tipo?: 'produto' | 'servico'
  referencia?: string | null
  gtin?: string | null
  unidade?: string
  marca?: string | null
  ncm?: string | null
  cest?: string | null
  ex_tipi?: string | null
  valor_unitario?: number
  estoque?: number
  controla_estoque?: boolean
  venda_somente_com_os?: boolean
  ativo?: boolean
  observacao?: string | null
  origem?: number
  cst_icms?: string | null
  csosn?: string | null
  cst_csosn?: string | null
  aliquota_icms?: number
  cfop_venda_dentro?: string | null
  cfop_venda_fora?: string | null
  codigo_interno?: string | null
}

const TRUE_SET = new Set(['sim', 's', 'true', 'yes', '1', 'verdadeiro'])
const FALSE_SET = new Set(['não', 'nao', 'n', 'false', 'no', '0', 'falso'])

function parseBool(s: string, def: boolean): boolean {
  const v = s.trim().toLowerCase()
  if (TRUE_SET.has(v)) return true
  if (FALSE_SET.has(v)) return false
  return def
}

function parseNumberBR(s: string): number {
  if (!s) return 0
  // Aceita "1.234,56" e "1234.56"
  const cleaned = s.replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
  const n = Number(cleaned)
  if (Number.isFinite(n)) return n
  const fallback = Number(s.replace(',', '.'))
  return Number.isFinite(fallback) ? fallback : 0
}

export function parseProdutoRow(row: Record<string, string>, empresaId: string): { payload: ProdutoPayload; problemas: string[] } | null {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = row[k]
      if (v != null && String(v).trim()) return String(v).trim()
    }
    return ''
  }

  const descricao = get('Descrição', 'Descricao', 'Nome')
  if (!descricao) return null

  const problemas: string[] = []
  const origem = Number(get('Origem Produto', 'Origem') || '0')
  if (!Number.isInteger(origem) || origem < 0 || origem > 8) {
    problemas.push(`Origem inválida "${get('Origem Produto', 'Origem')}", usando 0`)
  }

  const cstIcms = get('CST') || null
  const csosn = get('CSOSN') || null

  return {
    payload: {
      empresa_id: empresaId,
      descricao,
      tipo: 'produto',
      referencia: get('Referência') || null,
      gtin: get('Código GTIN', 'GTIN', 'EAN').toUpperCase() || null,
      unidade: (get('Unidade') || 'UN').toUpperCase(),
      marca: get('Grife', 'Marca', 'Fabricante') || null,
      ncm: get('Ncm', 'NCM').replace(/\D/g, '') || null,
      cest: get('Cest', 'CEST').replace(/\D/g, '') || null,
      ex_tipi: get('ExtIPI', 'Ex. TIPI') || null,
      valor_unitario: parseNumberBR(get('Preco de Venda', 'Preço de Venda')),
      estoque: parseNumberBR(get('Estoque Atual', 'Estoque')),
      controla_estoque: parseBool(get('Controlar Estoque'), true),
      venda_somente_com_os: parseBool(get('Venda Somente com OS'), false),
      ativo: parseBool(get('Ativo'), true),
      origem: Number.isInteger(origem) && origem >= 0 && origem <= 8 ? origem : 0,
      cst_icms: cstIcms,
      csosn,
      cst_csosn: csosn || cstIcms, // mantém retro-compat com schema antigo
      aliquota_icms: parseNumberBR(get('Aliquota ICMS', 'Alíquota ICMS')),
      cfop_venda_dentro: get('CFOP Venda Dentro Estado').replace(/\D/g, '') || null,
      cfop_venda_fora: get('CFOP Venda Fora Estado').replace(/\D/g, '') || null,
      codigo_interno: get('Código Importação', 'Código Interno') || null,
    },
    problemas,
  }
}

export function produtoToExportRow(p: {
  descricao: string
  referencia?: string | null
  gtin?: string | null
  unidade?: string
  marca?: string | null
  ncm?: string | null
  cest?: string | null
  ex_tipi?: string | null
  valor_unitario?: string | number | null
  estoque?: string | number | null
  controla_estoque?: boolean | null
  venda_somente_com_os?: boolean | null
  ativo?: boolean
  origem?: number
  cst_icms?: string | null
  cst_csosn?: string | null
  csosn?: string | null
  aliquota_icms?: string | number | null
  cfop_venda_dentro?: string | null
  cfop_venda_fora?: string | null
  codigo_interno?: string | null
}): Record<string, string> {
  return {
    Referência: p.referencia || '',
    'Código GTIN': p.gtin || '',
    Descrição: p.descricao,
    Unidade: p.unidade || 'UN',
    Fornecedor: '',
    Grupo: '',
    Subgrupo: '',
    Grife: p.marca || '',
    Cor: '',
    Tamanho: '',
    Formato: '',
    Ncm: p.ncm || '',
    ExtIPI: p.ex_tipi || '',
    Cest: p.cest || '',
    'Controlar Estoque': p.controla_estoque === false ? 'NÃO' : 'SIM',
    'Venda Somente com OS': p.venda_somente_com_os ? 'SIM' : 'NÃO',
    'Preco de custo': '',
    'Preco de Venda': p.valor_unitario != null ? String(p.valor_unitario) : '',
    'Estoque Atual': p.estoque != null ? String(p.estoque) : '0',
    'Estoque Minimo': '0',
    Localização: '',
    Ativo: p.ativo === false ? 'NÃO' : 'SIM',
    'Código Importação': p.codigo_interno || '',
    'Data Cadastro': '',
    'CFOP Venda Dentro Estado': p.cfop_venda_dentro || '',
    'CFOP Venda Fora Estado': p.cfop_venda_fora || '',
    CST: p.cst_icms || '',
    CSOSN: p.csosn || p.cst_csosn || '',
    'Origem Produto': p.origem != null ? String(p.origem) : '0',
    'Aliquota ICMS': p.aliquota_icms != null ? String(p.aliquota_icms) : '',
  }
}
