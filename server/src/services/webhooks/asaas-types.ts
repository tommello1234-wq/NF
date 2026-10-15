/**
 * Tipos do webhook e da API v3 do Asaas — só os campos que usamos.
 *
 * Referência: https://docs.asaas.com/docs/webhook-para-cobrancas
 */

export interface AsaasPayment {
  object?: 'payment'
  id: string
  /** ID do cliente no Asaas (cus_...). Os dados do tomador NÃO vêm no webhook. */
  customer: string
  /** Preenchido quando a cobrança é uma mensalidade de assinatura. */
  subscription?: string | null
  /** Preenchido quando a cobrança é uma parcela de um parcelamento. */
  installment?: string | null
  installmentNumber?: number | null
  /** Valor bruto da cobrança — é o que vai na nota (netValue já desconta a taxa do Asaas). */
  value: number
  netValue?: number
  billingType?: 'BOLETO' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'PIX' | 'UNDEFINED' | string
  status?: string
  description?: string | null
  externalReference?: string | null
  dateCreated?: string
  confirmedDate?: string | null
  paymentDate?: string | null
  clientPaymentDate?: string | null
}

export interface AsaasWebhookPayload {
  /** Presente nas versões novas do webhook; não dá pra depender dele. */
  id?: string
  event: string
  dateCreated?: string
  payment?: AsaasPayment
}

export interface AsaasCustomer {
  id: string
  name: string
  cpfCnpj?: string | null
  email?: string | null
  /** Logradouro (o Asaas chama de address). */
  address?: string | null
  addressNumber?: string | null
  complement?: string | null
  /** Bairro (o Asaas chama de province). */
  province?: string | null
  postalCode?: string | null
  cityName?: string | null
  state?: string | null
  deleted?: boolean
}

export interface AsaasInstallment {
  id: string
  /** Valor TOTAL do parcelamento. */
  value?: number
  /** Valor de cada parcela. */
  paymentValue?: number
  installmentCount?: number
  description?: string | null
}

/**
 * Cobrança paga → emite.
 *
 * - PAYMENT_CONFIRMED: pagamento aprovado (no cartão chega na hora; o dinheiro
 *   só cai ~30 dias depois).
 * - PAYMENT_RECEIVED: dinheiro na conta (PIX e boleto chegam direto aqui; no
 *   cartão é o segundo aviso da MESMA cobrança).
 *
 * Os dois emitem, e a idempotência por ID da cobrança garante uma nota só.
 * Esperar só o RECEIVED atrasaria a nota do cartão em um mês.
 */
const EVENTOS_EMITIR = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'])

/**
 * Estorno total → cancela a NFS-e. Estorno parcial NÃO cancela (precisaria
 * substituir a nota pelo valor que ficou), e contestação de chargeback também
 * não — ela ainda pode ser revertida a favor.
 */
const EVENTOS_CANCELAR = new Set(['PAYMENT_REFUNDED'])

export function isEventoEmitir(evento: string): boolean {
  return EVENTOS_EMITIR.has(evento)
}

export function isEventoCancelar(evento: string): boolean {
  return EVENTOS_CANCELAR.has(evento)
}

/**
 * Chave de idempotência da EMISSÃO. Uma venda = uma nota:
 *
 * - Parcelamento: as N parcelas do cartão chegam juntas, cada uma com seu ID.
 *   A chave é o parcelamento, então sai UMA nota pelo valor total — a venda
 *   foi uma só.
 * - Assinatura: cada mensalidade é um período de serviço novo, então cada
 *   cobrança tem a sua nota.
 * - Avulsa: uma cobrança, uma nota.
 */
export function chaveEmissao(payment: AsaasPayment): string {
  return payment.installment ? `parcelamento:${payment.installment}` : `pagamento:${payment.id}`
}
