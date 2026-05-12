/**
 * Endpoints do audit log — listagem e reversão.
 *
 *   GET /admin/audit-log?empresa_id=X&entidade=produto[&limit=200]
 *   POST /admin/audit-log/:id/reverter
 */

import { FastifyInstance } from 'fastify'
import { supabase } from '../services/supabase.js'
import { authAdmin } from '../middleware/authAdmin.js'
import { reverterAcao } from '../services/auditLog.js'

export async function adminAuditLogRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authAdmin)

  /** GET /admin/audit-log?empresa_id=...&entidade=produto|cliente&limit=N */
  app.get('/audit-log', async (req, reply) => {
    const { empresa_id, entidade, limit, busca } = req.query as {
      empresa_id?: string
      entidade?: string
      limit?: string
      busca?: string
    }
    if (!empresa_id) return reply.status(400).send({ error: 'empresa_id obrigatório' })

    let q = supabase
      .from('audit_log')
      .select('*')
      .eq('empresa_id', empresa_id)
      .order('created_at', { ascending: false })
      .limit(Math.min(Number(limit || 500), 2000))

    if (entidade) q = q.eq('entidade', entidade)
    if (busca) q = q.ilike('descricao', `%${busca}%`)

    const { data, error } = await q
    if (error) {
      // Tabela ainda não existe (migration 020 pendente)
      if (/relation "audit_log" does not exist|Could not find the .*table/i.test(error.message)) {
        return []
      }
      return reply.status(500).send({ error: error.message })
    }
    return data || []
  })

  /** POST /admin/audit-log/:id/reverter */
  app.post<{ Params: { id: string } }>('/audit-log/:id/reverter', async (req, reply) => {
    const res = await reverterAcao(req.params.id)
    if (!res.ok) return reply.status(400).send({ error: res.error })
    return res
  })
}
