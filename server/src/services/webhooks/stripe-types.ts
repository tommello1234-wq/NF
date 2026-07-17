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

/**
 * Eventos que SÓ capturam CPF/CNPJ do custom field (sem emitir nota).
 * O `checkout.session.completed` é a única forma de pegar o que o cliente
 * preencheu no custom field "CPF" do Payment Link — a Stripe não copia
 * isso pro invoice depois. A gente salva em stripe_customer_doc e usa
 * quando o invoice.payment_succeeded chegar (segundos depois).
 */
export const STRIPE_EVENTOS_CAPTURAR_DOC = [
  'checkout.session.completed',
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

export function isEventoCapturarDoc(type: string): boolean {
  return (STRIPE_EVENTOS_CAPTURAR_DOC as readonly string[]).includes(type)
}

export function isEventoRegistrar(type: string): boolean {
  return (STRIPE_EVENTOS_REGISTRAR as readonly string[]).includes(type)
}

/** Shape mínimo do invoice que precisamos (tolerante a múltiplas API versions) */
export interface StripeInvoiceLike {
  id?: string
  amount_paid?: number
  description?: string | null
  // Datas em Unix timestamp (segundos). Usadas como competência da NFS-e
  // (mês da venda). paid_at = quando a invoice foi paga; created = criação.
  created?: number
  status_transitions?: { paid_at?: number | null } | null
  // Em invoice o campo customer normalmente é só uma string com o id ("cus_...")
  // mas algumas versões da API expandem pra objeto. Aceita os dois.
  customer?: string | { id?: string } | null
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
  // Custom fields preenchidos pelo cliente no Payment Link / Checkout.
  // Formatos conhecidos:
  //   Invoice nativo:  [{ name: "CPF", value: "123.456.789-00" }]
  //   Checkout:        [{ key, label, type, text: { value: "..." }, ... }]
  custom_fields?: Array<StripeCustomFieldLike> | null
  metadata?: Record<string, string> | null
  // Campo que pode estar em invoice.subscription (versões antigas)
  // ou invoice.parent.subscription_details.subscription (versões novas)
  subscription?: string | { id?: string } | null
  parent?: {
    subscription_details?: {
      subscription?: string | { id?: string } | null
      metadata?: Record<string, string> | null
    } | null
  } | null
  lines?: {
    data?: Array<StripeInvoiceLineLike>
  } | null
}

/**
 * Shape mínimo do checkout.session.completed que precisamos pra capturar
 * o CPF/CNPJ que o cliente preencheu no custom field do Payment Link.
 */
export interface StripeCheckoutSessionLike {
  id?: string
  customer?: string | { id?: string } | null
  customer_email?: string | null
  customer_details?: {
    name?: string | null
    email?: string | null
    tax_ids?: Array<{ type: string; value: string }> | null
  } | null
  custom_fields?: Array<StripeCustomFieldLike> | null
  metadata?: Record<string, string> | null
  payment_status?: string | null
}

/**
 * Formato bem flexível pra custom field — abrange tanto o formato simples
 * de invoice quanto o complexo de checkout session (que tem key/label/text).
 */
export interface StripeCustomFieldLike {
  // Formato simples (invoice.custom_fields)
  name?: string | null
  value?: string | null
  // Formato checkout session (que pode ser copiado pro invoice)
  key?: string | null
  label?: string | { custom?: string } | null
  text?: { value?: string | null } | null
  numeric?: { value?: string | null } | null
  dropdown?: { value?: string | null } | null
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

/**
 * Extrai o valor "textual" de um custom field, lidando com os 2 formatos
 * conhecidos (invoice nativo: {name,value} vs checkout: {key,label,text:{value}}).
 */
function valorDoCustomField(cf: StripeCustomFieldLike): string | undefined {
  if (cf.value) return cf.value
  if (cf.text?.value) return cf.text.value
  if (cf.numeric?.value) return cf.numeric.value
  if (cf.dropdown?.value) return cf.dropdown.value
  return undefined
}

/** Extrai a "key" textual pra matching — usa name OU key OU label. */
function chaveDoCustomField(cf: StripeCustomFieldLike): string {
  if (cf.name) return cf.name
  if (cf.key) return cf.key
  if (typeof cf.label === 'string') return cf.label
  if (cf.label && typeof cf.label === 'object' && cf.label.custom) return cf.label.custom
  return ''
}

/**
 * Heurística pra ver se uma "key" parece referir a CPF/CNPJ/Documento.
 * Aceita CPF, cpf, Cpf, "CPF/CNPJ", "Documento", "Tax ID", "tax_id", etc.
 */
function pareceCampoDoc(key: string): { kind: 'cpf' | 'cnpj' | 'qualquer' } | null {
  const k = key
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^a-z0-9]/g, '') // remove pontuação/espaços
  if (!k) return null
  if (k === 'cpf' || k.includes('cpf') && !k.includes('cnpj')) return { kind: 'cpf' }
  if (k === 'cnpj' || (k.includes('cnpj') && !k.includes('cpf'))) return { kind: 'cnpj' }
  // Genéricos — decide pelo tamanho dos dígitos depois
  if (
    k === 'documento' ||
    k === 'doc' ||
    k === 'taxid' ||
    k === 'documentofiscal' ||
    k.includes('cpfcnpj') ||
    k.includes('cnpjcpf') ||
    k === 'identidade'
  ) {
    return { kind: 'qualquer' }
  }
  return null
}

/**
 * Tenta extrair CPF/CNPJ de TUDO QUE A STRIPE OFERECE:
 *   1. customer_tax_ids (oficial, formato br_cpf/br_cnpj)
 *   2. invoice.custom_fields (custom field do Payment Link)
 *   3. invoice.metadata.{cpf,cnpj,documento,...}
 *   4. invoice.parent.subscription_details.metadata.{...}
 *
 * Ordem importa: tax_ids tem prioridade porque é o lugar "oficial".
 */
