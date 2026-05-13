import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '../services/supabase.js'
import { authAdmin } from '../middleware/authAdmin.js'
import { emitirNfe } from '../services/nfe/orquestrador.js'
import { cancelarNota } from '../services/nfe/cancelamento-orquestrador.js'
import { inutilizarNumeracao } from '../services/nfe/inutilizacao-orquestrador.js'
import { emitirCartaCorrecao } from '../services/nfe/carta-correcao-orquestrador.js'
import { carregarCertificado } from '../services/certificado.js'
import { consultarProtocolo, parseSoapResposta, type TransmissaoConfig } from '../services/nfe/transmissor.js'
import {
  gerarDanfeNfe,
  gerarDanfeNfceBobina,
  renderDanfeNfeFromData,
  renderDanfeNfceFromData,
  type DanfeData,
} from '../services/nfe/danfe.js'
import {
  baixarArquivoStorage,
  renderComprovanteAutorizacao,
  gerarQrCodePngBuffer,
} from '../services/nfe/comprovantes.js'
import { htmlToPdf } from '../services/nfe/pdf.js'
import type { Ambiente, Modelo } from '../services/nfe/types.js'
import type { NfeInput } from '../services/nfe/types.js'

/**
 * Rotas de admin pra NF-e/NFC-e — usadas pelo painel admin/.
 *
 * ⚠️ ESQUELETO DE TESTE.
 */

const itemSchema = z.object({
  produto_id: z.string().uuid(),
  quantidade: z.coerce.number().positive(),
  valor_unitario: z.coerce.number().positive().optional(),
  valor_desconto: z.coerce.number().nonnegative().optional(),
})

const intermediadorSchema = z.object({
  cnpj: z.string().regex(/^\d{14}$/, 'CNPJ deve ter 14 dígitos'),
  id_cadastro: z.string().min(1).max(60),
}).nullable().optional()

const transportadoraSchema = z.object({
  nome: z.string().max(120).optional().nullable(),
  cnpj: z.string().optional().nullable(),
  ie: z.string().max(20).optional().nullable(),
  uf: z.string().length(2).optional().nullable(),
}).nullable().optional()

const veiculoSchema = z.object({
  placa: z.string().max(8),
  uf: z.string().length(2).optional().nullable(),
  rntc: z.string().optional().nullable(),
}).nullable().optional()

const volumeSchema = z.object({
  qVol: z.coerce.number().int().nonnegative().optional().nullable(),
  esp: z.string().max(60).optional().nullable(),
  marca: z.string().max(60).optional().nullable(),
  nVol: z.string().max(60).optional().nullable(),
  pesoL: z.coerce.number().nonnegative().optional().nullable(),
  pesoB: z.coerce.number().nonnegative().optional().nullable(),
})

const freteSchema = z.object({
  modalidade: z.coerce.number().int().min(0).max(9),
  valor: z.coerce.number().nonnegative().optional().nullable(),
  valor_seguro: z.coerce.number().nonnegative().optional().nullable(),
  soma_total_nota: z.boolean().optional(),
  transportadora: transportadoraSchema,
  veiculo: veiculoSchema,
  volumes: z.array(volumeSchema).optional(),
}).optional()

const emitirSchema = z.object({
  empresa_id: z.string().uuid(),
  modelo: z.union([z.literal(55), z.literal(65)]),
  natureza_operacao_id: z.string().uuid(),
  cliente_id: z.string().uuid().optional().nullable(),
  itens: z.array(itemSchema).min(1),
  pagamento: z.object({
    forma: z.string(),
    valor: z.coerce.number().positive(),
    troco: z.coerce.number().nonnegative().optional(),
  }),
  informacoes_complementares: z.string().max(5000).optional().nullable(),
  // Novos (Fase 5)
  tipo_documento: z.enum([
    'venda', 'devolucao', 'devolucao_xml', 'remessa_garantia',
    'remessa_garantia_xml', 'importacao', 'complementar', 'ajuste', 'outros',
  ]).optional().default('venda'),
  chave_acesso_referenciada: z.string().regex(/^\d{44}$/).optional().nullable(),
  intermediador: intermediadorSchema,
  frete: freteSchema,
  enviar_email_pos_emissao: z.boolean().optional(),
  email_destinatario: z.string().email().optional().nullable(),
})

