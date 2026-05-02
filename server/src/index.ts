import { config } from './config.js'
import { buildApp } from './app.js'

async function main() {
  const app = await buildApp()

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' })
    app.log.info(`NFe API rodando em http://localhost:${config.port}/v1/health`)
    app.log.info(`Ambiente SEFAZ: ${config.nfe.ambiente === 1 ? 'PRODUCAO' : 'HOMOLOGACAO'} (${config.nfe.uf})`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

main()