export function extrairCpfCnpjDeTudo(
  invoice: StripeInvoiceLike
): { cpf?: string; cnpj?: string; fonte?: string } {
  // 1. tax_ids oficial
  const fromTax = extrairCpfCnpjBrasileiro(invoice.customer_tax_ids)
  if (fromTax.cpf) return { cpf: fromTax.cpf, fonte: 'customer_tax_ids' }
  if (fromTax.cnpj) return { cnpj: fromTax.cnpj, fonte: 'customer_tax_ids' }

  // 2. invoice.custom_fields
  if (invoice.custom_fields && invoice.custom_fields.length > 0) {
    for (const cf of invoice.custom_fields) {
      const key = chaveDoCustomField(cf)
      const hint = pareceCampoDoc(key)
      if (!hint) continue
      const raw = valorDoCustomField(cf)
      if (!raw) continue
      const digits = raw.replace(/\D/g, '')
      if (hint.kind === 'cpf' && digits.length === 11) {
        return { cpf: digits, fonte: `custom_fields.${key}` }
      }
      if (hint.kind === 'cnpj' && digits.length === 14) {
        return { cnpj: digits, fonte: `custom_fields.${key}` }
      }
      if (hint.kind === 'qualquer') {
        if (digits.length === 11) return { cpf: digits, fonte: `custom_fields.${key}` }
        if (digits.length === 14) return { cnpj: digits, fonte: `custom_fields.${key}` }
      }
    }
  }

  // 3. invoice.metadata
  const fromMeta = extrairDeMetadata(invoice.metadata, 'invoice.metadata')
  if (fromMeta.cpf || fromMeta.cnpj) return fromMeta

  // 4. subscription_details.metadata (versões novas da API)
  const fromSub = extrairDeMetadata(
    invoice.parent?.subscription_details?.metadata,
    'subscription.metadata'
  )
  if (fromSub.cpf || fromSub.cnpj) return fromSub

  return {}
}

/**
 * Extrai CPF/CNPJ de uma checkout.session.completed — varre custom_fields,
 * metadata, e tax_ids (em customer_details). Retorna a fonte exata pra
 * auditoria depois.
 */
export function extrairCpfCnpjDeCheckout(
  session: StripeCheckoutSessionLike
): { cpf?: string; cnpj?: string; fonte?: string; nome?: string; email?: string } {
  const nome = session.customer_details?.name || undefined
  const email = session.customer_details?.email || session.customer_email || undefined

  // 1. customer_details.tax_ids (se tax_id_collection habilitado)
  const fromTax = extrairCpfCnpjBrasileiro(session.customer_details?.tax_ids)
  if (fromTax.cpf) return { cpf: fromTax.cpf, fonte: 'checkout.customer_details.tax_ids', nome, email }
  if (fromTax.cnpj) return { cnpj: fromTax.cnpj, fonte: 'checkout.customer_details.tax_ids', nome, email }

  // 2. custom_fields — formato checkout: {key, label, text:{value}}
  if (session.custom_fields && session.custom_fields.length > 0) {
    for (const cf of session.custom_fields) {
      const key = chaveDoCustomField(cf)
      const hint = pareceCampoDoc(key)
      if (!hint) continue
      const raw = valorDoCustomField(cf)
      if (!raw) continue
      const digits = raw.replace(/\D/g, '')
      if (hint.kind === 'cpf' && digits.length === 11) {
        return { cpf: digits, fonte: `checkout.custom_fields.${key}`, nome, email }
      }
      if (hint.kind === 'cnpj' && digits.length === 14) {
        return { cnpj: digits, fonte: `checkout.custom_fields.${key}`, nome, email }
      }
      if (hint.kind === 'qualquer') {
        if (digits.length === 11) return { cpf: digits, fonte: `checkout.custom_fields.${key}`, nome, email }
        if (digits.length === 14) return { cnpj: digits, fonte: `checkout.custom_fields.${key}`, nome, email }
      }
    }
  }

  // 3. session.metadata
  const fromMeta = extrairDeMetadata(session.metadata, 'checkout.metadata')
  if (fromMeta.cpf || fromMeta.cnpj) return { ...fromMeta, nome, email }

  return { nome, email }
}

/** Pega o customer_id (string) tolerante a múltiplos formatos da Stripe. */
export function extrairCustomerId(obj: {
  customer?: string | { id?: string } | null
}): string | undefined {
  const c = obj.customer
  if (typeof c === 'string') return c
  if (c && typeof c === 'object' && c.id) return c.id
  return undefined
}

function extrairDeMetadata(
  meta: Record<string, string> | null | undefined,
  fontePrefix: string
): { cpf?: string; cnpj?: string; fonte?: string } {
  if (!meta) return {}
  for (const [key, value] of Object.entries(meta)) {
    if (!value) continue
    const hint = pareceCampoDoc(key)
    if (!hint) continue
    const digits = String(value).replace(/\D/g, '')
    if (hint.kind === 'cpf' && digits.length === 11) {
      return { cpf: digits, fonte: `${fontePrefix}.${key}` }
    }
    if (hint.kind === 'cnpj' && digits.length === 14) {
      return { cnpj: digits, fonte: `${fontePrefix}.${key}` }
    }
    if (hint.kind === 'qualquer') {
      if (digits.length === 11) return { cpf: digits, fonte: `${fontePrefix}.${key}` }
      if (digits.length === 14) return { cnpj: digits, fonte: `${fontePrefix}.${key}` }
    }
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