export async function adminNfeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authAdmin)

  /** GET /admin/nfe?empresa_id=X&modelo=55|65&status=Y */
  app.get('/nfe', async (req, reply) => {
    const { empresa_id, modelo, status, ambiente } = req.query as {
      empresa_id?: string
      modelo?: string
      status?: string
      ambiente?: string
    }
    let q = supabase
      .from('notas_fiscais')
      .select('*, empresas(nome, razao_social, cnpj)')
      .in('tipo', ['nfe', 'nfce'])
      .order('created_at', { ascending: false })
    if (empresa_id) q = q.eq('empresa_id', empresa_id)
    if (modelo) q = q.eq('modelo', Number(modelo))
    if (status) q = q.eq('status', status)
    if (ambiente) q = q.eq('ambiente_nfe', Number(ambiente))
    const { data, error } = await q
    if (error) return reply.status(500).send({ error: error.message })
    return data || []
  })

  /** GET /admin/nfe/:id */
  app.get<{ Params: { id: string } }>('/nfe/:id', async (req, reply) => {
    const { data, error } = await supabase
      .from('notas_fiscais')
      .select('*, empresas(nome, razao_social, cnpj), notas_fiscais_itens(*)')
      .eq('id', req.params.id)
      .in('tipo', ['nfe', 'nfce'])
      .maybeSingle()
    if (error) return reply.status(500).send({ error: error.message })
    if (!data) return reply.status(404).send({ error: 'Nota não encontrada' })
    return data
  })

  /** POST /admin/nfe/emitir */
  app.post('/nfe/emitir', async (req, reply) => {
    const parsed = emitirSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }
    const body = parsed.data

    try {
      const input: NfeInput = {
        empresaId: body.empresa_id,
        modelo: body.modelo,
        naturezaOperacaoId: body.natureza_operacao_id,
        clienteId: body.cliente_id || undefined,
        itens: body.itens.map((i) => ({
          produtoId: i.produto_id,
          quantidade: i.quantidade,
          valorUnitario: i.valor_unitario,
          valorDesconto: i.valor_desconto,
        })),
        pagamento: {
          forma: body.pagamento.forma as NfeInput['pagamento']['forma'],
          valor: body.pagamento.valor,
          troco: body.pagamento.troco,
        },
        informacoesComplementares: body.informacoes_complementares || undefined,
        tipoDocumento: body.tipo_documento,
        chaveAcessoReferenciada: body.chave_acesso_referenciada || undefined,
        intermediador: body.intermediador
          ? { cnpj: body.intermediador.cnpj, idCadastro: body.intermediador.id_cadastro }
          : undefined,
        frete: body.frete
          ? {
              modalidade: body.frete.modalidade,
              valor: body.frete.valor ?? 0,
              valorSeguro: body.frete.valor_seguro ?? 0,
              somaTotalNota: body.frete.soma_total_nota ?? true,
              transportadora: body.frete.transportadora || undefined,
              veiculo: body.frete.veiculo || undefined,
              volumes: body.frete.volumes || [],
            }
          : undefined,
        enviarEmailPosEmissao: body.enviar_email_pos_emissao,
        emailDestinatario: body.email_destinatario || undefined,
      }
      const result = await emitirNfe(input)
      return reply.status(result.status === 'autorizada' ? 200 : 422).send(result)
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message })
    }
  })

  /** GET /admin/nfe/preview/:modelo — DANFE em HTML com dados fake (visualização) */
  app.get<{ Params: { modelo: string } }>('/nfe/preview/:modelo', async (req, reply) => {
    const modelo = Number(req.params.modelo)
    if (modelo !== 55 && modelo !== 65) {
      return reply.status(400).send({ error: 'modelo deve ser 55 (NF-e) ou 65 (NFC-e)' })
    }
    const data = dadosFakeDanfe(modelo as 55 | 65)
    const html = modelo === 65
      ? await renderDanfeNfceFromData(data)
      : await renderDanfeNfeFromData(data)
    reply.header('Content-Type', 'text/html; charset=utf-8')
    return reply.send(html)
  })

  /** GET /admin/nfe/:id/comprovantes — lista todos os documentos visualizáveis/baixáveis */
  app.get<{ Params: { id: string } }>('/nfe/:id/comprovantes', async (req, reply) => {
    const { data: nota, error } = await supabase
      .from('notas_fiscais')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle()
    if (error) return reply.status(500).send({ error: error.message })
    if (!nota) return reply.status(404).send({ error: 'Nota não encontrada' })

    const ehNfce = nota.modelo != null ? Number(nota.modelo) === 65 : nota.tipo === 'nfce'
    const autorizada = nota.status === 'autorizada'

    // Lista eventos da nota (cancelamento, CC-e), se a tabela existir
    let eventos: Array<{ id: string; tipo_evento: string; sequencial: number; status: string; data_evento: string | null }> = []
    const evRes = await supabase
      .from('notas_fiscais_eventos')
      .select('id, tipo_evento, sequencial, status, data_evento')
      .eq('nota_id', req.params.id)
      .order('sequencial')
    if (!evRes.error && evRes.data) {
      eventos = evRes.data as typeof eventos
    }

    return {
      nota_id: req.params.id,
      modelo: ehNfce ? 65 : 55,
      status: nota.status,
      comprovantes: [
        {
          tipo: 'danfe_pdf',
          label: ehNfce ? 'DANFE NFC-e (bobina) — PDF' : 'DANFE NF-e (A4) — PDF',
          icon: 'file',
          formato: 'pdf',
          url: `/admin/nfe/${req.params.id}/danfe.pdf`,
          disponivel: true,
        },
        {
          tipo: 'danfe_html',
          label: 'DANFE — HTML (visualizar no browser)',
          icon: 'file',
          formato: 'html',
          url: `/admin/nfe/${req.params.id}/danfe`,
          disponivel: true,
        },
        {
          tipo: 'comprovante_autorizacao_pdf',
          label: 'Comprovante de Autorização SEFAZ — PDF',
          icon: 'shield',
          formato: 'pdf',
          url: `/admin/nfe/${req.params.id}/comprovante-autorizacao.pdf`,
          disponivel: autorizada,
          motivo: autorizada ? undefined : 'Só disponível após autorização',
        },
        {
          tipo: 'comprovante_autorizacao_html',
          label: 'Comprovante de Autorização — HTML',
          icon: 'shield',
          formato: 'html',
          url: `/admin/nfe/${req.params.id}/comprovante-autorizacao`,
          disponivel: autorizada,
          motivo: autorizada ? undefined : 'Só disponível após autorização',
        },
        {
          tipo: 'xml_autorizado',
          label: 'XML autorizado (nfeProc — documento fiscal oficial)',
          icon: 'code',
          formato: 'xml',
          url: `/admin/nfe/${req.params.id}/xml?tipo=autorizado`,
          disponivel: !!nota.xml_proc_path,
          motivo: nota.xml_proc_path ? undefined : 'XML autorizado não disponível (nota não autorizada ou pré-migration 015)',
        },
        {
          tipo: 'xml_assinado',
          label: 'XML pré-envio (NFe assinada)',
          icon: 'code',
          formato: 'xml',
          url: `/admin/nfe/${req.params.id}/xml?tipo=assinado`,
          disponivel: !!nota.xml_path,
          motivo: nota.xml_path ? undefined : 'XML pré-envio não foi persistido',
        },
        {
          tipo: 'qrcode_png',
          label: 'QR Code (PNG isolado)',
          icon: 'qr',
          formato: 'png',
          url: `/admin/nfe/${req.params.id}/qrcode.png`,
          disponivel: ehNfce && !!nota.qr_code_nfce,
          motivo: ehNfce ? (nota.qr_code_nfce ? undefined : 'QR Code não disponível') : 'QR Code só pra NFC-e',
        },
      ],
      eventos: eventos.map((ev) => ({
        id: ev.id,
        tipo_evento: ev.tipo_evento,
        sequencial: ev.sequencial,
        status: ev.status,
        data_evento: ev.data_evento,
        label:
          ev.tipo_evento === 'cancelamento'
            ? `Cancelamento (seq ${ev.sequencial})`
            : ev.tipo_evento === 'carta_correcao'
            ? `Carta de Correção (seq ${ev.sequencial})`
            : ev.tipo_evento === 'inutilizacao'
            ? `Inutilização (seq ${ev.sequencial})`
            : `Evento ${ev.tipo_evento} seq ${ev.sequencial}`,
        url: `/admin/nfe/${req.params.id}/eventos/${ev.id}/xml`,
      })),
    }
  })

  /** GET /admin/nfe/:id/xml?tipo=autorizado|assinado — baixa o XML do Storage */
  app.get<{ Params: { id: string }; Querystring: { tipo?: 'autorizado' | 'assinado' } }>(
    '/nfe/:id/xml',
    async (req, reply) => {
      const tipo = req.query.tipo === 'assinado' ? 'assinado' : 'autorizado'
      const { data: nota } = await supabase
        .from('notas_fiscais')
        .select('*')
        .eq('id', req.params.id)
        .maybeSingle()
      if (!nota) return reply.status(404).send({ error: 'Nota não encontrada' })

      const path = tipo === 'autorizado' ? nota.xml_proc_path : nota.xml_path
      if (!path) {
        return reply
          .status(404)
          .send({ error: `XML ${tipo} não disponível pra essa nota` })
      }
      const file = await baixarArquivoStorage('notas-xml', path)
      if (!file) return reply.status(404).send({ error: 'Arquivo XML não encontrado no Storage' })

      reply.header('Content-Type', 'application/xml; charset=utf-8')
      reply.header('Content-Disposition', `attachment; filename="${file.filename}"`)
      return reply.send(file.buffer)
    },
  )

  /** GET /admin/nfe/:id/danfe.pdf — DANFE convertida pra PDF via headless Chrome */
  app.get<{ Params: { id: string } }>('/nfe/:id/danfe.pdf', async (req, reply) => {
    try {
      // SELECT * pra resiliência (coluna `modelo` só existe com migration 013)
      const { data: nota, error } = await supabase
        .from('notas_fiscais')
        .select('*')
        .eq('id', req.params.id)
        .maybeSingle()
      if (error) return reply.status(500).send({ error: error.message })
      if (!nota) return reply.status(404).send({ error: 'Nota não encontrada' })
      const ehNfce = nota.modelo != null ? Number(nota.modelo) === 65 : nota.tipo === 'nfce'
      const html = ehNfce
        ? await gerarDanfeNfceBobina(req.params.id)
        : await gerarDanfeNfe(req.params.id)
      const pdf = await htmlToPdf(html, { formato: ehNfce ? 'bobina-80mm' : 'a4' })
      const fname = `danfe-${ehNfce ? 'nfce' : 'nfe'}-${nota.numero || nota.chave_acesso?.slice(-8) || 'nota'}.pdf`
      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', `inline; filename="${fname}"`)
      return reply.send(pdf)
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message })
    }
  })

  /** GET /admin/nfe/:id/comprovante-autorizacao.pdf — comprovante autorização em PDF */
  app.get<{ Params: { id: string } }>('/nfe/:id/comprovante-autorizacao.pdf', async (req, reply) => {
    try {
      const { data: nota } = await supabase
        .from('notas_fiscais')
        .select('*')
        .eq('id', req.params.id)
        .maybeSingle()
      if (!nota) return reply.status(404).send({ error: 'Nota não encontrada' })
      const { data: empresa } = await supabase
        .from('empresas')
        .select('razao_social, cnpj, ie')
        .eq('id', nota.empresa_id)
        .maybeSingle()
      const html = renderComprovanteAutorizacao({
        empresa: empresa || {},
        nota: {
          numero: nota.numero,
          serie: nota.serie,
          modelo: nota.modelo ?? (nota.tipo === 'nfce' ? 65 : 55),
          chave_acesso: nota.chave_acesso,
          protocolo: nota.protocolo,
          data_autorizacao: nota.data_autorizacao,
          valor_total: nota.valor_total,
          ambiente_nfe: nota.ambiente_nfe ?? 2,
          status: nota.status,
          mensagens_retorno: nota.mensagens_retorno,
        },
      })
      const pdf = await htmlToPdf(html, { formato: 'a4' })
      const fname = `comprovante-autorizacao-${nota.numero || nota.chave_acesso?.slice(-8) || 'nota'}.pdf`
      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', `inline; filename="${fname}"`)
      return reply.send(pdf)
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message })
    }
  })

  /** GET /admin/nfe/:id/comprovante-autorizacao — HTML imprimível do retorno SEFAZ */
  app.get<{ Params: { id: string } }>('/nfe/:id/comprovante-autorizacao', async (req, reply) => {
    const { data: nota } = await supabase
      .from('notas_fiscais')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle()
    if (!nota) return reply.status(404).send({ error: 'Nota não encontrada' })

    const { data: empresa } = await supabase
      .from('empresas')
      .select('razao_social, cnpj, ie')
      .eq('id', nota.empresa_id)
      .maybeSingle()

    const html = renderComprovanteAutorizacao({
      empresa: empresa || {},
      nota: {
        numero: nota.numero,
        serie: nota.serie,
        modelo: nota.modelo ?? (nota.tipo === 'nfce' ? 65 : 55),
        chave_acesso: nota.chave_acesso,
        protocolo: nota.protocolo,
        data_autorizacao: nota.data_autorizacao,
        valor_total: nota.valor_total,
        ambiente_nfe: nota.ambiente_nfe ?? 2,
        status: nota.status,
        mensagens_retorno: nota.mensagens_retorno,
      },
    })
    reply.header('Content-Type', 'text/html; charset=utf-8')
    return reply.send(html)
  })

  /** GET /admin/nfe/:id/qrcode.png — PNG do QR Code (só pra NFC-e) */
  app.get<{ Params: { id: string } }>('/nfe/:id/qrcode.png', async (req, reply) => {
    // SELECT * — qr_code_nfce só existe com migration 013
    const { data: nota } = await supabase
      .from('notas_fiscais')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle()
    if (!nota?.qr_code_nfce) {
      return reply.status(404).send({ error: 'QR Code não disponível pra essa nota' })
    }
    const png = await gerarQrCodePngBuffer(String(nota.qr_code_nfce))
    reply.header('Content-Type', 'image/png')
    reply.header('Content-Disposition', 'inline; filename="qrcode.png"')
    return reply.send(png)
  })

  /** GET /admin/nfe/:id/eventos/:eventoId/xml — baixa XML do evento (cancelamento / CC-e / inutilização) */
  app.get<{ Params: { id: string; eventoId: string }; Querystring: { tipo?: 'evento' | 'retorno' } }>(
    '/nfe/:id/eventos/:eventoId/xml',
    async (req, reply) => {
      const tipoXml = req.query.tipo === 'retorno' ? 'retorno' : 'evento'
      const { data: ev } = await supabase
        .from('notas_fiscais_eventos')
        .select('xml_evento_path, xml_retorno_path')
        .eq('id', req.params.eventoId)
        .maybeSingle()
      if (!ev) return reply.status(404).send({ error: 'Evento não encontrado' })

      const path = tipoXml === 'retorno' ? ev.xml_retorno_path : ev.xml_evento_path
      if (!path) return reply.status(404).send({ error: `XML ${tipoXml} do evento não disponível` })

      const file = await baixarArquivoStorage('notas-xml', path)
      if (!file) return reply.status(404).send({ error: 'Arquivo não encontrado no Storage' })

      reply.header('Content-Type', 'application/xml; charset=utf-8')
      reply.header('Content-Disposition', `attachment; filename="${file.filename}"`)
      return reply.send(file.buffer)
    },
  )

  /** GET /admin/nfe/:id/danfe — DANFE em HTML (NF-e A4 ou NFC-e bobina) */
  app.get<{ Params: { id: string } }>('/nfe/:id/danfe', async (req, reply) => {
    try {
      // SELECT * pra não falhar quando alguma coluna nova (modelo, etc.) ainda
      // não foi adicionada pela migration 013.
      const { data: nota, error } = await supabase
        .from('notas_fiscais')
        .select('*')
        .eq('id', req.params.id)
        .maybeSingle()
      if (error) return reply.status(500).send({ error: `Erro consultando nota: ${error.message}` })
      if (!nota) return reply.status(404).send({ error: 'Nota não encontrada' })
      // Determina se é NFC-e: usa `modelo` (migration 013) ou cai no `tipo` (migration 004).
      const ehNfce =
        nota.modelo != null ? Number(nota.modelo) === 65 : nota.tipo === 'nfce'
      const html = ehNfce
        ? await gerarDanfeNfceBobina(req.params.id)
        : await gerarDanfeNfe(req.params.id)
      reply.header('Content-Type', 'text/html; charset=utf-8')
      return reply.send(html)
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message })
    }
  })

  /** POST /admin/nfe/:id/cancelar */
  app.post<{ Params: { id: string } }>('/nfe/:id/cancelar', async (req, reply) => {
    const parsed = cancelarSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }
    try {
      const result = await cancelarNota(req.params.id, parsed.data.justificativa)
      return reply.status(result.status === 'autorizado' ? 200 : 422).send(result)
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message })
    }
  })

  /** GET /admin/nfe/:id/verificar-sefaz — consulta o protocolo direto na SEFAZ */
  app.get<{ Params: { id: string } }>('/nfe/:id/verificar-sefaz', async (req, reply) => {
    try {
      const { data: nota, error } = await supabase
        .from('notas_fiscais')
        .select('*')
        .eq('id', req.params.id)
        .maybeSingle()
      if (error) return reply.status(500).send({ error: error.message })
      if (!nota) return reply.status(404).send({ error: 'Nota não encontrada' })
      if (!nota.chave_acesso) {
        return reply.status(400).send({ error: 'Nota sem chave de acesso — ainda não foi transmitida' })
      }

      const cert = await carregarCertificado(nota.empresa_id)
      if (!cert) return reply.status(400).send({ error: 'Certificado A1 da empresa não cadastrado' })

      const ambiente = (nota.ambiente_nfe || 2) as Ambiente
      const ehNfce = nota.modelo != null ? Number(nota.modelo) === 65 : nota.tipo === 'nfce'
      const modelo = (ehNfce ? 65 : 55) as Modelo

      const cfg: TransmissaoConfig = {
        modelo,
        ambiente,
        pfxBuffer: cert.pfxBuffer,
        pfxSenha: cert.senha,
      }

      const res = await consultarProtocolo(cfg, nota.chave_acesso)
      // Se SVRS devolver HTML (404 etc.) o webservice de consulta tá indisponível.
      const httpOk = res.status >= 200 && res.status < 300
      const isXml = res.contentType.includes('xml') || res.body.trimStart().startsWith('<?xml') || res.body.includes('<soap:')
      if (!httpOk || !isXml) {
        return {
          chave_acesso: nota.chave_acesso,
          ambiente,
          consulta: {
            cStat: '',
            xMotivo: `Webservice de consulta indisponível (HTTP ${res.status}). Confirmação via emissão original.`,
            dhRecbto: '',
            protocoloSefaz: null,
            webservice_indisponivel: true,
          },
          comparacao: {
            status_local: nota.status,
            protocolo_local: nota.protocolo,
            protocolo_bate: nota.status === 'autorizada' && !!nota.protocolo,
          },
          raw_xml: res.body.slice(0, 500),
        }
      }
      const parsed = parseSoapResposta(res.body) as Record<string, unknown>
      const cStat = String(parsed.cStat ?? '')
      const xMotivo = String(parsed.xMotivo ?? '')
      const dhRecbto = String(parsed.dhRecbto ?? '')
      const protocoloSefaz = (parsed.protNFe as Record<string, unknown> | undefined)?.infProt
        ? ((parsed.protNFe as Record<string, unknown>).infProt as Record<string, unknown>).nProt
        : undefined

      return {
        chave_acesso: nota.chave_acesso,
        ambiente,
        consulta: {
          cStat,
          xMotivo,
          dhRecbto,
          protocoloSefaz: protocoloSefaz != null ? String(protocoloSefaz) : null,
        },
        comparacao: {
          status_local: nota.status,
          protocolo_local: nota.protocolo,
          protocolo_bate:
            protocoloSefaz != null && String(protocoloSefaz) === nota.protocolo,
        },
        raw_xml: res.body,
      }
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message })
    }
  })

  /** POST /admin/nfe/:id/carta-correcao */
  app.post<{ Params: { id: string } }>('/nfe/:id/carta-correcao', async (req, reply) => {
    const parsed = cceSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }
    try {
      const result = await emitirCartaCorrecao(req.params.id, parsed.data.texto_correcao)
      return reply.status(result.status === 'autorizado' ? 200 : 422).send(result)
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message })
    }
  })

  /** POST /admin/nfe/inutilizar */
  app.post('/nfe/inutilizar', async (req, reply) => {
    const parsed = inutilizarSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }
    try {
      const result = await inutilizarNumeracao({
        empresaId: parsed.data.empresa_id,
        modelo: parsed.data.modelo,
        serie: parsed.data.serie,
        numeroInicial: parsed.data.numero_inicial,
        numeroFinal: parsed.data.numero_final,
        justificativa: parsed.data.justificativa,
        ano: parsed.data.ano,
      })
      return reply.status(result.status === 'autorizada' ? 200 : 422).send(result)
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message })
    }
  })
}

