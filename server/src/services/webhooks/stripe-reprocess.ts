import { supabase } from '../supabase.js'
import { emitirNfse } from '../nfse/orquestrador.js'
import { mapearStripeInvoiceParaEmissao } from './stripe-mapper.js'
import { extrairCustomerId, type StripeInvoiceLike } from './stripe-types.js'

/**
 * Reemite a NFS-e de um evento `invoice.payment_succeeded` da Stripe a partir
 * do payload JÁ SALVO em `webhook_events` (não chama a Stripe de novo).
 *
 * Usado em dois lugares:
 *   1. Endpoint admin "Reprocessar" (retentativa manual).
 *   2. Auto-reemissão: quando o CPF chega pelo checkout DEPOIS da cobrança já
 *      ter falhado por "sem CPF" (race de eventos), o handler de checkout chama
 *      isto pra destravar a nota sozinho.
 *
 * Guard: só emite se o evento estiver com erro (nunca reprocessa um que já
 * virou `processado` com nota — evita duplicar nota / consumir numeração).
 */

export interface ReemitirResult {
  ok: boolean
  notaId?: string
  status?: string
  erro?: string
}

export async function reemitirEventoStripe(eventoId: string): Promise<ReemitirResult> {
  const { data: evento } = await supabase
    .from('webhook_events')
    .select('id, provider, empresa_id, event_type, payload, status, nota_fiscal_id')
    .eq('id', eventoId)
    .maybeSingle()
  if (!evento) return { ok: false, erro: 'Evento não encontrado' }
  if (evento.provider !== 'stripe') return { ok: false, erro: 'Reprocessar disponível só pra eventos Stripe' }
  if (evento.status === 'processado' && evento.nota_fiscal_id) {
    return { ok: false, erro: 'Evento já processado com sucesso (nota emitida)' }
  }
  if (evento.event_type !== 'invoice.payment_succeeded') {
    return { ok: false, erro: `Tipo "${evento.event_type}" não aciona emissão — só invoice.payment_succeeded` }
  }

  const { data: empresa } = await supabase
    .from('empresas')
    .select('id, municipio_emissor_codigo, endereco_codigo_ibge, stripe_produto_default_id')
    .eq('id', evento.empresa_id)
    .maybeSingle()
  if (!empresa) return { ok: false, erro: 'Empresa do evento não encontrada' }

  const cMunFallback = String(empresa.municipio_emissor_codigo || empresa.endereco_codigo_ibge || '')
  if (cMunFallback.length !== 7) {
    return { ok: false, erro: 'Empresa sem código IBGE de município emissor' }
  }

  // O payload salvo é o event inteiro — invoice fica em data.object
  const payload = (evento.payload as unknown as { data?: { object?: unknown } }) || {}
  const invoice = (payload.data?.object || {}) as StripeInvoiceLike

  let mapped
  try {
    mapped = mapearStripeInvoiceParaEmissao(invoice, cMunFallback)
  } catch (e) {
    const msg = (e as Error).message
    // Fallback de CPF: busca o doc guardado da checkout.session.completed.
    if (msg.includes('CPF/CNPJ')) {
      const customerId = extrairCustomerId(invoice)
      if (customerId) {
        const { data: doc } = await supabase
          .from('stripe_customer_doc')
          .select('cpf, cnpj, nome, email')
          .eq('empresa_id', evento.empresa_id)
          .eq('stripe_customer_id', customerId)
          .maybeSingle()
        if (doc && (doc.cpf || doc.cnpj)) {
          const invoiceComDoc: StripeInvoiceLike = {
            ...invoice,
            customer_tax_ids: [
              ...(invoice.customer_tax_ids || []),
              doc.cpf ? { type: 'br_cpf', value: doc.cpf } : { type: 'br_cnpj', value: doc.cnpj! },
            ],
            customer_name: invoice.customer_name || doc.nome || undefined,
            customer_email: invoice.customer_email || doc.email || undefined,
          }
          try {
            mapped = mapearStripeInvoiceParaEmissao(invoiceComDoc, cMunFallback)
          } catch (e2) {
            await marcarEventoErro(evento.id, (e2 as Error).message)
            return { ok: false, erro: (e2 as Error).message }
          }
        }
      }
    }
    if (!mapped) {
      await marcarEventoErro(evento.id, msg)
      return { ok: false, erro: msg }
    }
  }

  const { data: mapping } = await supabase
    .from('stripe_mapeamento')
    .select('produto_id, valor_unitario_override, ativo')
    .eq('empresa_id', evento.empresa_id)
    .eq('stripe_price_id', mapped.stripePriceId)
    .eq('ativo', true)
    .maybeSingle()

  let produtoId: string | null = mapping?.produto_id ?? null
  let valorFinal = mapped.valorServicos
  if (mapping?.valor_unitario_override) {
    valorFinal = Number(mapping.valor_unitario_override)
  }
  if (!produtoId && empresa.stripe_produto_default_id) {
    produtoId = empresa.stripe_produto_default_id
  }
  if (!produtoId) {
    const msg = `Sem mapeamento Stripe pra price_id=${mapped.stripePriceId} e sem produto default configurado.`
    await marcarEventoErro(evento.id, msg)
    return { ok: false, erro: msg }
  }

  try {
    const result = await emitirNfse({
      empresaId: evento.empresa_id,
      produtoId,
      tomadorOverride: mapped.tomador,
      valorServicos: valorFinal,
      descricao: mapped.descricao,
      dataCompetencia: mapped.dataCompetencia,
    })
    await supabase
      .from('webhook_events')
      .update({
        status: result.status === 'autorizada' ? 'processado' : 'erro',
        nota_fiscal_id: result.notaId,
        processado_em: new Date().toISOString(),
        erro: result.status !== 'autorizada' ? result.erros?.[0]?.descricao : null,
      })
      .eq('id', evento.id)
    return { ok: true, notaId: result.notaId, status: result.status }
  } catch (e) {
    await marcarEventoErro(evento.id, (e as Error).message)
    return { ok: false, erro: (e as Error).message }
  }
}

