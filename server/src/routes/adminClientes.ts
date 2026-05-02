import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '../services/supabase.js'
import { authAdmin } from '../middleware/authAdmin.js'

const clienteSchema = z.object({
  empresa_id: z.string().uuid(),
  nome: z.string().min(1),
  cpf_cnpj: z.string().min(3),
  ie: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  telefone: z.string().optional().nullable(),
  endereco_logradouro: z.string().optional().nullable(),
  endereco_numero: z.string().optional().nullable(),
  endereco_bairro: z.string().optional().nullable(),
  endereco_cidade: z.string().optional().nullable(),
  endereco_uf: z.string().length(2).optional().nullable(),
  endereco_cep: z.string().optional().nullable(),
  endereco_codigo_ibge: z.string().optional().nullable(),
  ativo: z.boolean().optional(),
})

export async function adminClientesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authAdmin)

  /** GET /admin/clientes?empresa_id=... */
  app.get('/clientes', async (req, reply) => {
    const { empresa_id, ativo } = req.query as { empresa_id?: string; ativo?: string }

    let query = supabase
      .from('clientes')
      .select('*')
      .order('nome')

    if (empresa_id) query = query.eq('empresa_id', empresa_id)
    if (ativo !== undefined) query = query.eq('ativo', ativo !== 'false')

    const { data, error } = await query
    if (error) return reply.status(500).send({ error: error.message })
    return data || []
  })

  /** GET /admin/clientes/:id */
  app.get<{ Params: { id: string } }>('/clientes/:id', async (req, reply) => {
    const { data } = await supabase
      .from('clientes')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle()
    if (!data) return reply.status(404).send({ error: 'Cliente não encontrado' })
    return data
  })

  /** POST /admin/clientes */
  app.post('/clientes', async (req, reply) => {
    const parsed = clienteSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }
    const payload = {
      ...parsed.data,
      cpf_cnpj: parsed.data.cpf_cnpj.replace(/\D/g, ''),
      email: parsed.data.email || null,
    }
    const { data, error } = await supabase
      .from('clientes')
      .insert(payload)
      .select()
      .single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })

  /** PATCH /admin/clientes/:id */
  app.patch<{ Params: { id: string } }>('/clientes/:id', async (req, reply) => {
    const parsed = clienteSchema.partial().safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }
    const payload: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() }
    if (parsed.data.cpf_cnpj) payload.cpf_cnpj = parsed.data.cpf_cnpj.replace(/\D/g, '')
    if (parsed.data.email === '') payload.email = null

    const { data, error } = await supabase
      .from('clientes')
      .update(payload)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  /** DELETE /admin/clientes/:id */
  app.delete<{ Params: { id: string } }>('/clientes/:id', async (req, reply) => {
    const { error } = await supabase.from('clientes').delete().eq('id', req.params.id)
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(204).send()
  })
}
