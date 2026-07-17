import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '../services/supabase.js'
import { authAdmin } from '../middleware/authAdmin.js'
import { encryptSecret } from '../services/crypto-utils.js'
import { emitirNfse } from '../services/nfse/orquestrador.js'
import { mapearStripeInvoiceParaEmissao } from '../services/webhooks/stripe-mapper.js'
import {
  extrairCustomerId,
  type StripeInvoiceLike,
} from '../services/webhooks/stripe-types.js'

const mapeamentoSchema = z.object({
  empresa_id: z.string().uuid(),
  stripe_price_id: z.string().min(1),
  produto_id: z.string().uuid(),
  valor_unitario_override: z.coerce.number().nonnegative().optional().nullable(),
  ativo: z.boolean().optional(),
})

export async function adminStripeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authAdmin)

  // ============ Webhook secret por empresa ============

  /** POST /admin/empresas/:empresaId/stripe-secret { secret } */
  app.post<{ Params: { empresaId: string }; Body: { secret?: string } }>(
    '/empresas/:empresaId/stripe-secret',
    async (req, reply) => {
      const secret = (req.body?.secret || '').trim()
      if (!secret) {
        const { error } = await supabase
          .from('empresas')
          .update({ stripe_webhook_secret_cifrado: null, updated_at: new Date().toISOString() })
          .eq('id', req.params.empresaId)
        if (error) return reply.status(500).send({ error: error.message })
        return { ok: true, configurado: false }
      }
      if (!secret.startsWith('whsec_')) {
        return reply.status(400).send({
          error: 'Secret inválido. Stripe endpoint secrets começam com "whsec_"',
        })
      }
      const cif = encryptSecret(secret)
      const { error } = await supabase
        .from('empresas')
        .update({ stripe_webhook_secret_cifrado: cif, updated_at: new Date().toISOString() })
        .eq('id', req.params.empresaId)
      if (error) return reply.status(500).send({ error: error.message })
      return { ok: true, configurado: true }
    }
  )

  /** GET /admin/empresas/:empresaId/stripe-config */
  app.get<{ Params: { empresaId: string } }>('/empresas/:empresaId/stripe-config', async (req, reply) => {
    const { data: empresa } = await supabase
      .from('empresas')
      .select(
        'id, nome, stripe_webhook_secret_cifrado, stripe_produto_default_id, produtos:stripe_produto_default_id(id, descricao, codigo_lc116, aliquota_iss, ativo)'
      )
      .eq('id', req.params.empresaId)
      .maybeSingle()
    if (!empresa) return reply.status(404).send({ error: 'Empresa não encontrada' })
    return {
      empresa_id: empresa.id,
      empresa_nome: empresa.nome,
      secret_configurado: !!empresa.stripe_webhook_secret_cifrado,
      webhook_path: `/webhooks/stripe/${empresa.id}`,
      produto_default_id: empresa.stripe_produto_default_id,
      produto_default: empresa.produtos || null,
    }
  })

  // ============ Produto default (fallback) ============

  /**
   * POST /admin/empresas/:empresaId/stripe-produto-default { produto_id }
   * Aceita produto_id null/vazio pra LIMPAR o default.
   *
   * Esse campo é o que destrava o fluxo "empresa cria payment links na
   * Stripe à vontade sem precisar cadastrar cada price_id no painel".
   * Quando o webhook chega com price_id sem mapeamento explícito, usa
   * esse produto pra emitir a NFS-e.
   */
  app.post<{ Params: { empresaId: string }; Body: { produto_id?: string | null } }>(
    '/empresas/:empresaId/stripe-produto-default',
    async (req, reply) => {
      const produtoId = (req.body?.produto_id || '').trim()
      if (!produtoId) {
        const { error } = await supabase
          .from('empresas')
          .update({ stripe_produto_default_id: null, updated_at: new Date().toISOString() })
          .eq('id', req.params.empresaId)
        if (error) return reply.status(500).send({ error: error.message })
        return { ok: true, configurado: false }
      }
      // Valida que o produto existe e pertence à mesma empresa antes de salvar
      const { data: prod } = await supabase
        .from('produtos')
        .select('id, empresa_id, ativo')
        .eq('id', produtoId)
        .maybeSingle()
      if (!prod) return reply.status(404).send({ error: 'Produto não encontrado' })
      if (prod.empresa_id !== req.params.empresaId) {
        return reply.status(400).send({ error: 'Produto pertence a outra empresa' })
      }
      const { error } = await supabase
        .from('empresas')
        .update({ stripe_produto_default_id: produtoId, updated_at: new Date().toISOString() })
        .eq('id', req.params.empresaId)
      if (error) return reply.status(500).send({ error: error.message })
      return { ok: true, configurado: true, produto_id: produtoId }
    }
  )

  // ============ Mapeamento stripe_price_id → produto_id ============

  /** GET /admin/stripe-mapeamento?empresa_id=X */
  app.get('/stripe-mapeamento', async (req, reply) => {
    const { empresa_id } = req.query as { empresa_id?: string }
    let q = supabase
      .from('stripe_mapeamento')
      .select('*, produtos(id, descricao, codigo_lc116, aliquota_iss, ativo)')
      .order('created_at', { ascending: false })
    if (empresa_id) q = q.eq('empresa_id', empresa_id)
    const { data, error } = await q
    if (error) return reply.status(500).send({ error: error.message })
    return data || []
  })

  /** POST /admin/stripe-mapeamento */
  app.post('/stripe-mapeamento', async (req, reply) => {
    const parsed = mapeamentoSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }
    const { data, error } = await supabase
      .from('stripe_mapeamento')
      .insert(parsed.data)
      .select()
      .single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })

  /** PATCH /admin/stripe-mapeamento/:id */
  app.patch<{ Params: { id: string } }>('/stripe-mapeamento/:id', async (req, reply) => {
    const parsed = mapeamentoSchema.partial().safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }
    const { data, error } = await supabase
      .from('stripe_mapeamento')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  /** DELETE /admin/stripe-mapeamento/:id */
  app.delete<{ Params: { id: string } }>('/stripe-mapeamento/:id', async (req, reply) => {
    const { error } = await supabase.from('stripe_mapeamento').delete().eq('id', req.params.id)
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(204).send()
  })

  // ============ Reprocessar evento Stripe com erro ============

  /**
   * POST /admin/webhook-events/:id/reprocessar
   *
   * Pega o payload já salvo (não chama a Stripe de novo), roda o mapper +
   * resolver de produto (mapeamento explícito → fallback default) e tenta
   * emitir a NFS-e. Útil pra "destravar" eventos que falharam por:
   *   - CPF/CNPJ ausente (agora extraído de custom_fields também)
   *   - Produto default não configurado na época
   *   - Mapeamento price_id criado depois
   */
  app.post<{ Params: { id: string } }>('/webhook-events/:id/reprocessar', async (req, reply) => {
    const { data: evento } = await supabase
      .from('webhook_events')
      .select('id, provider, empresa_id, event_type, payload, status, nota_fiscal_id')
      .eq('id', req.params.id)
      .maybeSingle()
    if (!evento) return reply.status(404).send({ error: 'Evento não encontrado' })
    if (evento.provider !== 'stripe') {
      return reply.status(400).send({ error: 'Reprocessar disponível só pra eventos Stripe' })
    }
    if (evento.status === 'processado' && evento.nota_fiscal_id) {
      return reply.status(400).send({ error: 'Evento já processado com sucesso (nota emitida)' })
    }
    if (evento.event_type !== 'invoice.payment_succeeded') {
      return reply.status(400).send({
        error: `Tipo "${evento.event_type}" não aciona emissão — só invoice.payment_succeeded`,
      })
    }

    const { data: empresa } = await supabase
      .from('empresas')
      .select('id, municipio_emissor_codigo, endereco_codigo_ibge, stripe_produto_default_id')
      .eq('id', evento.empresa_id)
      .maybeSingle()
    if (!empresa) return reply.status(404).send({ error: 'Empresa do evento não encontrada' })

    const cMunFallback = String(
      empresa.municipio_emissor_codigo || empresa.endereco_codigo_ibge || ''
    )
    if (cMunFallback.length !== 7) {
      return reply.status(400).send({ error: 'Empresa sem código IBGE de município emissor' })
    }

    // O payload salvo é o event inteiro — invoice fica em data.object
    const payload = (evento.payload as unknown as { data?: { object?: unknown } }) || {}
    const invoice = (payload.data?.object || {}) as StripeInvoiceLike

    let mapped
    try {
      mapped = mapearStripeInvoiceParaEmissao(invoice, cMunFallback)
    } catch (e) {
      const msg = (e as Error).message
      // Mesmo fallback que o webhook em runtime: busca CPF guardado da
      // checkout.session.completed em stripe_customer_doc antes de desistir.
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
      return reply.status(200).send({ ok: false, erro: msg })
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
      return reply.status(200).send({ ok: true, nota_id: result.notaId, status: result.status })
    } catch (e) {
      await marcarEventoErro(evento.id, (e as Error).message)
      return reply.status(200).send({ ok: false, erro: (e as Error).message })
    }
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
