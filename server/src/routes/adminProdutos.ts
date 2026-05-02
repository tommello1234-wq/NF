import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '../services/supabase.js'
import { authAdmin } from '../middleware/authAdmin.js'

const produtoSchema = z.object({
  empresa_id: z.string().uuid(),
  descricao: z.string().min(1),
  codigo_interno: z.string().optional().nullable(),
  ncm: z.string().optional().nullable(),
  cfop: z.string().optional().nullable(),
  unidade: z.string().default('UN'),
  valor_unitario: z.coerce.number().optional().nullable(),
  origem: z.coerce.number().int().min(0).max(8).default(0),
  cst_csosn: z.string().optional().nullable(),
  aliquota_icms: z.coerce.number().min(0).max(100).optional().nullable(),
  aliquota_pis: z.coerce.number().min(0).max(100).optional().nullable(),
  aliquota_cofins: z.coerce.number().min(0).max(100).optional().nullable(),
  tipo: z.enum(['produto', 'servico']).default('produto'),
  ativo: z.boolean().optional(),
})

function cleanEmptyStrings<T extends Record<string, unknown>>(payload: T) {
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [key, value === '' ? null : value])
  ) as T
}

export async function adminProdutosRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authAdmin)

  /** GET /admin/produtos?empresa_id=...&tipo=... */
  app.get('/produtos', async (req, reply) => {
    const { empresa_id, tipo, ativo } = req.query as {
      empresa_id?: string
      tipo?: string
      ativo?: string
    }

    let query = supabase
      .from('produtos')
      .select('*')
      .order('descricao')

    if (empresa_id) query = query.eq('empresa_id', empresa_id)
    if (tipo) query = query.eq('tipo', tipo)
    if (ativo !== undefined) query = query.eq('ativo', ativo !== 'false')

    const { data, error } = await query
    if (error) return reply.status(500).send({ error: error.message })
    return data || []
  })

  /** GET /admin/produtos/:id */
  app.get<{ Params: { id: string } }>('/produtos/:id', async (req, reply) => {
    const { data } = await supabase
      .from('produtos')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle()
    if (!data) return reply.status(404).send({ error: 'Produto não encontrado' })
    return data
  })

  /** POST /admin/produtos */
  app.post('/produtos', async (req, reply) => {
    const parsed = produtoSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }
    const { data, error } = await supabase
      .from('produtos')
      .insert(cleanEmptyStrings(parsed.data))
      .select()
      .single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })

  /** PATCH /admin/produtos/:id */
  app.patch<{ Params: { id: string } }>('/produtos/:id', async (req, reply) => {
    const parsed = produtoSchema.partial().safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }
    const payload = cleanEmptyStrings({ ...parsed.data, updated_at: new Date().toISOString() })
    const { data, error } = await supabase
      .from('produtos')
      .update(payload)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  /** DELETE /admin/produtos/:id */
  app.delete<{ Params: { id: string } }>('/produtos/:id', async (req, reply) => {
    const { error } = await supabase.from('produtos').delete().eq('id', req.params.id)
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(204).send()
  })
}
