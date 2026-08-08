/**
 * Types do domínio NF-e (modelo 55) e NFC-e (modelo 65).
 * Refs:
 *   - Manual de Orientação do Contribuinte (MOC) NF-e v7.00
 *   - Manual de Padrões Técnicos NFC-e v7.00
 *   - Schemas XSD: PL_009_V4 (Portal SEFAZ)
 *
 * Esqueleto de teste — só estrutura, sem dados reais.
 */

export type Modelo = 55 | 65            // 55 = NF-e, 65 = NFC-e
export type Ambiente = 1 | 2            // 1 = produção, 2 = homologação
export type Finalidade = 1 | 2 | 3 | 4  // 1=normal, 2=complementar, 3=ajuste, 4=devolução
export type TipoOperacao = 0 | 1        // 0 = entrada, 1 = saída
export type FormaEmissao = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 9
//  1=normal, 2=contingência FS, 3=SCAN, 4=DPEC, 5=FS-DA, 6=SVC-AN, 7=SVC-RS, 9=offline NFC-e

/**
 * Endpoints — SEFAZ-CE migrou pra SVRS (Sefaz Virtual RS) em 2021 tanto pra
 * NF-e quanto pra NFC-e. Ref: https://www.sefaz.ce.gov.br/2021/11/30/comunicado-nfe-migracao-para-svrs/
 *
 * A consulta pública NFC-e continua no portal SEFAZ-CE original (só os
 * webservices de emissão/consulta/eventos é que mudaram pra SVRS).
 */
export const SEFAZ_CE_URL = {
  nfe: {
    homolog: 'https://nfe-homologacao.svrs.rs.gov.br/ws',
    prod: 'https://nfe.svrs.rs.gov.br/ws',
  },
  nfce: {
    homolog: 'https://nfce-homologacao.svrs.rs.gov.br/ws',
    prod: 'https://nfce.svrs.rs.gov.br/ws',
  },
  consultaPublicaNfce: {
    // URLs oficiais CE — homol com 'h', prod sem
    homolog: 'https://nfceh.sefaz.ce.gov.br/pages/consultaNFCe.jsf',
    prod: 'https://nfce.sefaz.ce.gov.br/pages/consultaNFCe.jsf',
  },
} as const

/** Caminhos relativos dos webservices SVRS (IIS/ASP.NET → terminam em .asmx). */
export const WS_PATH = {
  autorizacao: '/NfeAutorizacao/NFeAutorizacao4.asmx',
  retAutorizacao: '/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
  inutilizacao: '/NfeInutilizacao/NFeInutilizacao4.asmx',
  consultaProtocolo: '/NfeConsulta/NfeConsulta4.asmx',
  statusServico: '/NfeStatusServico/NFeStatusServico4.asmx',
  recepcaoEvento: '/RecepcaoEvento/NFeRecepcaoEvento4.asmx',
  cadConsultaCadastro: '/CadConsultaCadastro/CadConsultaCadastro4.asmx',
} as const

/** Versão do layout NF-e/NFC-e em uso (PL_009_V4 = "4.00") */
export const VERSAO_LAYOUT = '4.00'
export const NFE_NS = 'http://www.portalfiscal.inf.br/nfe'
export const XMLDSIG_NS = 'http://www.w3.org/2000/09/xmldsig#'

/** Código UF IBGE — Ceará = 23 */
export const CODIGO_UF = {
  CE: 23,
} as const

/** CRT (Código Regime Tributário) — vai no <emit> */
export type CRT = 1 | 2 | 3 | 4
//  1 = Simples Nacional
//  2 = Simples Nacional — excesso sublimite
//  3 = Regime Normal
//  4 = MEI

/** Tipo de pagamento (tag <tPag>) */
export type TipoPagamento =
  | '01'  // Dinheiro
  | '02'  // Cheque
  | '03'  // Cartão de Crédito
  | '04'  // Cartão de Débito
  | '05'  // Crédito Loja
  | '10'  // Vale Alimentação
  | '11'  // Vale Refeição
  | '12'  // Vale Presente
  | '13'  // Vale Combustível
  | '15'  // Boleto Bancário
  | '17'  // PIX
  | '18'  // Transferência bancária
  | '19'  // Cashback
  | '90'  // Sem pagamento
  | '99'  // Outros

// === Inputs do orquestrador ===

