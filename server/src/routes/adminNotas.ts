import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authAdmin } from '../middleware/authAdmin.js'
import { supabase } from '../services/supabase.js'
import { statusCertificado } from '../services/certificado.js'
import { gerarChaveAcesso, gerarDanfeSimples, gerarXmlSimples } from '../services/notaSimples.js'

const emitirSchema = z.object({
  empresa_id: z.string().uuid(),
  tipo: z.enum(['nfe', 'nfce']).default('nfe'),
  serie: z.coerce.number().int().min(1).max(999).optional(),
  natureza_operacao_id: z.string().uuid().optional().nullable(),
  cliente_id: z.string().uuid().optional().nullable(),
  produto_id: z.string().uuid().optional().nullable(),
  destinatario_nome: z.string().min(1),
  destinatario_cpf_cnpj: z.string().min(3),
  descricao: z.string().min(1).max(500),
  quantidade: z.coerce.number().positive().default(1),
  valor_unitario: z.coerce.number().positive().optional(),
  valor_total: z.coerce.number().positive(),
})

const querySchema = z.object({
  empresa_id: z.string().uuid().optional(),
  status: z.string().optional(),
})

function cleanDoc(value: string) {
  return value.replace(/\D/g, '')
}

async function ensureBucket(id: string, mimeTypes: string[]) {
  const { error } = await supabase.storage.createBucket(id, {
    public: false,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: mimeTypes,
  })
  if (error && !error.message.toLowerCase().includes('already exists')) {
    throw new Error(error.message)
  }
}

async function nextNumero(empresa: Record<string, any>, tipo: 'nfe' | 'nfce', serie: number) {
  const configured = tipo === 'nfce' ? empresa.proximo_numero_nfce : empresa.proximo_numero_nfe
  if (configured && Number(configured) > 0) return Number(configured)

  const { data } = await supabase
    .from('notas_fiscais')
    .select('numero')
    .eq('empresa_id', empresa.id)
    .eq('tipo', tipo)
    .eq('serie', serie)
    .order('numero', { ascending: false })
    .limit(1)
    .maybeSingle()

  return Number(data?.numero || 0) + 1
}

async function updateNextNumero(empresaId: string, tipo: 'nfe' | 'nfce', numero: number) {
  const column = tipo === 'nfce' ? 'proximo_numero_nfce' : 'proximo_numero_nfe'
  await supabase
    .from('empresas')
    .update({ [column]: numero + 1 })
    .eq('id', empresaId)
    .then(() => { /* ignore compatibility errors when migration is not applied */ }, () => { /* ignore */ })
}

async function downloadFile(bucket: string, path: string, reply: any, contentType: string, filename: string) {
  const { data, error } = await supabase.storage.from(bucket).download(path)
  if (error || !data) return reply.status(404).send({ error: error?.message || 'Arquivo nao encontrado' })
  const buffer = Buffer.from(await data.arrayBuffer())
  return reply
    .header('Content-Type', contentType)
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .send(buffer)
}

