/**
 * Types do domínio NFS-e Padrão Nacional (Sefin Nacional NFS-e).
 * Refs: gov.br/nfse — Anexo I (Layout DPS_NFSe-SNNFSe), Manual v1.2.
 */

export type Ambiente = 1 | 2  // 1=produção, 2=produção restrita (homologação)

/**
 * Endpoints base do webservice da Sefin Nacional NFS-e (emissor público).
 * Confirmado via swagger oficial em
 * https://sefin.producaorestrita.nfse.gov.br/SefinNacional/swagger/docs/v1.
 */
export const SEFIN_URL = {
  homolog: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional',
  prod: 'https://sefin.nfse.gov.br/SefinNacional',
} as const

/** Parâmetros municipais ficam em outro host (ADN — Ambiente de Dados Nacional) */
export const ADN_PARAM_URL = {
  homolog: 'https://adn.producaorestrita.nfse.gov.br/parametrizacao',
  prod: 'https://adn.nfse.gov.br/parametrizacao',
} as const

/** Versão atual do schema XSD da DPS/NFS-e */
export const VERSAO_DPS = '1.01'
export const NFSE_NS = 'http://www.sped.fazenda.gov.br/nfse'
export const XMLDSIG_NS = 'http://www.w3.org/2000/09/xmldsig#'

/** Situação perante Simples Nacional (regTrib/opSimpNac) */
export type OpSimpNac = 1 | 2 | 3
//  1 = Não optante / 2 = Optante MEI / 3 = Optante ME-EPP

/** Regime de apuração — só usado quando opSimpNac=3 */
export type RegApTribSN = 1 | 2 | 3

/** Regime especial de tributação (regTrib/regEspTrib) */
export type RegEspTrib = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 9
//  0=Nenhum / 1=Cooperativa / 2=Estimativa / 3=ME municipal /
//  4=Notário / 5=Profissional autônomo / 6=Sociedade de profissionais / 9=Outros

/** Input mínimo pra montar uma DPS */
export interface DpsInput {
  ambiente: Ambiente
  serie: number
  numero: number  // sequencial DPS por emitente+série
  dataEmissao: Date
  dataCompetencia: Date  // quando o serviço começou
  codigoMunicipioEmissor: string  // 7 dígitos IBGE (ex: 2309003 = Mucambo)
  prestador: PrestadorDps
  tomador: TomadorDps
  servico: ServicoDps
  valores: ValoresDps
  versaoAplicativo?: string  // ex: 'UPWARD-NFSE-1.0'
}

export interface PrestadorDps {
  cnpj: string  // só dígitos, 14
  inscricaoMunicipal: string  // IM da prefeitura emissora
  nome: string  // razão social
  endereco?: EnderecoDps
  email?: string
  telefone?: string
  regimeTributario: {
    opSimpNac: OpSimpNac
    regApTribSN?: RegApTribSN
    regEspTrib: RegEspTrib
  }
}

export interface TomadorDps {
  cpf?: string  // só dígitos, 11
  cnpj?: string  // só dígitos, 14
  nome: string
  email?: string
  endereco?: EnderecoDps
}

export interface EnderecoDps {
  logradouro: string
  numero: string
  bairro: string
  codigoMunicipio: string  // 7 dígitos IBGE
  cep: string  // 8 dígitos
  complemento?: string
}

export interface ServicoDps {
  /** Código de tributação nacional (LC 116 / NBS — depende da regulamentação atual) */
  codigoTributacaoNacional: string
  /** Código de tributação municipal (varia por prefeitura) */
  codigoTributacaoMunicipal?: string
  /** Código NBS (Nomenclatura Brasileira de Serviços) — opcional */
  codigoNBS?: string
  /** Descrição do serviço prestado */
  descricao: string
  /** Local da prestação — usa cMunOcorISSQN */
  localPrestacaoCodigoMunicipio?: string  // 7 dígitos IBGE; default = município emissor
}

export interface ValoresDps {
  valorServicos: number
  valorDeducoes?: number
  /** Alíquota ISS efetiva (em %) — pra ME no Simples geralmente 0 */
  aliquotaIss: number
  issRetido: boolean
}

/** Resposta crua do POST /nfse — pode ser sucesso (XML NFS-e) ou rejeição (JSON) */
export interface NfseResponse {
  status: number
  contentType: string
  body: string  // XML da NFS-e ou JSON com mensagens de erro
  headers: Record<string, string>
}
