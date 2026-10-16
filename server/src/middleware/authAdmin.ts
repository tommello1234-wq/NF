import { FastifyRequest, FastifyReply } from 'fastify'
import { supabase } from '../services/supabase.js'
import { carregarEmpresasPermitidas, verificarEscopoEmpresa } from './escopoEmpresa.js'

declare module 'fastify' {
  interface FastifyRequest {
    adminUserId?: string
    adminEmail?: string
    /** Empresas que esta conta pode ver/alterar (usuario_empresas). */
    empresasPermitidas?: Set<string>
  }
}

/**
 * preHandler para rotas /admin/*.
 *
 * 1. Valida o JWT do Supabase Auth do projeto NFe.
 * 2. Confere se a requisição só toca empresas vinculadas à conta
 *    (usuario_empresas) — ver escopoEmpresa.ts. Estar logado já não basta:
 *    antes, qualquer conta lia e alterava os dados de qualquer empresa.
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

  let permitidas: Set<string>
  try {
    permitidas = await carregarEmpresasPermitidas(data.user.id)
  } catch (e) {
    req.log.error({ err: e }, 'Falha ao carregar empresas do usuário')
    return reply.status(503).send({ error: 'Não foi possível conferir seus acessos — tente de novo' })
  }
  req.empresasPermitidas = permitidas

  const recusa = await verificarEscopoEmpresa(req, permitidas)
  if (recusa) return reply.status(recusa.status).send({ error: recusa.error })
}
