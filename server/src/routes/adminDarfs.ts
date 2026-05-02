import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authAdmin } from '../middleware/authAdmin.js'
import { supabase } from '../services/supabase.js'
import { gerarDarfPdf } from '../services/darf.js'

const datePtBr = /^\d{2}\/\d{2}\/\d{4}$/
const datePtBrSchema = z.string()
  .regex(datePtBr, 'Use DD/MM/AAAA')
  .refine((value) => {
    const [day, month, year] = value.split('/').map(Number)
    const date = new Date(year, month - 1, day)
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
  }, 'Data invalida')

const gerarDarfSchema = z.object({
  empresa_id: z.string().uuid(),
  nome_telefone: z.string().optional().nullable(),
  periodo_apuracao: datePtBrSchema,
  codigo_receita: z.string().regex(/^\d{4}$/, 'Informe 4 digitos'),
  numero_referencia: z.string().max(30).optional().nullable(),
  data_vencimento: datePtBrSchema,
  valor_principal: z.coerce.number().min(0),
  valor_multa: z.coerce.number().min(0).default(0),
  valor_juros: z.coerce.number().min(0).default(0),
})

function digits(value: unknown) {
  return String(value || '').replace(/\D/g, '')
}

function cleanFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-')
}

export async function adminDarfsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authAdmin)

  app.post('/darfs/gerar', async (req, reply) => {
    const parsed = gerarDarfSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload invalido', details: parsed.error.flatten() })
    }

    const body = parsed.data
    const valorTotal = body.valor_principal + body.valor_multa + body.valor_juros
    if (valorTotal < 10) {
      return reply.status(400).send({ error: 'O valor total do DARF comum deve ser igual ou superior a R$ 10,00' })
    }

    const { data: empresa, error } = await supabase
      .from('empresas')
      .select('id, nome, razao_social, cnpj, telefone')
      .eq('id', body.empresa_id)
      .maybeSingle()

    if (error) return reply.status(500).send({ error: error.message })
    if (!empresa) return reply.status(404).send({ error: 'Empresa nao encontrada' })

    const nomeTelefone = body.nome_telefone?.trim()
      || [empresa.razao_social || empresa.nome, empresa.telefone].filter(Boolean).join(' / ')

    const pdf = gerarDarfPdf({
      contribuinteNomeTelefone: nomeTelefone,
      periodoApuracao: body.periodo_apuracao,
      cpfCnpj: digits(empresa.cnpj),
      codigoReceita: body.codigo_receita,
      numeroReferencia: body.numero_referencia,
      dataVencimento: body.data_vencimento,
      valorPrincipal: body.valor_principal,
      valorMulta: body.valor_multa,
      valorJuros: body.valor_juros,
      valorTotal,
    })

    const filename = cleanFilename(`darf-${digits(empresa.cnpj)}-${body.codigo_receita}-${body.periodo_apuracao}.pdf`)
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(pdf)
  })
}
