import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import { config } from './config.js'
import { healthRoutes } from './routes/health.js'
import { certificadoRoutes } from './routes/certificado.js'
import { nfeRoutes } from './routes/nfe.js'
import { adminEmpresasRoutes } from './routes/adminEmpresas.js'
import { adminNotasRoutes } from './routes/adminNotas.js'
import { adminClientesRoutes } from './routes/adminClientes.js'
import { adminProdutosRoutes } from './routes/adminProdutos.js'
import { adminDarfsRoutes } from './routes/adminDarfs.js'
import { adminFiscalRoutes } from './routes/adminFiscal.js'
import { adminNfseRoutes } from './routes/adminNfse.js'
import { adminNfeRoutes } from './routes/adminNfe.js'
import { adminVendasRoutes } from './routes/adminVendas.js'
import { adminAuditLogRoutes } from './routes/adminAuditLog.js'
import { adminTictoRoutes } from './routes/adminTicto.js'
import { webhooksTictoRoutes } from './routes/webhooksTicto.js'
import { adminStripeRoutes } from './routes/adminStripe.js'
import { webhooksStripeRoutes } from './routes/webhooksStripe.js'

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.nodeEnv === 'development' ? 'debug' : 'info',
      transport: config.nodeEnv === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
    bodyLimit: 10 * 1024 * 1024,
  })

  await app.register(cors, {
    origin: true,
    credentials: true,
    // Default do @fastify/cors é só GET/HEAD/POST. Precisamos liberar
    // PUT/PATCH/DELETE pra rotas REST funcionarem no browser (preflight OPTIONS).
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'X-Requested-With'],
  })

  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024,
      files: 1,
    },
  })

  await app.register(healthRoutes, { prefix: '/v1' })
  await app.register(certificadoRoutes, { prefix: '/v1' })
  await app.register(nfeRoutes, { prefix: '/v1' })

  await app.register(adminEmpresasRoutes, { prefix: '/admin' })
  await app.register(adminNotasRoutes, { prefix: '/admin' })
  await app.register(adminClientesRoutes, { prefix: '/admin' })
  await app.register(adminProdutosRoutes, { prefix: '/admin' })
  await app.register(adminDarfsRoutes, { prefix: '/admin' })
  await app.register(adminFiscalRoutes, { prefix: '/admin' })
  await app.register(adminNfseRoutes, { prefix: '/admin' })
  await app.register(adminNfeRoutes, { prefix: '/admin' })
  await app.register(adminVendasRoutes, { prefix: '/admin' })
  await app.register(adminAuditLogRoutes, { prefix: '/admin' })
  await app.register(adminTictoRoutes, { prefix: '/admin' })
  await app.register(adminStripeRoutes, { prefix: '/admin' })

  // Webhooks públicos (sem authAdmin — autenticação via secret cadastrado por empresa)
  await app.register(webhooksTictoRoutes, { prefix: '/webhooks' })
  await app.register(webhooksStripeRoutes, { prefix: '/webhooks' })

  return app
}