export interface NfeInput {
  empresaId: string
  modelo: Modelo
  naturezaOperacaoId: string
  clienteId?: string
  destinatarioOverride?: DestinatarioOverride
  itens: ItemInput[]
  pagamento: PagamentoInput
  frete?: FreteInput
  informacoesComplementares?: string
  /** Tipo de documento (espelha o seletor "+ Nova Nota" do ssOtica) */
  tipoDocumento?: 'venda' | 'devolucao' | 'devolucao_xml' | 'remessa_garantia'
    | 'remessa_garantia_xml' | 'importacao' | 'complementar' | 'ajuste' | 'outros'
  /** Chave de NF referenciada (44 dígitos) — devolução / complementar / ajuste */
  chaveAcessoReferenciada?: string
  /** Intermediador / marketplace (gera <infIntermed>) */
  intermediador?: {
    cnpj: string
    idCadastro: string
  }
  enviarEmailPosEmissao?: boolean
  emailDestinatario?: string
}

export interface ItemInput {
  /**
   * Id de um produto cadastrado NESTA API. Opcional: sistemas externos (ERP)
   * têm o catálogo no banco deles, então podem mandar os dados fiscais inline
   * (ver `produto` abaixo). Um dos dois é obrigatório.
   */
  produtoId?: string
  quantidade: number
  /** Sobrescreve valor_unitario do produto se fornecido */
  valorUnitario?: number
  /** Desconto absoluto pra esse item */
  valorDesconto?: number
  /** Sobrescreve CFOP do produto/natureza */
  cfop?: string
  /** Info adicional do item (texto livre, vai pra <infAdProd>) */
  infoAdicional?: string
  /**
   * Dados fiscais do produto enviados inline — pra quem não tem o catálogo
   * cadastrado aqui. `descricao` e `ncm` são obrigatórios; o resto cai nos
   * mesmos defaults usados pro produto do banco.
   */
  produto?: ItemProdutoInline
}

/** Produto descrito no próprio payload (ERP externo dono do catálogo). */
export interface ItemProdutoInline {
  descricao: string
  ncm: string
  /** Código interno/SKU do item no sistema de origem */
  codigo?: string
  cfop?: string
  cest?: string
  unidade?: string
  unidadeTributavel?: string
  gtin?: string
  origem?: number
  /** CSOSN (Simples) — ex '102' */
  cstCsosn?: string
  /** CST ICMS (Regime Normal) — ex '00' */
  cstIcms?: string
  aliquotaIcms?: number
  cstPis?: string
  aliquotaPis?: number
  cstCofins?: string
  aliquotaCofins?: number
  cstIpi?: string
  aliquotaIpi?: number
  pesoLiquido?: number
  pesoBruto?: number
  exTipi?: string
}

export interface PagamentoInput {
  forma: TipoPagamento
  valor: number
  troco?: number
  /** CNPJ da credenciadora (cartão), opcional */
  cnpjCredenciadora?: string
  /** Bandeira do cartão (01=Visa, 02=Mastercard, 03=Amex, 04=Sorocred, 99=Outros) */
  bandeira?: string
  /** Número de autorização da operação (cartão) */
  autorizacao?: string
}

export interface FreteInput {
  modalidade: number  // 0..9 (0=CIF emit, 1=FOB dest, 2=terceiros, 3/4=próprio, 9=sem frete)
  /** Compat legado */
  transportadoraCnpj?: string
  transportadoraNome?: string
  veiculoPlaca?: string
  veiculoUf?: string
  valor?: number
  valorSeguro?: number
  somaTotalNota?: boolean
  /** Transportadora completa (Fase 5) */
  transportadora?: {
    nome?: string | null
    cnpj?: string | null
    ie?: string | null
    uf?: string | null
    municipio?: string | null
  } | null
  /** Veículo completo */
  veiculo?: {
    placa: string
    uf?: string | null
    rntc?: string | null
  } | null
  /** Volumes */
  volumes?: Array<{
    qVol?: number | null
    esp?: string | null
    marca?: string | null
    nVol?: string | null
    pesoL?: number | null
    pesoB?: number | null
  }>
}

export interface DestinatarioOverride {
  cpf?: string
  cnpj?: string
  nome: string
  email?: string
  endereco?: {
    logradouro: string
    numero: string
    bairro: string
    municipio: string
    codigoMunicipio: string  // 7 dígitos IBGE
    uf: string               // sigla
    cep: string              // 8 dígitos
    complemento?: string
  }
  inscricaoEstadual?: string
  /** Indicador IE: 1=Contribuinte, 2=Isento, 9=Não contribuinte */
  indicadorIe?: 1 | 2 | 9
}

// === Resultado ===

export interface NfeResult {
  notaId: string
  status: 'autorizada' | 'rejeitada' | 'denegada' | 'falha_temporaria' | 'aguardando_sefaz'
  modelo: Modelo
  ambiente: Ambiente
  serie: number
  numero: number
  /** 44 caracteres */
  chaveAcesso?: string
  protocolo?: string
  /** URL completa do QR Code (apenas modelo 65) */
  qrCode?: string
  /** URL pública de consulta (apenas modelo 65) */
  urlConsulta?: string
  erros?: Array<{ codigo: string; descricao: string }>
  rawResponse?: string
}
