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
 * Endpoints SEFAZ-CE (autorizador NFe + NFC-e do Ceará).
 * Refs: https://nfe.sefaz.ce.gov.br/pages/ServicosWeb.jsf
 *       https://nfce.sefaz.ce.gov.br/pages/ServicosWeb.jsf
 */
export const SEFAZ_CE_URL = {
  nfe: {
    homolog: 'https://nfeh.sefaz.ce.gov.br/nfe4/services',
    prod: 'https://nfe.sefaz.ce.gov.br/nfe4/services',
  },
  nfce: {
    homolog: 'https://nfceh.sefaz.ce.gov.br/nfce4/services',
    prod: 'https://nfce.sefaz.ce.gov.br/nfce4/services',
  },
  consultaPublicaNfce: {
    homolog: 'https://nfceh.sefaz.ce.gov.br/pages/consultaNFCe.jsf',
    prod: 'https://nfce.sefaz.ce.gov.br/pages/consultaNFCe.jsf',
  },
} as const

/** Caminhos relativos dos webservices (concatena com a base SEFAZ_CE_URL) */
export const WS_PATH = {
  autorizacao: '/NfeAutorizacao4',
  retAutorizacao: '/NfeRetAutorizacao4',
  inutilizacao: '/NfeInutilizacao4',
  consultaProtocolo: '/NfeConsultaProtocolo4',
  statusServico: '/NfeStatusServico4',
  recepcaoEvento: '/RecepcaoEvento4',
  cadConsultaCadastro: '/CadConsultaCadastro4',
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
}

export interface ItemInput {
  produtoId: string
  quantidade: number
  /** Sobrescreve valor_unitario do produto se fornecido */
  valorUnitario?: number
  /** Desconto absoluto pra esse item */
  valorDesconto?: number
  /** Sobrescreve CFOP do produto/natureza */
  cfop?: string
  /** Info adicional do item (texto livre, vai pra <infAdProd>) */
  infoAdicional?: string
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
  modalidade: 0 | 1 | 2 | 3 | 4 | 9
  //  0=Por conta emitente, 1=Por conta destinatário, 2=Por conta terceiros,
  //  3=Transp. próprio remetente, 4=Transp. próprio destinatário, 9=Sem frete
  transportadoraCnpj?: string
  transportadoraNome?: string
  veiculoPlaca?: string
  veiculoUf?: string
  valorFrete?: number
  valorSeguro?: number
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
