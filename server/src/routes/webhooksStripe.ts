import type { FastifyInstance } from 'fastify'
import Stripe from 'stripe'
import { supabase } from '../services/supabase.js'
import { decryptSecret } from '../services/crypto-utils.js'
import { emitirNfse } from '../services/nfse/orquestrador.js'
import { mapearStripeInvoiceParaEmissao } from '../services/webhooks/stripe-mapper.js'
import { reemitirPendentesDoCustomer } from '../services/webhooks/stripe-reprocess.js'
import {
  extrairCpfCnpjDeCheckout,
  extrairCustomerId,
  isEventoCapturarDoc,
  isEventoEmitir,
  isEventoRegistrar,
  type StripeCheckoutSessionLike,
  type StripeInvoiceLike,
} from '../services/webhooks/stripe-types.js'

/**
 * Webhook Stripe — POST /webhooks/stripe/:empresaId
 *
 * Diferenças vs Ticto:
 *   - Validação via header `Stripe-Signature` (HMAC SHA-256 do raw body)
 *   - Stripe assina o body BRUTO, então precisamos do raw buffer (não JSON parseado)
 *   - external_id pra idempotência = event.id (Stripe garante uniqueness)
 *   - CPF/CNPJ vem em customer_tax_ids (precisa tax_id_collection)
 */
