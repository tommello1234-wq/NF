import type { TictoWebhookV2 } from './ticto-types.js'

/**
 * Converte payload Ticto → input do orquestrador `emitirNfse`.
 *
 * Ticto envia:
 *   - valores em CENTAVOS → convertemos pra reais
 *   - endereço sem código IBGE → usamos o município emissor da empresa
 *     como fallback (cobre o caso comum onde tomador é do mesmo município)
 *   - quantity em item — usamos paid_amount como valor total efetivo
 */

export interface MappedTomador {
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

export interface MappedEmissao {
  /** Valor total a faturar (em REAIS, já convertido) */
  valorServicos: number
  tomador: MappedTomador
  descricao?: string
  /** ID do produto Ticto pra mapear pro produto cadastrado */
  tictoProductId: string
  /** Hash único da transação Ticto (usado pra idempotência) */
  transactionHash: string
}

export function mapearTictoParaEmissao(
  payload: TictoWebhookV2,
  fallbackMunicipioIbge: string
): MappedEmissao {
  const transactionHash = payload.order?.transaction_hash || payload.order?.hash
  if (!transactionHash) {
    throw new Error('Payload Ticto sem order.transaction_hash')
  }

  const tictoProductId = payload.item?.product_id != null ? String(payload.item.product_id) : ''
  if (!tictoProductId) {
    throw new Error('Payload Ticto sem item.product_id')
  }

  // Valor: prefere paid_amount (líquido pago), com item.amount como fallback
  const centavos = payload.order?.paid_amount ?? payload.item?.amount ?? 0
  const valorServicos = Math.round(centavos) / 100
  if (valorServicos <= 0) {
    throw new Error(`Valor inválido no payload Ticto: ${centavos} centavos`)
  }

  const c = payload.customer || {}
  const cpf = (c.cpf || '').replace(/\D/g, '') || undefined
  const cnpj = (c.cnpj || '').replace(/\D/g, '') || undefined
  if (!cpf && !cnpj) {
    throw new Error('Payload Ticto sem CPF/CNPJ do customer')
  }

  const nome = (c.name || '').trim() || 'Cliente Ticto'
  const email = (c.email || '').trim() || undefined

  let endereco: MappedTomador['endereco']
  if (c.address?.street) {
    endereco = {
      logradouro: (c.address.street || '').slice(0, 200),
      numero: (c.address.street_number || 'S/N').slice(0, 60),
      bairro: (c.address.neighborhood || 'Centro').slice(0, 60),
      // Ticto não envia código IBGE — usamos o município emissor como
      // fallback. Em uma versão futura podemos resolver via tabela IBGE.
      codigoMunicipio: fallbackMunicipioIbge,
      cep: (c.address.zip_code || '').replace(/\D/g, '').slice(0, 8),
      complemento: c.address.complement || undefined,
    }
  }

  const descricao = payload.item?.product_name
    ? `${payload.item.product_name}${payload.item?.offer_name ? ` — ${payload.item.offer_name}` : ''}`
    : undefined

  return {
    valorServicos,
    tomador: {
      ...(cpf ? { cpf } : { cnpj }),
      nome,
      email,
      endereco,
    },
    descricao,
    tictoProductId,
    transactionHash,
  }
}
