import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '../services/supabase.js'
import { authAdmin } from '../middleware/authAdmin.js'
import { encryptSecret } from '../services/crypto-utils.js'

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
}
