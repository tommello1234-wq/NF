/**
 * Tipos do payload do webhook v2 da Ticto.
 * Refs: https://xavier.ticto.dev/docs/v2
 *
 * Campos críticos:
 *   - status                     "authorized" = compra aprovada (emitir NFS-e)
 *                                "refunded"   = reembolso (cancela nota)
 *                                "chargeback" = chargeback (cancela nota)
 *                                "waiting_payment" / "boleto_printed" / "pix_created" / etc.
 *   - order.transaction_hash     Único — usado como external_id (idempotência)
 *   - token                      Token de validação enviado pela Ticto
 *   - customer.cpf / cnpj        Identificação do tomador
 *   - item.product_id            Mapeia pro produto cadastrado (servico)
 *   - item.amount, paid_amount   Valores em CENTAVOS (R$ 10000 = R$100,00)
 */

export interface TictoWebhookV2 {
  version?: string
  status: string
  status_date?: string
  token?: string
  payment_method?: string

  order?: {
    id?: number | string
    hash?: string
    transaction_hash?: string
    paid_amount?: number  // centavos
    installments?: number
    order_date?: string
  }

  item?: {
    product_id?: number | string
    product_name?: string
    offer_id?: number | string
    offer_name?: string
    quantity?: number
    amount?: number  // centavos
    refund_deadline?: number
  }

  customer?: {
    cpf?: string | null
    cnpj?: string | null
    name?: string
    type?: 'person' | 'company' | string
    email?: string
    phone?: { ddd?: string; ddi?: string; number?: string }
    address?: {
      city?: string
      state?: string
      street?: string
      country?: string
      zip_code?: string
      complement?: string | null
      neighborhood?: string
      street_number?: string
    }
    is_foreign?: boolean
    code?: string
  }

  shipping?: {
    amount?: number
    type?: string
    method?: string
    delivery_days?: number
  }

  tracking?: Record<string, string | null>
  // ... demais campos não-essenciais omitidos
}

/** Eventos da Ticto que disparam ação no nosso sistema */
export type TictoEventoRelevante = 'authorized' | 'refunded' | 'chargeback'

export function isEventoEmitir(status: string): boolean {
  return status === 'authorized'
}
export function isEventoCancelar(status: string): boolean {
  return status === 'refunded' || status === 'chargeback'
}
