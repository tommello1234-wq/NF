import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '../services/supabase.js'
import { authAdmin } from '../middleware/authAdmin.js'
import { emitirNfe } from '../services/nfe/orquestrador.js'
import type { NfeInput } from '../services/nfe/types.js'

/**
 * Rotas de admin pra NF-e/NFC-e — usadas pelo painel admin/.
 *
 * ⚠️ ESQUELETO DE TESTE.
 */

const itemSchema = z.object({
  produto_id: z.string().uuid(),
  quantidade: z.coerce.number().positive(),
  valor_unitario: z.coerce.number().positive().optional(),
  valor_desconto: z.coerce.number().nonnegative().optional(),
})

const emitirSchema = z.object({
  empresa_id: z.string().uuid(),
  modelo: z.union([z.literal(55), z.literal(65)]),
  natureza_operacao_id: z.string().uuid(),
  cliente_id: z.string().uuid().optional().nullable(),
  itens: z.array(itemSchema).min(1),
  pagamento: z.object({
    forma: z.string(),
    valor: z.coerce.number().positive(),
    troco: z.coerce.number().nonnegative().optional(),
  }),
  informacoes_complementares: z.string().max(5000).optional().nullable(),
})

export async function adminNfeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authAdmin)

  /** GET /admin/nfe?empresa_id=X&modelo=55|65&status=Y */
  app.get('/nfe', async (req, reply) => {
    const { empresa_id, modelo, status, ambiente } = req.query as {
      empresa_id?: string
      modelo?: string
      status?: string
      ambiente?: string
    }
    let q = supabase
      .from('notas_fiscais')
      .select('*, empresas(nome, razao_social, cnpj)')
      .in('tipo', ['nfe', 'nfce'])
      .order('created_at', { ascending: false })
    if (empresa_id) q = q.eq('empresa_id', empresa_id)
    if (modelo) q = q.eq('modelo', Number(modelo))
    if (status) q = q.eq('status', status)
    if (ambiente) q = q.eq('ambiente_nfe', Number(ambiente))
    const { data, error } = await q
    if (error) return reply.status(500).send({ error: error.message })
    return data || []
  })

  /** GET /admin/nfe/:id */
  app.get<{ Params: { id: string } }>('/nfe/:id', async (req, reply) => {
    const { data, error } = await supabase
      .from('notas_fiscais')
      .select('*, empresas(nome, razao_social, cnpj), notas_fiscais_itens(*)')
      .eq('id', req.params.id)
      .in('tipo', ['nfe', 'nfce'])
      .maybeSingle()
    if (error) return reply.status(500).send({ error: error.message })
    if (!data) return reply.status(404).send({ error: 'Nota não encontrada' })
    return data
  })

  /** POST /admin/nfe/emitir */
  app.post('/nfe/emitir', async (req, reply) => {
    const parsed = emitirSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }
    const body = parsed.data

    try {
      const input: NfeInput = {
        empresaId: body.empresa_id,
        modelo: body.modelo,
        naturezaOperacaoId: body.natureza_operacao_id,
        clienteId: body.cliente_id || undefined,
        itens: body.itens.map((i) => ({
          produtoId: i.produto_id,
          quantidade: i.quantidade,
          valorUnitario: i.valor_unitario,
          valorDesconto: i.valor_desconto,
        })),
        pagamento: {
          forma: body.pagamento.forma as NfeInput['pagamento']['forma'],
          valor: body.pagamento.valor,
          troco: body.pagamento.troco,
        },
        informacoesComplementares: body.informacoes_complementares || undefined,
      }
      const result = await emitirNfe(input)
      return reply.status(result.status === 'autorizada' ? 200 : 422).send(result)
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message })
    }
  })

  /** POST /admin/nfe/:id/cancelar — TODO */
  app.post<{ Params: { id: string }; Body: { justificativa: string } }>(
    '/nfe/:id/cancelar',
    async (_req, reply) => {
      return reply.status(501).send({
        error: 'Cancelamento ainda não implementado',
        message: 'Endpoint preparado — falta plugar fluxo de evento.',
      })
    },
  )

  /** POST /admin/nfe/inutilizar — TODO */
  app.post('/nfe/inutilizar', async (_req, reply) => {
    return reply.status(501).send({
      error: 'Inutilização ainda não implementada',
      message: 'Endpoint preparado — falta plugar fluxo NfeInutilizacao4.',
    })
  })
}
