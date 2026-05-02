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

  return app
}
