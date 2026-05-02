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
  crt: z.coerce.number().int().min(1).max(4).optional().nullable(),
  endereco_logradouro: z.string().optional().nullable(),
  endereco_numero: z.string().optional().nullable(),
  endereco_bairro: z.string().optional().nullable(),
  endereco_cidade: z.string().optional().nullable(),
  endereco_uf: z.string().length(2).optional().nullable(),
  endereco_cep: z.string().optional().nullable(),
  endereco_codigo_ibge: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  telefone: z.string().optional().nullable(),
  ambiente_sefaz: z.coerce.number().int().min(1).max(2).optional(),
  uf_sefaz: z.string().length(2).optional(),
  csc_id: z.string().optional().nullable(),
  csc_token: z.string().optional().nullable(),
  serie_nfe: z.coerce.number().int().min(1).max(999).optional(),
  proximo_numero_nfe: z.coerce.number().int().min(1).optional(),
  serie_nfce: z.coerce.number().int().min(1).max(999).optional(),
  proximo_numero_nfce: z.coerce.number().int().min(1).optional(),
  tipo_emissao_habilitado: z.enum(['teste_local', 'nfe', 'nfce', 'nfe_nfce']).optional(),
  status_fiscal: z.enum(['incompleta', 'pronta_homologacao', 'pronta_producao']).optional(),
})

function cleanDoc(value?: string | null) {
  return value ? value.replace(/\D/g, '') : value
}