export async function webhooksStripeRoutes(app: FastifyInstance) {
  // Fastify parseia JSON por padrão — pra Stripe precisamos do raw body
  // pra validar HMAC. Registra parser específico que entrega Buffer.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body)
    }
  )

  app.post('/stripe/:empresaId', async (req, reply) => {
    const { empresaId } = req.params as { empresaId: string }
    const sig = req.headers['stripe-signature']
    if (!sig || typeof sig !== 'string') {
      return reply.status(400).send({ error: 'Header Stripe-Signature ausente' })
    }

    const rawBody = req.body as Buffer
    if (!Buffer.isBuffer(rawBody)) {
      return reply.status(400).send({ error: 'Body inválido (esperado Buffer)' })
    }

    // 1. Carrega empresa + secret cifrado + produto default (fallback)
    const { data: empresa } = await supabase
      .from('empresas')
      .select(
        'id, municipio_emissor_codigo, endereco_codigo_ibge, stripe_webhook_secret_cifrado, stripe_produto_default_id'
      )
      .eq('id', empresaId)
      .maybeSingle()
    if (!empresa) return reply.status(404).send({ error: 'Empresa não encontrada' })
    if (!empresa.stripe_webhook_secret_cifrado) {
      return reply.status(400).send({ error: 'Empresa sem Stripe webhook secret configurado' })
    }

    // 2. Valida HMAC via lib oficial da Stripe
    let event: Stripe.Event
    try {
      const secret = decryptSecret(empresa.stripe_webhook_secret_cifrado)
      // sk_dummy só pra instanciar — não fazemos chamadas à Stripe API aqui,
      // só validamos signature do webhook (que não usa a chave secret)
      const stripe = new Stripe('sk_dummy_not_used_for_webhook_validation')
      event = stripe.webhooks.constructEvent(rawBody, sig, secret)
    } catch (e) {
      app.log.warn({ err: e }, 'Stripe webhook signature inválida')
      return reply.status(401).send({ error: 'Assinatura inválida', detail: (e as Error).message })
    }

    // 3. Idempotência: external_id = event.id (Stripe garante unicidade)
    const externalId = event.id
    const { data: existente } = await supabase
      .from('webhook_events')
      .select('id, status, nota_fiscal_id')
      .eq('provider', 'stripe')
      .eq('external_id', externalId)
      .maybeSingle()
    if (existente) {
      return reply.status(200).send({
        ok: true,
        idempotent: true,
        webhook_event_id: existente.id,
        status: existente.status,
      })
    }

    // 4. Insere webhook_event como processando
    const { data: evento, error: evtErr } = await supabase
      .from('webhook_events')
      .insert({
        provider: 'stripe',
        external_id: externalId,
        empresa_id: empresaId,
        event_type: event.type,
        payload: event as unknown as Record<string, unknown>,
        status: 'processando',
      })
      .select()
      .single()
    if (evtErr || !evento) {
      return reply.status(200).send({ ok: true, idempotent: true })
    }

    // 5a. Eventos que disparam emissão
    if (isEventoEmitir(event.type)) {
      const invoice = event.data.object as unknown as StripeInvoiceLike

      const cMunFallback = String(
        empresa.municipio_emissor_codigo || empresa.endereco_codigo_ibge || ''
      )
      if (cMunFallback.length !== 7) {
        await marcarEventoErro(evento.id, 'Empresa sem código IBGE de município emissor')
        return reply.status(200).send({ ok: false, erro: 'Empresa sem código IBGE' })
      }

      let mapped
      try {
        mapped = mapearStripeInvoiceParaEmissao(invoice, cMunFallback)
      } catch (e) {
        const msg = (e as Error).message
        // Antes de desistir por falta de CPF, busca em stripe_customer_doc
        // — onde a gente guarda o CPF que veio do checkout.session.completed
        // anterior (custom field do Payment Link).
        if (msg.includes('CPF/CNPJ')) {
          const customerId = extrairCustomerId(invoice)
          if (customerId) {
            const { data: doc } = await supabase
              .from('stripe_customer_doc')
              .select('cpf, cnpj, nome, email')
              .eq('empresa_id', empresaId)
              .eq('stripe_customer_id', customerId)
              .maybeSingle()
            if (doc && (doc.cpf || doc.cnpj)) {
              // Re-tenta o mapper depois de injetar tax_id no invoice
              const invoiceComDoc: StripeInvoiceLike = {
                ...invoice,
                customer_tax_ids: [
                  ...(invoice.customer_tax_ids || []),
                  doc.cpf
                    ? { type: 'br_cpf', value: doc.cpf }
                    : { type: 'br_cnpj', value: doc.cnpj! },
                ],
                customer_name: invoice.customer_name || doc.nome || undefined,
                customer_email: invoice.customer_email || doc.email || undefined,
              }
              try {
                mapped = mapearStripeInvoiceParaEmissao(invoiceComDoc, cMunFallback)
              } catch (e2) {
                await marcarEventoErro(evento.id, (e2 as Error).message)
                return reply.status(200).send({ ok: false, erro: (e2 as Error).message })
              }
            }
          }
        }
        if (!mapped) {
          await marcarEventoErro(evento.id, msg)
          return reply.status(200).send({ ok: false, erro: msg })
        }
      }

      // Resolver produto: 1) mapeamento explícito por price_id, 2) fallback
      // pro produto default da empresa. O fallback existe pra cobrir o caso
      // comum em que a empresa só vende um tipo de serviço (ex: SaaS) e cria
      // payment links na Stripe sem cadastrar cada price_id no admin.
      const { data: mapping } = await supabase
        .from('stripe_mapeamento')
        .select('produto_id, valor_unitario_override, ativo')
        .eq('empresa_id', empresaId)
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
        // Quando cai no fallback NUNCA aplicamos override — usamos sempre
        // o amount_paid real da invoice. Override só faz sentido quando o
        // usuário cadastrou um mapeamento específico pro price_id.
      }

      if (!produtoId) {
        await marcarEventoErro(
          evento.id,
          `Sem mapeamento Stripe pra price_id=${mapped.stripePriceId} e sem produto default configurado. Cadastre em /integracoes/stripe.`
        )
        return reply.status(200).send({
          ok: false,
          erro: `Sem mapeamento Stripe pra price_id=${mapped.stripePriceId} e sem produto default configurado`,
        })
      }

      try {
        const result = await emitirNfse({
          empresaId,
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
        return reply.status(200).send({ ok: true, nota_id: result.notaId, status: result.status })
      } catch (e) {
        app.log.error({ err: e }, 'Erro ao emitir NFS-e via Stripe webhook')
        await marcarEventoErro(evento.id, (e as Error).message)
        return reply.status(200).send({ ok: false, erro: (e as Error).message })
      }
    }

    // 5a-bis. checkout.session.completed → captura CPF do custom_field
    //                                       e guarda em stripe_customer_doc
    if (isEventoCapturarDoc(event.type)) {
      const session = event.data.object as unknown as StripeCheckoutSessionLike
      const customerId = extrairCustomerId(session)
      const docs = extrairCpfCnpjDeCheckout(session)
      if (!customerId) {
        await supabase
          .from('webhook_events')
          .update({
            status: 'ignorado',
            erro: 'Checkout sem customer_id — sem como mapear pro invoice depois',
            processado_em: new Date().toISOString(),
          })
          .eq('id', evento.id)
        return reply.status(200).send({ ok: true, ignored: true, motivo: 'sem customer_id' })
      }
      if (!docs.cpf && !docs.cnpj) {
        await supabase
          .from('webhook_events')
          .update({
            status: 'ignorado',
            erro: 'Checkout sem CPF/CNPJ no custom_fields/tax_ids/metadata',
            processado_em: new Date().toISOString(),
          })
          .eq('id', evento.id)
        return reply.status(200).send({ ok: true, ignored: true, motivo: 'sem CPF/CNPJ no checkout' })
      }
      // Upsert na tabela de mapping — se o mesmo customer já tinha CPF, atualiza.
      const { error: upErr } = await supabase
        .from('stripe_customer_doc')
        .upsert(
          {
            empresa_id: empresaId,
            stripe_customer_id: customerId,
            cpf: docs.cpf || null,
            cnpj: docs.cnpj || null,
            nome: docs.nome || null,
            email: docs.email || null,
            fonte: docs.fonte || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'empresa_id,stripe_customer_id' }
        )
      if (upErr) {
        await marcarEventoErro(evento.id, `Erro ao salvar doc: ${upErr.message}`)
        return reply.status(200).send({ ok: false, erro: upErr.message })
      }
      await supabase
        .from('webhook_events')
        .update({
          status: 'processado',
          erro: null,
          processado_em: new Date().toISOString(),
        })
        .eq('id', evento.id)

      // Race de eventos: se a cobrança desse customer JÁ chegou e falhou por
      // "sem CPF" (invoice processado antes deste checkout gravar o doc),
      // reemite a NFS-e agora que o CPF está salvo — fecha o race sozinho.
      let reemitido: { tentadas: number; emitidas: number } | undefined
      try {
        reemitido = await reemitirPendentesDoCustomer(empresaId, customerId)
      } catch (e) {
        app.log.error({ err: e }, 'Falha na auto-reemissão pós-checkout Stripe')
      }

      return reply.status(200).send({
        ok: true,
        captured: true,
        customer_id: customerId,
        documento: docs.cpf ? `CPF ${docs.cpf}` : `CNPJ ${docs.cnpj}`,
        fonte: docs.fonte,
        reemitido,
      })
    }

    // 5b. Eventos só pra registrar
    if (isEventoRegistrar(event.type)) {
      await supabase
        .from('webhook_events')
        .update({ status: 'ignorado', processado_em: new Date().toISOString() })
        .eq('id', evento.id)
      return reply.status(200).send({ ok: true, ignored: true, type: event.type })
    }

    // 5c. Outros eventos
    await supabase
      .from('webhook_events')
      .update({ status: 'ignorado', processado_em: new Date().toISOString() })
      .eq('id', evento.id)
    return reply.status(200).send({ ok: true, ignored: true, type: event.type })
  })
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
