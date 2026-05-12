import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '../services/supabase.js'
import { authAdmin } from '../middleware/authAdmin.js'
import { encryptSecret } from '../services/crypto-utils.js'

const mapeamentoSchema = z.object({
  empresa_id: z.string().uuid(),
  ticto_product_id: z.string().min(1),
  produto_id: z.string().uuid(),
  valor_unitario_override: z.coerce.number().nonnegative().optional().nullable(),
  ativo: z.boolean().optional(),
})

export async function adminTictoRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authAdmin)

  // ============ Token webhook por empresa ============

  /** PUT /admin/empresas/:empresaId/ticto-token { token } */
  app.put<{ Params: { empresaId: string }; Body: { token?: string } }>(
    '/empresas/:empresaId/ticto-token',
    async (req, reply) => {
      const token = (req.body?.token || '').trim()
      if (!token) {
        // Limpa o token (desabilita)
        const { error } = await supabase
          .from('empresas')
          .update({ ticto_webhook_token_cifrado: null, updated_at: new Date().toISOString() })
          .eq('id', req.params.empresaId)
        if (error) return reply.status(500).send({ error: error.message })
        return { ok: true, configurado: false }
      }
      const cif = encryptSecret(token)
      const { error } = await supabase
        .from('empresas')
        .update({ ticto_webhook_token_cifrado: cif, updated_at: new Date().toISOString() })
        .eq('id', req.params.empresaId)
      if (error) return reply.status(500).send({ error: error.message })
      return { ok: true, configurado: true }
    }
  )

  /** GET /admin/empresas/:empresaId/ticto-config — retorna se token está configurado e a URL do webhook */
  app.get<{ Params: { empresaId: string } }>('/empresas/:empresaId/ticto-config', async (req, reply) => {
    const { data: empresa } = await supabase
      .from('empresas')
      .select('id, nome, ticto_webhook_token_cifrado')
      .eq('id', req.params.empresaId)
      .maybeSingle()
    if (!empresa) return reply.status(404).send({ error: 'Empresa não encontrada' })
    return {
      empresa_id: empresa.id,
      empresa_nome: empresa.nome,
      token_configurado: !!empresa.ticto_webhook_token_cifrado,
      webhook_path: `/webhooks/ticto/${empresa.id}`,
    }
  })

  // ============ Mapeamento ticto_product_id → produto_id ============

  /** GET /admin/ticto-mapeamento?empresa_id=X */
  app.get('/ticto-mapeamento', async (req, reply) => {
    const { empresa_id } = req.query as { empresa_id?: string }
    let q = supabase
      .from('ticto_mapeamento')
      .select('*, produtos(id, descricao, codigo_lc116, aliquota_iss, ativo)')
      .order('created_at', { ascending: false })
    if (empresa_id) q = q.eq('empresa_id', empresa_id)
    const { data, error } = await q
    if (error) return reply.status(500).send({ error: error.message })
    return data || []
  })

  /** POST /admin/ticto-mapeamento */
  app.post('/ticto-mapeamento', async (req, reply) => {
    const parsed = mapeamentoSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }
    const { data, error } = await supabase
      .from('ticto_mapeamento')
      .insert(parsed.data)
      .select()
      .single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })

  /** PATCH /admin/ticto-mapeamento/:id */
  app.patch<{ Params: { id: string } }>('/ticto-mapeamento/:id', async (req, reply) => {
    const parsed = mapeamentoSchema.partial().safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }
    const { data, error } = await supabase
      .from('ticto_mapeamento')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  /** DELETE /admin/ticto-mapeamento/:id */
  app.delete<{ Params: { id: string } }>('/ticto-mapeamento/:id', async (req, reply) => {
    const { error } = await supabase.from('ticto_mapeamento').delete().eq('id', req.params.id)
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(204).send()
  })

  // ============ Histórico de eventos recebidos ============

  /** GET /admin/webhook-events?empresa_id=X&provider=ticto */
  app.get('/webhook-events', async (req, reply) => {
    const { empresa_id, provider, status } = req.query as {
      empresa_id?: string
      provider?: string
      status?: string
    }
    let q = supabase
      .from('webhook_events')
      .select('id, provider, external_id, event_type, status, erro, recebido_em, processado_em, nota_fiscal_id, payload')
      .order('recebido_em', { ascending: false })
      .limit(200)
    if (empresa_id) q = q.eq('empresa_id', empresa_id)
    if (provider) q = q.eq('provider', provider)
    if (status) q = q.eq('status', status)
    const { data, error } = await q
    if (error) return reply.status(500).send({ error: error.message })
    return data || []
  })
}
