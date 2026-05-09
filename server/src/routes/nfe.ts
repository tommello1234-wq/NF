import { FastifyInstance } from 'fastify'
import { authApiKey } from '../middleware/authApiKey.js'

/**
 * Placeholder — implementação real na Fase 2 (NFC-e) e Fase 3 (NF-e).
 */
export async function nfeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authApiKey)

  app.post('/nfe', async (_req, reply) => {
    return reply.status(501).send({
      error: 'Emissão de NF-e ainda não implementada',
      message: 'Esta rota será ativada na Fase 2 do roadmap.',
    })
  })

  app.post('/nfce', async (_req, reply) => {
    return reply.status(501).send({
      error: 'Emissão de NFC-e ainda não implementada',
      message: 'Esta rota será ativada na Fase 2 do roadmap.',
    })
  })
}