function cleanEmptyStrings<T extends Record<string, unknown>>(payload: T) {
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [key, value === '' ? null : value])
  ) as T
}

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
    const payload = cleanEmptyStrings({
      ...parsed.data,
      cnpj: cleanDoc(parsed.data.cnpj),
      endereco_uf: parsed.data.endereco_uf?.toUpperCase(),
      uf_sefaz: parsed.data.uf_sefaz?.toUpperCase(),
    })

    const { data, error } = await supabase
      .from('empresas')
      .insert(payload)
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
    const payload = cleanEmptyStrings({
      ...parsed.data,
      cnpj: parsed.data.cnpj ? cleanDoc(parsed.data.cnpj) : undefined,
      endereco_uf: parsed.data.endereco_uf?.toUpperCase(),
      uf_sefaz: parsed.data.uf_sefaz?.toUpperCase(),
      updated_at: new Date().toISOString(),
    })

    const { data, error } = await supabase
      .from('empresas')
      .update(payload)
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

  /* ---------------- Verificação Fiscal ---------------- */

  /**
   * POST /admin/empresas/:id/verificar
   * Verifica a configuração fiscal da empresa e retorna resultado estruturado.
   * Não transmite para SEFAZ — apenas valida dados locais.
   */
  app.post<{ Params: { id: string } }>('/empresas/:id/verificar', async (req, reply) => {
    const empresaId = req.params.id

    const { data: empresa } = await supabase
      .from('empresas')
      .select('*')
      .eq('id', empresaId)
      .maybeSingle()

    if (!empresa) return reply.status(404).send({ error: 'Empresa não encontrada' })

    const cert = await statusCertificado(empresaId)

    type ItemVerificacao = {
      item: string
      ok: boolean
      mensagem: string
    }

    const verificacoes: ItemVerificacao[] = []
    let statusFinal = 'pronta'

    // 1. CNPJ da empresa
    const temCnpj = !!(empresa.cnpj && empresa.cnpj.length >= 14)
    verificacoes.push({
      item: 'CNPJ da empresa',
      ok: temCnpj,
      mensagem: temCnpj
        ? empresa.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
        : 'CNPJ não preenchido',
    })
    if (!temCnpj) statusFinal = 'dados_fiscais_incompletos'

    // 2. Certificado cadastrado
    const temCert = !!cert
    verificacoes.push({
      item: 'Certificado digital',
      ok: temCert,
      mensagem: temCert ? `Cadastrado (serial: ${cert!.serialNumber.slice(0, 12)}...)` : 'Nenhum certificado cadastrado',
    })
    if (!temCert && statusFinal === 'pronta') statusFinal = 'sem_certificado'

    // 3. Certificado válido (não vencido)
    if (cert) {
      const certValido = cert.status !== 'vencido'
      verificacoes.push({
        item: 'Validade do certificado',
        ok: certValido,
        mensagem: certValido
          ? `Válido até ${new Date(cert.validoAte).toLocaleDateString('pt-BR')} (${cert.diasRestantes} dias)`
          : `Vencido em ${new Date(cert.validoAte).toLocaleDateString('pt-BR')}`,
      })
      if (!certValido && statusFinal === 'pronta') statusFinal = 'certificado_vencido'
    }

    // 4. CNPJ do certificado bate com CNPJ da empresa
    if (cert && temCnpj) {
      const cnpjEmpresa = empresa.cnpj.replace(/\D/g, '')
      const cnpjCert = cert.cnpj.replace(/\D/g, '')
      const cnpjBate = cnpjEmpresa === cnpjCert
      verificacoes.push({
        item: 'CNPJ empresa × certificado',
        ok: cnpjBate,
        mensagem: cnpjBate
          ? 'CNPJ confere'
          : `Divergência: empresa ${cnpjEmpresa} / certificado ${cnpjCert}`,
      })
      if (!cnpjBate && statusFinal === 'pronta') statusFinal = 'cnpj_divergente'
    }

    // 5. Dados fiscais obrigatórios: UF, CRT, regime, cidade, código IBGE
    const camposFiscais = [
      { campo: 'UF SEFAZ', valor: empresa.uf_sefaz },
      { campo: 'CRT', valor: empresa.crt },
      { campo: 'Regime tributário', valor: empresa.regime_tributario },
      { campo: 'Cidade', valor: empresa.endereco_cidade },
      { campo: 'Código IBGE', valor: empresa.endereco_codigo_ibge },
    ]
    const camposFaltando = camposFiscais.filter((c) => !c.valor).map((c) => c.campo)
    const dadosOk = camposFaltando.length === 0
    verificacoes.push({
      item: 'Dados fiscais (UF, CRT, regime, cidade, IBGE)',
      ok: dadosOk,
      mensagem: dadosOk
        ? `UF: ${empresa.uf_sefaz}, CRT: ${empresa.crt}, Regime: ${empresa.regime_tributario}`
        : `Faltam: ${camposFaltando.join(', ')}`,
    })
    if (!dadosOk && statusFinal === 'pronta') statusFinal = 'dados_fiscais_incompletos'

    // 6. Série e número NF-e configurados
    const temSerieNfe = !!(empresa.serie_nfe && empresa.proximo_numero_nfe)
    verificacoes.push({
      item: 'Série e número NF-e',
      ok: temSerieNfe,
      mensagem: temSerieNfe
        ? `Série ${empresa.serie_nfe}, próximo número ${empresa.proximo_numero_nfe}`
        : 'Série ou próximo número NF-e não configurados',
    })
    if (!temSerieNfe && statusFinal === 'pronta') statusFinal = 'serie_numero_ausente'

    // 7. Se NFC-e habilitado: CSC ID e CSC Token
    const nfceHabilitada = empresa.tipo_emissao_habilitado === 'nfce' || empresa.tipo_emissao_habilitado === 'nfe_nfce'
    if (nfceHabilitada) {
      const temCsc = !!(empresa.csc_id && empresa.csc_token)
      verificacoes.push({
        item: 'CSC ID e CSC Token (NFC-e)',
        ok: temCsc,
        mensagem: temCsc ? 'CSC configurado' : 'CSC ID ou CSC Token ausentes (obrigatório para NFC-e)',
      })
      if (!temCsc && statusFinal === 'pronta') statusFinal = 'csc_ausente'
    }

    // Atualiza o status_fiscal na empresa com base na verificação
    let novoStatusFiscal: string
    if (statusFinal === 'pronta') {
      novoStatusFiscal = empresa.ambiente_sefaz === 1 ? 'pronta_producao' : 'pronta_homologacao'
    } else {
      novoStatusFiscal = 'incompleta'
    }

    await supabase
      .from('empresas')
      .update({ status_fiscal: novoStatusFiscal })
      .eq('id', empresaId)

    return {
      status: statusFinal,
      status_fiscal: novoStatusFiscal,
      ambiente: empresa.ambiente_sefaz === 1 ? 'producao' : 'homologacao',
      verificacoes,
      aviso: 'Verificação local — não realiza consulta à SEFAZ.',
    }
  })
}