/**
 * Auto-reemissão do race: dado um customer que ACABOU de ter o CPF gravado
 * (via checkout.session.completed), reprocessa as cobranças desse customer que
 * falharam por "sem CPF" nas últimas 48h. Retorna quantas notas saíram.
 */
export async function reemitirPendentesDoCustomer(
  empresaId: string,
  stripeCustomerId: string
): Promise<{ tentadas: number; emitidas: number }> {
  const desde = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const { data: pendentes } = await supabase
    .from('webhook_events')
    .select('id, payload')
    .eq('empresa_id', empresaId)
    .eq('provider', 'stripe')
    .eq('event_type', 'invoice.payment_succeeded')
    .eq('status', 'erro')
    .ilike('erro', '%CPF%')
    .gte('recebido_em', desde)

  if (!pendentes || pendentes.length === 0) return { tentadas: 0, emitidas: 0 }

  // Filtra só os eventos cujo invoice é DESSE customer.
  const doCustomer = pendentes.filter((ev) => {
    const inv = (ev.payload as { data?: { object?: unknown } })?.data?.object as StripeInvoiceLike | undefined
    return inv ? extrairCustomerId(inv) === stripeCustomerId : false
  })

  let emitidas = 0
  for (const ev of doCustomer) {
    const r = await reemitirEventoStripe(ev.id)
    if (r.ok && r.status === 'autorizada') emitidas++
  }
  return { tentadas: doCustomer.length, emitidas }
}

async function marcarEventoErro(eventoId: string, mensagem: string) {
  await supabase
    .from('webhook_events')
    .update({
      status: 'erro',
      erro: mensagem.slice(0, 1000),
      processado_em: new Date().toISOString(),
    })
    .eq('id', eventoId)
}