export async function adminNotasRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authAdmin)

  app.get('/notas', async (req, reply) => {
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) return reply.status(400).send({ error: 'Query invalida' })

    let query = supabase
      .from('notas_fiscais')
      .select('*, empresas(nome, razao_social, cnpj)')
      .order('created_at', { ascending: false })

    if (parsed.data.empresa_id) query = query.eq('empresa_id', parsed.data.empresa_id)
    if (parsed.data.status) query = query.eq('status', parsed.data.status)

    const { data, error } = await query
    if (error) return reply.status(500).send({ error: error.message })
    return data || []
  })

  app.post('/notas/emitir-simples', async (req, reply) => {
    const parsed = emitirSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload invalido', details: parsed.error.flatten() })
    }

    let body = parsed.data
    let clienteSelecionado: Record<string, any> | null = null
    let produtoSelecionado: Record<string, any> | null = null
    let naturezaSelecionada: Record<string, any> | null = null
    const [{ data: empresa, error: empresaError }, cert] = await Promise.all([
      supabase.from('empresas').select('*').eq('id', body.empresa_id).maybeSingle(),
      statusCertificado(body.empresa_id),
    ])

    if (empresaError) return reply.status(500).send({ error: empresaError.message })
    if (!empresa) return reply.status(404).send({ error: 'Empresa nao encontrada' })
    if (!cert) return reply.status(400).send({ error: 'Cadastre o certificado digital antes de gerar nota' })
    if (cert.status === 'vencido') return reply.status(400).send({ error: 'Certificado digital vencido' })

    if (body.cliente_id) {
      const { data: cliente, error } = await supabase
        .from('clientes')
        .select('*')
        .eq('id', body.cliente_id)
        .eq('empresa_id', body.empresa_id)
        .maybeSingle()
      if (error) return reply.status(500).send({ error: error.message })
      if (!cliente) return reply.status(404).send({ error: 'Cliente nao encontrado' })
      clienteSelecionado = cliente
      body = {
        ...body,
        destinatario_nome: cliente.nome,
        destinatario_cpf_cnpj: cliente.cpf_cnpj,
      }
    }

    if (body.produto_id) {
      const { data: produto, error } = await supabase
        .from('produtos')
        .select('*')
        .eq('id', body.produto_id)
        .eq('empresa_id', body.empresa_id)
        .maybeSingle()
      if (error) return reply.status(500).send({ error: error.message })
      if (!produto) return reply.status(404).send({ error: 'Produto/servico nao encontrado' })
      produtoSelecionado = produto
      const valorUnitario = body.valor_unitario || Number(produto.valor_unitario || 0)
      const quantidade = Number(body.quantidade || 1)
      body = {
        ...body,
        descricao: produto.descricao,
        valor_unitario: valorUnitario,
        valor_total: valorUnitario * quantidade,
      }
    }

    if (body.natureza_operacao_id) {
      const { data: natureza, error } = await supabase
        .from('naturezas_operacao')
        .select('*')
        .eq('id', body.natureza_operacao_id)
        .eq('empresa_id', body.empresa_id)
        .maybeSingle()
      if (error) return reply.status(500).send({ error: error.message })
      if (!natureza) return reply.status(404).send({ error: 'Natureza de operacao nao encontrada' })
      naturezaSelecionada = natureza
    }

    await ensureBucket('notas-xml', ['application/xml', 'text/xml'])
    await ensureBucket('notas-danfe', ['application/pdf'])

    const serie = body.serie || Number(body.tipo === 'nfce' ? empresa.serie_nfce : empresa.serie_nfe) || 1
    const numero = await nextNumero(empresa, body.tipo, serie)
    const modelo = body.tipo === 'nfce' ? '65' : '55'
    const chaveAcesso = gerarChaveAcesso({
      ufCodigo: empresa.endereco_codigo_ibge,
      cnpj: empresa.cnpj,
      modelo,
      serie,
      numero,
    })
    const protocolo = `LOCAL${Date.now()}`
    const storageBase = `${body.empresa_id}/${chaveAcesso}`
    const xmlPath = `${storageBase}/nota-${chaveAcesso}.xml`
    const danfePath = `${storageBase}/danfe-${chaveAcesso}.pdf`

    const input = {
      empresa,
      cliente: clienteSelecionado,
      produto: produtoSelecionado,
      natureza: naturezaSelecionada,
      nota: {
        tipo: body.tipo,
        numero,
        serie,
        destinatario_nome: body.destinatario_nome,
        destinatario_cpf_cnpj: cleanDoc(body.destinatario_cpf_cnpj),
        descricao: body.descricao,
        quantidade: body.quantidade,
        valor_unitario: body.valor_unitario || body.valor_total,
        valor_total: body.valor_total,
      },
      chaveAcesso,
      protocolo,
    }

    const xml = gerarXmlSimples(input)
    const pdf = gerarDanfeSimples(input)

    const { error: xmlError } = await supabase.storage
      .from('notas-xml')
      .upload(xmlPath, Buffer.from(xml, 'utf8'), { contentType: 'application/xml', upsert: true })
    if (xmlError) return reply.status(500).send({ error: xmlError.message })

    const { error: pdfError } = await supabase.storage
      .from('notas-danfe')
      .upload(danfePath, pdf, { contentType: 'application/pdf', upsert: true })
    if (pdfError) return reply.status(500).send({ error: pdfError.message })

    const notaPayload = {
      empresa_id: body.empresa_id,
      tipo: body.tipo,
      numero,
      serie,
      chave_acesso: chaveAcesso,
      protocolo,
      status: 'emitida_teste',
      xml_path: xmlPath,
      danfe_path: danfePath,
      destinatario_nome: body.destinatario_nome,
      destinatario_cpf_cnpj: cleanDoc(body.destinatario_cpf_cnpj),
      valor_total: body.valor_total,
      payload_original: {
        ...body,
        serie,
        aviso: 'Pre-NF-e gerada para conferencia. Sem assinatura digital, sem transmissao SEFAZ e sem validade fiscal.',
      },
      emitida_em: new Date().toISOString(),
    }

    let { data: nota, error: notaError } = await supabase
      .from('notas_fiscais')
      .insert(notaPayload)
      .select()
      .single()

    if (notaError && notaError.message.toLowerCase().includes('status')) {
      const fallback = { ...notaPayload, status: 'autorizada' }
      const retry = await supabase
        .from('notas_fiscais')
        .insert(fallback)
        .select()
        .single()
      nota = retry.data
      notaError = retry.error
    }

    if (notaError) return reply.status(500).send({ error: notaError.message })
    await updateNextNumero(body.empresa_id, body.tipo, numero)

    return reply.status(201).send({
      ...nota,
      aviso: 'Pre-NF-e e DANFE de conferencia gerados. Ainda falta assinatura digital e transmissao SEFAZ para validade fiscal.',
    })
  })

  app.get<{ Params: { id: string } }>('/notas/:id/xml', async (req, reply) => {
    const { data } = await supabase
      .from('notas_fiscais')
      .select('xml_path, chave_acesso')
      .eq('id', req.params.id)
      .maybeSingle()

    if (!data?.xml_path) return reply.status(404).send({ error: 'XML nao disponivel' })
    return downloadFile('notas-xml', data.xml_path, reply, 'application/xml', `nota-${data.chave_acesso || req.params.id}.xml`)
  })

  app.get<{ Params: { id: string } }>('/notas/:id/danfe', async (req, reply) => {
    const { data } = await supabase
      .from('notas_fiscais')
      .select('danfe_path, chave_acesso')
      .eq('id', req.params.id)
      .maybeSingle()

    if (!data?.danfe_path) return reply.status(404).send({ error: 'DANFE nao disponivel' })
    return downloadFile('notas-danfe', data.danfe_path, reply, 'application/pdf', `danfe-${data.chave_acesso || req.params.id}.pdf`)
  })
}
