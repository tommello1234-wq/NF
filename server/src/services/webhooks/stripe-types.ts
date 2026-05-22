/**
 * Tipos e helpers do webhook Stripe.
 *
 * Estratégia: Stripe muda muito a estrutura dos tipos entre versões da API
 * (ex: na 2026-04-22.dahlia campos como invoice.subscription foram movidos
 * pra invoice.parent.subscription_details.subscription). Em vez de depender
 * de tipos específicos da lib, lemos o JSON cru com fallbacks defensivos.
 */

/** Eventos que vão acionar emissão NFS-e */
export const STRIPE_EVENTOS_EMITIR = [
  'invoice.payment_succeeded',
  // 'checkout.session.completed', // pagamento único — adicionar quando suportar
] as const

/** Eventos só pra registrar (futuro: cancelar nota?) */
export const STRIPE_EVENTOS_REGISTRAR = [
  'invoice.payment_failed',
  'charge.refunded',
  'customer.subscription.deleted',
] as const

export function isEventoEmitir(type: string): boolean {
  return (STRIPE_EVENTOS_EMITIR as readonly string[]).includes(type)
}

export function isEventoRegistrar(type: string): boolean {
  return (STRIPE_EVENTOS_REGISTRAR as readonly string[]).includes(type)
}

/** Shape mínimo do invoice que precisamos (tolerante a múltiplas API versions) */
export interface StripeInvoiceLike {
  id?: string
  amount_paid?: number
  description?: string | null
  customer_name?: string | null
  customer_email?: string | null
  customer_address?: {
    line1?: string | null
    line2?: string | null
    city?: string | null
    state?: string | null
    postal_code?: string | null
    country?: string | null
  } | null
  customer_tax_ids?: Array<{ type: string; value: string }> | null
  // Campo que pode estar em invoice.subscription (versões antigas)
  // ou invoice.parent.subscription_details.subscription (versões novas)
  subscription?: string | { id?: string } | null
  parent?: {
    subscription_details?: {
      subscription?: string | { id?: string } | null
    } | null
  } | null
  lines?: {
    data?: Array<StripeInvoiceLineLike>
  } | null
}

export interface StripeInvoiceLineLike {
  description?: string | null
  // Versões antigas: line.price
  price?: string | { id?: string } | null
  // Versões novas: line.pricing.price_details.price
  pricing?: {
    price_details?: {
      price?: string | { id?: string } | null
      product?: string | null
    } | null
  } | null
}

/**
 * Extrai CPF ou CNPJ do array de tax_ids. Stripe usa types 'br_cpf' e 'br_cnpj'.
 */
export function extrairCpfCnpjBrasileiro(
  taxIds: Array<{ type: string; value: string }> | null | undefined
): { cpf?: string; cnpj?: string } {
  if (!taxIds || taxIds.length === 0) return {}
  const cpfTax = taxIds.find((t) => t.type === 'br_cpf')
  if (cpfTax?.value) {
    const cpf = cpfTax.value.replace(/\D/g, '')
    if (cpf.length === 11) return { cpf }
  }
  const cnpjTax = taxIds.find((t) => t.type === 'br_cnpj')
  if (cnpjTax?.value) {
    const cnpj = cnpjTax.value.replace(/\D/g, '')
    if (cnpj.length === 14) return { cnpj }
  }
  return {}
}

/** Extrai subscription id com fallback entre versões da API */
export function extrairSubscriptionId(invoice: StripeInvoiceLike): string | undefined {
  const sub = invoice.subscription
  if (typeof sub === 'string') return sub
  if (sub && typeof sub === 'object' && sub.id) return sub.id
  const newSub = invoice.parent?.subscription_details?.subscription
  if (typeof newSub === 'string') return newSub
  if (newSub && typeof newSub === 'object' && newSub.id) return newSub.id
  return undefined
}

/** Extrai price id do primeiro line item, com fallback entre versões */
export function extrairPriceId(invoice: StripeInvoiceLike): string | undefined {
  const firstLine = invoice.lines?.data?.[0]
  if (!firstLine) return undefined
  // Versão antiga: line.price (string ou { id })
  const oldPrice = firstLine.price
  if (typeof oldPrice === 'string') return oldPrice
  if (oldPrice && typeof oldPrice === 'object' && oldPrice.id) return oldPrice.id
  // Versão nova: line.pricing.price_details.price
  const newPrice = firstLine.pricing?.price_details?.price
  if (typeof newPrice === 'string') return newPrice
  if (newPrice && typeof newPrice === 'object' && newPrice.id) return newPrice.id
  return undefined
}