function dadosFakeDanfe(modelo: 55 | 65): DanfeData {
  const empresa = {
    razao_social: 'ÓTICA EXEMPLO LTDA',
    cnpj: '12345678000199',
    ie: '060000000',
    endereco_logradouro: 'Rua das Flores',
    endereco_numero: '123',
    endereco_bairro: 'Centro',
    endereco_cidade: 'GROAÍRAS',
    endereco_uf: 'CE',
    endereco_cep: '62170000',
  }
  const cliente = {
    nome: 'JOÃO DA SILVA',
    cpf_cnpj: '12345678909',
    endereco_logradouro: 'Av. Brasil',
    endereco_numero: '500',
    endereco_bairro: 'Aldeota',
    endereco_cidade: 'FORTALEZA',
    endereco_uf: 'CE',
    endereco_cep: '60150000',
  }
  const itens = [
    {
      numero_item: 1,
      codigo_produto: 'OCULOS-RB-001',
      descricao: 'ÓCULOS DE GRAU RAY-BAN RB5228 - ARMAÇÃO PLÁSTICA',
      ncm: '90031100',
      cfop: '5102',
      unidade_comercial: 'PC',
      quantidade_comercial: 1,
      valor_unitario: 450,
      valor_total: 450,
      gtin: 'SEM GTIN',
    },
    {
      numero_item: 2,
      codigo_produto: 'LENTE-MULTI-001',
      descricao: 'LENTE OFTÁLMICA MULTIFOCAL ANTIRREFLEXO',
      ncm: '90015000',
      cfop: '5102',
      unidade_comercial: 'PAR',
      quantidade_comercial: 1,
      valor_unitario: 280,
      valor_total: 280,
      valor_desconto: 30,
      gtin: 'SEM GTIN',
    },
  ]
  const baseNota = {
    numero: 1,
    serie: 1,
    modelo,
    ambiente_nfe: 2,
    status: 'autorizada',
    protocolo: '123456789012345',
    chave_acesso: '23260512345678000199550010000000011000000017',
    valor_produtos: 730,
    valor_desconto: 30,
    valor_frete: 0,
    valor_icms: 0,
    valor_ipi: 0,
    valor_outras_despesas: 0,
    valor_total: 700,
    valor_pago: 700,
    troco: 0,
    forma_pagamento: modelo === 65 ? '17' : '03',
    info_complementar:
      'Documento emitido por ME ou EPP optante pelo Simples Nacional. Não gera direito a crédito fiscal de ICMS, ISS e IPI.',
    data_autorizacao: new Date().toISOString(),
  }
  if (modelo === 65) {
    return {
      empresa,
      nota: {
        ...baseNota,
        numero: 1042,
        qr_code_nfce:
          'https://nfceh.sefaz.ce.gov.br/pages/consultaNFCe.jsf?p=23260512345678000199650010000010421000000017|2|2|1|abc123def456',
      },
      itens,
    }
  }
  return { empresa, cliente, nota: baseNota, itens }
}

const cancelarSchema = z.object({
  justificativa: z.string().min(15).max(255),
})

const cceSchema = z.object({
  texto_correcao: z.string().min(15).max(1000),
})

const inutilizarSchema = z.object({
  empresa_id: z.string().uuid(),
  modelo: z.union([z.literal(55), z.literal(65)]),
  serie: z.coerce.number().int().min(0).max(999),
  numero_inicial: z.coerce.number().int().positive(),
  numero_final: z.coerce.number().int().positive(),
  ano: z.coerce.number().int().min(2000).max(2099).optional(),
  justificativa: z.string().min(15).max(255),
})
