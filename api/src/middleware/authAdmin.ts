import { FastifyRequest, FastifyReply } from 'fastify'
import { supabase } from '../services/supabase.js'

declare module 'fastify' {
  interface FastifyRequest {
    adminUserId?: string
    adminEmail?: string
  }
}

/**
 * preHandler para rotas /admin/*.
 * Valida JWT do Supabase Auth do próprio projeto NFe.
 * Qualquer usuário autenticado do projeto é admin por ora (simplicidade).
 * Futuramente podemos olhar role específica.
 */
export async function authAdmin(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    return reply.status(401).send({ error: 'JWT Bearer obrigatório' })
  }

  const token = match[1].trim()
  const { data, error } = await supabase.auth.getUser(token)

  if (error || !data.user) {
    return reply.status(401).send({ error: 'Token inválido ou expirado' })
  }

  req.adminUserId = data.user.id
  req.adminEmail = data.user.email
}
