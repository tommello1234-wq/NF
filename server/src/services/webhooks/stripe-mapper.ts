import {
  extrairCpfCnpjBrasileiro,
  extrairPriceId,
  extrairSubscriptionId,
  type StripeInvoiceLike,
} from './stripe-types.js'

/**
 * Converte invoice.payment_succeeded da Stripe → input do orquestrador NFS-e.
 *
 * Particularidades vs Ticto:
 *   - Valores em centavos (igual Ticto)
 *   - Doc brasileiro vem em customer_tax_ids (precisa tax_id_collection)
 *   - Identificador de produto = price.id (mas o campo mudou entre versões da API)
 *   - external_id pra idempotência = event.id (não invoice.id) — uso do event garante
 *     que retries da Stripe sejam idempotentes
 */

export interface MappedTomadorStripe {
  cpf?: string
  cnpj?: string
  nome: string
  email?: string
  endereco?: {
    logradouro: string
    numero: string
    bairro: string
    codigoMunicipio: string
    cep: string
    complemento?: string
  }
}

export interface MappedEmissaoStripe {
  valorServicos: number       // em reais, já dividido
  tomador: MappedTomadorStripe
  descricao?: string
  stripePriceId: string       // pra mapear pro serviço cadastrado
  invoiceId: string
  subscriptionId?: string
}

export function mapearStripeInvoiceParaEmissao(
  invoice: StripeInvoiceLike,
  fallbackMunicipioIbge: string
): MappedEmissaoStripe {
  const invoiceId = invoice.id
  if (!invoiceId) throw new Error('Invoice Stripe sem id')

  const subscriptionId = extrairSubscriptionId(invoice)

  const stripePriceId = extrairPriceId(invoice)
  if (!stripePriceId) {
    throw new Error('Invoice Stripe sem price.id no primeiro item')
  }

  // amount_paid em centavos → reais
  const centavos = invoice.amount_paid ?? 0
  const valorServicos = Math.round(centavos) / 100
  if (valorServicos <= 0) {
    throw new Error(`Valor inválido no invoice Stripe: ${centavos} centavos`)
  }

  const docs = extrairCpfCnpjBrasileiro(invoice.customer_tax_ids)
  if (!docs.cpf && !docs.cnpj) {
    throw new Error(
      'Invoice Stripe sem CPF/CNPJ no customer_tax_ids. ' +
        'Habilite tax_id_collection no Checkout ou crie o Customer com tax_ids brasileiros.'
    )
  }

  const nome = invoice.customer_name?.trim() || 'Cliente Stripe'
  const email = invoice.customer_email?.trim() || undefined

  const addr = invoice.customer_address
  const endereco = addr?.line1
    ? {
        logradouro: addr.line1.slice(0, 200),
        numero: 'S/N',
        bairro: (addr.line2 || 'Centro').slice(0, 60),
        codigoMunicipio: fallbackMunicipioIbge,
        cep: (addr.postal_code || '').replace(/\D/g, '').slice(0, 8) || '00000000',
        complemento: undefined,
      }
    : undefined

  const descricao =
    invoice.description?.trim() ||
    invoice.lines?.data?.[0]?.description?.trim() ||
    undefined

  return {
    valorServicos,
    tomador: {
      ...(docs.cpf ? { cpf: docs.cpf } : { cnpj: docs.cnpj }),
      nome,
      email,
      endereco,
    },
    descricao,
    stripePriceId,
    invoiceId,
    subscriptionId,
  }
}
