import type { IncomingMessage, ServerResponse } from 'node:http'
import { buildApp } from '../server/src/app.js'

const appPromise = buildApp().then(async (app) => {
  await app.ready()
  return app
})

function stripVercelApiPrefix(req: IncomingMessage) {
  if (!req.url) return

  const url = new URL(req.url, 'http://localhost')

  if (url.pathname === '/api' || url.pathname === '/api/index') {
    url.pathname = '/v1/health'
  } else if (url.pathname.startsWith('/api/')) {
    url.pathname = url.pathname.slice(4) || '/'
  }

  req.url = `${url.pathname}${url.search}`
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await appPromise
  stripVercelApiPrefix(req)
  app.server.emit('request', req, res)
}
