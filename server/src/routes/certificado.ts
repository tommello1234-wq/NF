import { FastifyInstance } from 'fastify'
import {
  lerMetadadosPfx,
  salvarCertificado,
  statusCertificado,
  removerCertificado,
} from '../services/certificado.js'
import { authApiKey } from '../middleware/authApiKey.js'

/**
 * Rotas de certificado para uso dos CLIENTES da API (ex: sistema da ótica).
 * Autenticação via Bearer API key → resolve empresa_id.
 */
export async function certificadoRoutes(app: FastifyInstance) {
  // Aplica o auth em TODAS as rotas deste módulo
  app.addHook('preHandler', authApiKey)

  /** GET /v1/certificado — status do certificado da empresa autenticada */
  app.get('/certificado', async (req, reply) => {
    const empresaId = req.empresaId!
    const info = await statusCertificado(empresaId)
    if (!info) return reply.status(404).send({ error: 'Certificado não cadastrado' })
    return info
  })

  /** POST /v1/certificado — upload do PFX (multipart/form-data) */
  app.post('/certificado', async (req, reply) => {
    const empresaId = req.empresaId!
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

    if (!pfxBuffer) return reply.status(400).send({ error: 'Arquivo PFX obrigatório (campo "pfx")' })
    if (!senha) return reply.status(400).send({ error: 'Senha do certificado obrigatória (campo "senha")' })

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

  /** DELETE /v1/certificado */
  app.delete('/certificado', async (req, reply) => {
    await removerCertificado(req.empresaId!)
    return reply.status(204).send()
  })
}
