import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '../services/supabase.js'
import { authAdmin } from '../middleware/authAdmin.js'

const naturezaSchema = z.object({
  empresa_id: z.string().uuid(),
  nome: z.string().min(1),
  natureza: z.string().min(1).default('VENDA DE MERCADORIA'),
  tipo_operacao: z.enum(['entrada', 'saida']).default('saida'),
  finalidade: z.enum(['normal', 'complementar', 'ajuste', 'devolucao']).default('normal'),
  cfop_padrao: z.string().optional().nullable(),
  consumidor_final: z.boolean().default(true),
  indicador_presenca: z.coerce.number().int().min(0).max(9).default(9),
  modalidade_frete: z.coerce.number().int().min(0).max(9).default(9),
  informacoes_adicionais: z.string().optional().nullable(),
  ativo: z.boolean().optional(),
})

function cleanEmptyStrings<T extends Record<string, unknown>>(payload: T) {
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [key, value === '' ? null : value])
  ) as T
}

function digits(value?: string | null) {
  return value ? value.replace(/\D/g, '') : value
}

export async function adminFiscalRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authAdmin)

  app.get('/naturezas-operacao', async (req, reply) => {
    const { empresa_id, ativo } = req.query as { empresa_id?: string; ativo?: string }

    let query = supabase
      .from('naturezas_operacao')
      .select('*')
      .order('nome')

    if (empresa_id) query = query.eq('empresa_id', empresa_id)
    if (ativo !== undefined) query = query.eq('ativo', ativo !== 'false')

    const { data, error } = await query
    if (error) return reply.status(500).send({ error: error.message })
    return data || []
  })

  app.get<{ Params: { id: string } }>('/naturezas-operacao/:id', async (req, reply) => {
    const { data } = await supabase
      .from('naturezas_operacao')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle()
    if (!data) return reply.status(404).send({ error: 'Natureza de operacao nao encontrada' })
    return data
  })

  app.post('/naturezas-operacao', async (req, reply) => {
    const parsed = naturezaSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload invalido', details: parsed.error.flatten() })
    }

    const payload = cleanEmptyStrings({
      ...parsed.data,
      cfop_padrao: digits(parsed.data.cfop_padrao),
    })

    const { data, error } = await supabase
      .from('naturezas_operacao')
      .insert(payload)
      .select()
      .single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })

  app.patch<{ Params: { id: string } }>('/naturezas-operacao/:id', async (req, reply) => {
    const parsed = naturezaSchema.partial().safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload invalido', details: parsed.error.flatten() })
    }

    const payload = cleanEmptyStrings({
      ...parsed.data,
      cfop_padrao: digits(parsed.data.cfop_padrao),
      updated_at: new Date().toISOString(),
    })

    const { data, error } = await supabase
      .from('naturezas_operacao')
      .update(payload)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  app.delete<{ Params: { id: string } }>('/naturezas-operacao/:id', async (req, reply) => {
    const { error } = await supabase.from('naturezas_operacao').delete().eq('id', req.params.id)
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(204).send()
  })
}
