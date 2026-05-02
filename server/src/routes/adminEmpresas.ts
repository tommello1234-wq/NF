import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '../services/supabase.js'
import { authAdmin } from '../middleware/authAdmin.js'
import { criarApiKey, listarApiKeys, revogarApiKey } from '../services/apiKeys.js'
import {
  lerMetadadosPfx,
  salvarCertificado,
  statusCertificado,
  removerCertificado,
} from '../services/certificado.js'

const empresaSchema = z.object({
  nome: z.string().min(1),
  razao_social: z.string().min(1),
  cnpj: z.string().min(14),
  ie: z.string().optional().nullable(),
  im: z.string().optional().nullable(),
  regime_tributario: z.enum(['simples', 'mei', 'lucro_presumido', 'lucro_real']).optional().nullable(),
  crt: z.number().int().min(1).max(4).optional().nullable(),
  endereco_logradouro: z.string().optional().nullable(),
  endereco_numero: z.string().optional().nullable(),
  endereco_bairro: z.string().optional().nullable(),
  endereco_cidade: z.string().optional().nullable(),
  endereco_uf: z.string().length(2).optional().nullable(),
  endereco_cep: z.string().optional().nullable(),
  endereco_codigo_ibge: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  telefone: z.string().optional().nullable(),
  ambiente_sefaz: z.number().int().min(1).max(2).optional(),
  uf_sefaz: z.string().length(2).optional(),
  csc_id: z.string().optional().nullable(),
  csc_token: z.string().optional().nullable(),
})

/**
 * Rotas /admin/* — painel administrativo do SaaS.
 * Auth: JWT Supabase Auth (qualquer usuário logado é admin por ora).
 */
export async function adminEmpresasRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authAdmin)

  /** GET /admin/empresas — lista todas */
  app.get('/empresas', async () => {
    const { data } = await supabase
      .from('empresas')
      .select('*')
      .order('nome')
    return data || []
  })

  /** GET /admin/empresas/:id */
  app.get<{ Params: { id: string } }>('/empresas/:id', async (req, reply) => {
    const { data } = await supabase
      .from('empresas')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle()
    if (!data) return reply.status(404).send({ error: 'Empresa não encontrada' })
    return data
  })

  /** POST /admin/empresas — cria */
  app.post('/empresas', async (req, reply) => {
    const parsed = empresaSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }
    const { data, error } = await supabase
      .from('empresas')
      .insert(parsed.data)
      .select()
      .single()
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  /** PATCH /admin/empresas/:id — atualiza */
  app.patch<{ Params: { id: string } }>('/empresas/:id', async (req, reply) => {
    const parsed = empresaSchema.partial().safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }
    const { data, error } = await supabase
      .from('empresas')
      .update(parsed.data)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  /** DELETE /admin/empresas/:id */
  app.delete<{ Params: { id: string } }>('/empresas/:id', async (req, reply) => {
    const { error } = await supabase.from('empresas').delete().eq('id', req.params.id)
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(204).send()
  })

  /* ---------------- API Keys ---------------- */

  /** GET /admin/empresas/:id/api-keys */
  app.get<{ Params: { id: string } }>('/empresas/:id/api-keys', async (req) => {
    return listarApiKeys(req.params.id)
  })

  /** POST /admin/empresas/:id/api-keys — gera nova chave (plaintext retornado 1 vez) */
  app.post<{ Params: { id: string }; Body: { nome?: string; env?: 'live' | 'test' } }>(
    '/empresas/:id/api-keys',
    async (req, reply) => {
      const nome = req.body?.nome || 'API Key'
      const env = req.body?.env || 'live'
      try {
        const result = await criarApiKey(req.params.id, nome, env)
        return reply.status(201).send(result)
      } catch (err) {
        return reply.status(500).send({ error: (err as Error).message })
      }
    }
  )

  /** DELETE /admin/api-keys/:id — revoga (soft delete) */
  app.delete<{ Params: { id: string } }>('/api-keys/:id', async (req, reply) => {
    try {
      await revogarApiKey(req.params.id)
      return reply.status(204).send()
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message })
    }
  })

  /* ---------------- Certificado pelo admin ---------------- */

  /** GET /admin/empresas/:id/certificado */
  app.get<{ Params: { id: string } }>('/empresas/:id/certificado', async (req, reply) => {
    const info = await statusCertificado(req.params.id)
    if (!info) return reply.status(404).send({ error: 'Certificado não cadastrado' })
    return info
  })

  /** POST /admin/empresas/:id/certificado — upload */
  app.post<{ Params: { id: string } }>('/empresas/:id/certificado', async (req, reply) => {
    const empresaId = req.params.id
    const parts = req.parts()
    let pfxBuffer: Buffer | null = null
    let senha: string | null = null

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'pfx') {
        pfxBuffer = await part.toBuffer()
      } else if (part.type === 'field' && part.fieldname === 'senha') {
        senha = part.value as string
      }
    }

    if (!pfxBuffer) return reply.status(400).send({ error: 'Arquivo PFX obrigatório' })
    if (!senha) return reply.status(400).send({ error: 'Senha obrigatória' })

    const info = lerMetadadosPfx(pfxBuffer, senha)
    if (!info) return reply.status(400).send({ error: 'Senha incorreta ou arquivo PFX inválido' })
    if (info.validoAte < new Date()) return reply.status(400).send({ error: 'Certificado vencido' })

    try {
      await salvarCertificado({ empresaId, pfxBuffer, senha, info })
      return {
        ok: true,
        certificado: {
          cnpj: info.cnpj,
          razaoSocial: info.razaoSocial,
          validoAte: info.validoAte.toISOString(),
          serialNumber: info.serialNumber,
        },
      }
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message })
    }
  })

  /** DELETE /admin/empresas/:id/certificado */
  app.delete<{ Params: { id: string } }>('/empresas/:id/certificado', async (req, reply) => {
    await removerCertificado(req.params.id)
    return reply.status(204).send()
  })
}
