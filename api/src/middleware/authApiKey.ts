import { FastifyRequest, FastifyReply } from 'fastify'
import { validarApiKey } from '../services/apiKeys.js'

declare module 'fastify' {
  interface FastifyRequest {
    empresaId?: string
  }
}

/**
 * preHandler que valida `Authorization: Bearer <api_key>`.
 * Se válido, preenche req.empresaId e segue.
 * Se inválido, responde 401.
 */
export async function authApiKey(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    return reply.status(401).send({ error: 'Authorization Bearer obrigatório' })
  }

  const empresaId = await validarApiKey(match[1].trim())
  if (!empresaId) {
    return reply.status(401).send({ error: 'API key inválida ou revogada' })
  }

  req.empresaId = empresaId
}
