import { FastifyInstance } from 'fastify'
import { config } from '../config.js'

export async function healthRoutes(app: FastifyInstance) {
  /**
   * Health público (sem auth) — só confirma que o serviço está de pé.
   */
  app.get('/health', async () => ({
    status: 'ok',
    environment: config.nodeEnv,
    nfe: {
      ambiente: config.nfe.ambiente === 1 ? 'producao' : 'homologacao',
      uf: config.nfe.uf,
    },
    timestamp: new Date().toISOString(),
  }))
}
