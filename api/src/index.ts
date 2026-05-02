import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import { config } from './config.js'
import { healthRoutes } from './routes/health.js'
import { certificadoRoutes } from './routes/certificado.js'
import { nfeRoutes } from './routes/nfe.js'
import { adminEmpresasRoutes } from './routes/adminEmpresas.js'
import { adminNotasRoutes } from './routes/adminNotas.js'

async function main() {
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

  // Rotas públicas (sem auth)
  await app.register(healthRoutes, { prefix: '/v1' })

  // Rotas do cliente (auth: API key)
  await app.register(certificadoRoutes, { prefix: '/v1' })
  await app.register(nfeRoutes, { prefix: '/v1' })

  // Rotas admin (auth: JWT Supabase Auth)
  await app.register(adminEmpresasRoutes, { prefix: '/admin' })
  await app.register(adminNotasRoutes, { prefix: '/admin' })

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' })
    app.log.info(`🚀 NFe API rodando em http://localhost:${config.port}/v1/health`)
    app.log.info(`📜 Ambiente SEFAZ: ${config.nfe.ambiente === 1 ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO'} (${config.nfe.uf})`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

main()
