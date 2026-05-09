import { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { authApiKey } from '../middleware/authApiKey.js'
import { emitirNfe } from '../services/nfe/orquestrador.js'
import type { NfeInput, Modelo } from '../services/nfe/types.js'

/**
 * Rotas públicas (autenticadas por API key) de NF-e e NFC-e — Fase 4.
 *
 * ⚠️ ESQUELETO DE TESTE — chamada real de SEFAZ ainda não validada em
 * produção. Use ambiente=2 (homologação) até confirmar.
 */

const itemSchema = z.object({
  produto_id: z.string().uuid(),
  quantidade: z.coerce.number().positive(),
  valor_unitario: z.coerce.number().positive().optional(),
  valor_desconto: z.coerce.number().nonnegative().optional(),
  cfop: z.string().regex(/^\d{4}$/).optional(),
  info_adicional: z.string().max(500).optional(),
})

const pagamentoSchema = z.object({
  forma: z.enum([
    '01', '02', '03', '04', '05', '10', '11', '12', '13', '15', '17', '18', '19', '90', '99',
  ]),
  valor: z.coerce.number().positive(),
  troco: z.coerce.number().nonnegative().optional(),
  cnpj_credenciadora: z.string().optional(),
  bandeira: z.string().optional(),
  autorizacao: z.string().optional(),
})

const destinatarioOverrideSchema = z.object({
  cpf: z.string().optional(),
  cnpj: z.string().optional(),
  nome: z.string().min(1),
  email: z.string().email().optional(),
  inscricao_estadual: z.string().optional(),
  indicador_ie: z.union([z.literal(1), z.literal(2), z.literal(9)]).optional(),
  endereco: z
    .object({
      logradouro: z.string().min(1),
      numero: z.string().min(1),
      bairro: z.string().min(1),
      municipio: z.string().min(1),
      codigo_municipio: z.string().regex(/^\d{7}$/),
      uf: z.string().length(2),
      cep: z.string().regex(/^\d{8}$/),
      complemento: z.string().optional(),
    })
    .optional(),
})

const emitirSchema = z.object({
  empresa_id: z.string().uuid(),
  natureza_operacao_id: z.string().uuid(),
  cliente_id: z.string().uuid().optional(),
  destinatario: destinatarioOverrideSchema.optional(),
  itens: z.array(itemSchema).min(1),
  pagamento: pagamentoSchema,
  frete: z
    .object({
      modalidade: z.union([
        z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(9),
      ]),
      valor_frete: z.coerce.number().nonnegative().optional(),
      valor_seguro: z.coerce.number().nonnegative().optional(),
    })
    .optional(),
  informacoes_complementares: z.string().max(5000).optional(),
})

export async function nfeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authApiKey)

  /** POST /v1/nfe — emite NF-e modelo 55 */
  app.post('/nfe', async (req, reply) => {
    const parsed = emitirSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }
    return emitir(parsed.data, 55, reply)
  })

  /** POST /v1/nfce — emite NFC-e modelo 65 */
  app.post('/nfce', async (req, reply) => {
    const parsed = emitirSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }
    return emitir(parsed.data, 65, reply)
  })

  /** POST /v1/nfe/:id/cancelar — TODO Fase 4.1 */
  app.post<{ Params: { id: string } }>('/nfe/:id/cancelar', async (_req, reply) => {
    return reply.status(501).send({
      error: 'Cancelamento ainda não implementado',
      message: 'Endpoint preparado — falta plugar fluxo de evento (RecepcaoEvento4).',
    })
  })

  /** POST /v1/nfe/inutilizar — TODO Fase 4.1 */
  app.post('/nfe/inutilizar', async (_req, reply) => {
    return reply.status(501).send({
      error: 'Inutilização ainda não implementada',
      message: 'Endpoint preparado — falta plugar fluxo NfeInutilizacao4.',
    })
  })
}

async function emitir(
  body: z.infer<typeof emitirSchema>,
  modelo: Modelo,
  reply: FastifyReply,
) {
  try {
    const input: NfeInput = {
      empresaId: body.empresa_id,
      modelo,
      naturezaOperacaoId: body.natureza_operacao_id,
      clienteId: body.cliente_id,
      destinatarioOverride: body.destinatario
        ? {
            cpf: body.destinatario.cpf,
            cnpj: body.destinatario.cnpj,
            nome: body.destinatario.nome,
            email: body.destinatario.email,
            inscricaoEstadual: body.destinatario.inscricao_estadual,
            indicadorIe: body.destinatario.indicador_ie,
            endereco: body.destinatario.endereco
              ? {
                  logradouro: body.destinatario.endereco.logradouro,
                  numero: body.destinatario.endereco.numero,
                  bairro: body.destinatario.endereco.bairro,
                  municipio: body.destinatario.endereco.municipio,
                  codigoMunicipio: body.destinatario.endereco.codigo_municipio,
                  uf: body.destinatario.endereco.uf,
                  cep: body.destinatario.endereco.cep,
                  complemento: body.destinatario.endereco.complemento,
                }
              : undefined,
          }
        : undefined,
      itens: body.itens.map((i) => ({
        produtoId: i.produto_id,
        quantidade: i.quantidade,
        valorUnitario: i.valor_unitario,
        valorDesconto: i.valor_desconto,
        cfop: i.cfop,
        infoAdicional: i.info_adicional,
      })),
      pagamento: {
        forma: body.pagamento.forma,
        valor: body.pagamento.valor,
        troco: body.pagamento.troco,
        cnpjCredenciadora: body.pagamento.cnpj_credenciadora,
        bandeira: body.pagamento.bandeira,
        autorizacao: body.pagamento.autorizacao,
      },
      frete: body.frete
        ? {
            modalidade: body.frete.modalidade,
            valorFrete: body.frete.valor_frete,
            valorSeguro: body.frete.valor_seguro,
          }
        : undefined,
      informacoesComplementares: body.informacoes_complementares,
    }
    const result = await emitirNfe(input)
    return reply.status(result.status === 'autorizada' ? 200 : 422).send(result)
  } catch (e) {
    return reply.status(500).send({ error: (e as Error).message })
  }
}
