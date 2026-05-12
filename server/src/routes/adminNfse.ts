import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '../services/supabase.js'
import { authAdmin } from '../middleware/authAdmin.js'
import { cancelarNfse, emitirNfse } from '../services/nfse/orquestrador.js'

const emitirSchema = z.object({
  empresa_id: z.string().uuid(),
  produto_id: z.string().uuid(),
  cliente_id: z.string().uuid().optional().nullable(),
  tomador: z
    .object({
      cpf: z.string().optional().nullable(),
      cnpj: z.string().optional().nullable(),
      nome: z.string().min(1),
      email: z.string().email().optional().nullable(),
      endereco: z
        .object({
          logradouro: z.string().min(1),
          numero: z.string().min(1),
          bairro: z.string().min(1),
          codigo_municipio: z.string().regex(/^\d{7}$/),
          cep: z.string().min(8),
          complemento: z.string().optional().nullable(),
        })
        .optional()
        .nullable(),
    })
    .optional()
    .nullable(),
  valor_servicos: z.coerce.number().positive(),
  descricao: z.string().min(1).max(2000).optional().nullable(),
  data_competencia: z.string().optional().nullable(), // ISO
})

export async function adminNfseRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authAdmin)

  /** GET /admin/nfse?empresa_id=X */
  app.get('/nfse', async (req, reply) => {
    const { empresa_id, status, ambiente } = req.query as {
      empresa_id?: string
      status?: string
      ambiente?: string
    }
    let q = supabase
      .from('notas_fiscais')
      .select('*, empresas(nome, razao_social, cnpj)')
      .eq('tipo', 'nfse')
      .order('created_at', { ascending: false })
    if (empresa_id) q = q.eq('empresa_id', empresa_id)
    if (status) q = q.eq('status', status)
    if (ambiente) q = q.eq('ambiente_nfse', Number(ambiente))
    const { data, error } = await q
    if (error) return reply.status(500).send({ error: error.message })
    return data || []
  })

  /** GET /admin/nfse/:id */
  app.get<{ Params: { id: string } }>('/nfse/:id', async (req, reply) => {
    const { data, error } = await supabase
      .from('notas_fiscais')
      .select('*, empresas(nome, razao_social, cnpj)')
      .eq('id', req.params.id)
      .eq('tipo', 'nfse')
      .maybeSingle()
    if (error) return reply.status(500).send({ error: error.message })
    if (!data) return reply.status(404).send({ error: 'NFS-e não encontrada' })
    return data
  })

  /** POST /admin/nfse/emitir */
  app.post('/nfse/emitir', async (req, reply) => {
    const parsed = emitirSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }
    const body = parsed.data

    // Pelo menos um deles obrigatório (cliente_id ou tomador override)
    if (!body.cliente_id && !body.tomador) {
      return reply.status(400).send({ error: 'Informe cliente_id OU dados do tomador' })
    }

    try {
      const result = await emitirNfse({
        empresaId: body.empresa_id,
        produtoId: body.produto_id,
        clienteId: body.cliente_id || undefined,
        tomadorOverride: body.tomador
          ? {
              cpf: body.tomador.cpf || undefined,
              cnpj: body.tomador.cnpj || undefined,
              nome: body.tomador.nome,
              email: body.tomador.email || undefined,
              endereco: body.tomador.endereco
                ? {
                    logradouro: body.tomador.endereco.logradouro,
                    numero: body.tomador.endereco.numero,
                    bairro: body.tomador.endereco.bairro,
                    codigoMunicipio: body.tomador.endereco.codigo_municipio,
                    cep: body.tomador.endereco.cep,
                    complemento: body.tomador.endereco.complemento || undefined,
                  }
                : undefined,
            }
          : undefined,
        valorServicos: Number(body.valor_servicos),
        descricao: body.descricao || undefined,
        dataCompetencia: body.data_competencia ? new Date(body.data_competencia) : undefined,
      })
      return reply.status(result.status === 'autorizada' ? 201 : 200).send(result)
    } catch (e) {
      app.log.error({ err: e }, 'Erro ao emitir NFS-e')
      return reply.status(500).send({ error: (e as Error).message })
    }
  })

  /** GET /admin/nfse/:id/xml-dps — download XML DPS assinado */
  app.get<{ Params: { id: string } }>('/nfse/:id/xml-dps', async (req, reply) => {
    const { data: nota } = await supabase
      .from('notas_fiscais')
      .select('xml_dps_path, chave_acesso_nfse, numero_dps')
      .eq('id', req.params.id)
      .maybeSingle()
    if (!nota?.xml_dps_path) return reply.status(404).send({ error: 'XML DPS não disponível' })
    const { data: file, error } = await supabase.storage.from('nfse-xml').download(nota.xml_dps_path)
    if (error || !file) return reply.status(500).send({ error: error?.message || 'Erro download' })
    const buffer = Buffer.from(await file.arrayBuffer())
    reply.header('content-type', 'application/xml')
    reply.header('content-disposition', `attachment; filename="dps-${nota.numero_dps || req.params.id}.xml"`)
    return reply.send(buffer)
  })

  /** POST /admin/nfse/:id/cancelar */
  app.post<{ Params: { id: string }; Body: { codigo_motivo?: string; descricao_motivo?: string } }>(
    '/nfse/:id/cancelar',
    async (req, reply) => {
      const cancelarSchema = z.object({
        codigo_motivo: z.enum(['1', '2', '9']),
        descricao_motivo: z.string().min(15).max(255),
      })
      const parsed = cancelarSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
      }
      try {
        const result = await cancelarNfse({
          notaId: req.params.id,
          codigoMotivo: parsed.data.codigo_motivo,
          descricaoMotivo: parsed.data.descricao_motivo,
        })
        return reply.status(result.status === 'cancelada' ? 200 : 200).send(result)
      } catch (e) {
        app.log.error({ err: e }, 'Erro ao cancelar NFS-e')
        return reply.status(500).send({ error: (e as Error).message })
      }
    }
  )

  /** GET /admin/nfse/:id/xml-nfse — download XML NFS-e (resposta SEFIN) */
  app.get<{ Params: { id: string } }>('/nfse/:id/xml-nfse', async (req, reply) => {
    const { data: nota } = await supabase
      .from('notas_fiscais')
      .select('xml_nfse_path, chave_acesso_nfse')
      .eq('id', req.params.id)
      .maybeSingle()
    if (!nota?.xml_nfse_path) return reply.status(404).send({ error: 'XML NFS-e não disponível' })
    const { data: file, error } = await supabase.storage.from('nfse-xml').download(nota.xml_nfse_path)
    if (error || !file) return reply.status(500).send({ error: error?.message || 'Erro download' })
    const buffer = Buffer.from(await file.arrayBuffer())
    reply.header('content-type', 'application/xml')
    reply.header('content-disposition', `attachment; filename="nfse-${nota.chave_acesso_nfse || req.params.id}.xml"`)
    return reply.send(buffer)
  })
}
