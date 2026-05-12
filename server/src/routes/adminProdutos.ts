import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '../services/supabase.js'
import { authAdmin } from '../middleware/authAdmin.js'
import { logAcao } from '../services/auditLog.js'

const produtoSchema = z.object({
  empresa_id: z.string().uuid(),
  descricao: z.string().min(1),
  codigo_interno: z.string().optional().nullable(),
  ncm: z.string().optional().nullable(),
  cfop: z.string().optional().nullable(),
  unidade: z.string().default('UN'),
  valor_unitario: z.coerce.number().optional().nullable(),
  origem: z.coerce.number().int().min(0).max(8).default(0),
  cst_csosn: z.string().optional().nullable(),
  aliquota_icms: z.coerce.number().min(0).max(100).optional().nullable(),
  aliquota_pis: z.coerce.number().min(0).max(100).optional().nullable(),
  aliquota_cofins: z.coerce.number().min(0).max(100).optional().nullable(),
  // NF-e/NFC-e (mercadoria física)
  gtin: z.string().optional().nullable(),
  cest: z.string().optional().nullable(),
  peso_liquido: z.coerce.number().nonnegative().optional().nullable(),
  peso_bruto: z.coerce.number().nonnegative().optional().nullable(),
  unidade_tributavel: z.string().optional().nullable(),
  ex_tipi: z.string().optional().nullable(),
  aliquota_ipi: z.coerce.number().min(0).max(100).optional().nullable(),
  cst_pis: z.string().optional().nullable(),
  cst_cofins: z.string().optional().nullable(),
  cst_ipi: z.string().optional().nullable(),
  info_adicional_produto: z.string().max(500).optional().nullable(),
  // ssOtica permite estoque negativo (item vendido sem reposição), aceitamos também
  estoque: z.coerce.number().optional().nullable(),
  // Campos NFS-e (Padrão Nacional) — usados quando tipo='servico'
  codigo_lc116: z.string().optional().nullable(),
  codigo_tributario_municipal: z.string().optional().nullable(),
  codigo_nbs: z.string().optional().nullable(),
  cnae: z.string().optional().nullable(),
  aliquota_iss: z.coerce.number().min(0).max(100).optional().nullable(),
  iss_retido: z.boolean().optional(),
  tipo: z.enum(['produto', 'servico']).default('produto'),
  ativo: z.boolean().optional(),
  // Migration 019 — separa estado arquivado de ativo
  arquivado: z.boolean().optional(),
  // Migration 016 — campos novos
  referencia: z.string().optional().nullable(),
  marca: z.string().optional().nullable(),
  controla_estoque: z.boolean().optional(),
  venda_somente_com_os: z.boolean().optional(),
  observacao: z.string().optional().nullable(),
  csosn: z.string().optional().nullable(),
  cst_icms: z.string().optional().nullable(),
  cst_icms_venda_futura: z.string().optional().nullable(),
  cst_icms_entrega: z.string().optional().nullable(),
  aliquota_credito_icms: z.coerce.number().min(0).max(100).optional().nullable(),
  percentual_base_calculo_icms: z.coerce.number().min(0).max(100).optional().nullable(),
  aliquota_icms_st: z.coerce.number().min(0).max(100).optional().nullable(),
  percentual_mva: z.coerce.number().min(0).optional().nullable(),
  percentual_reducao_bc_st: z.coerce.number().min(0).max(100).optional().nullable(),
  cfop_venda_dentro: z.string().optional().nullable(),
  cfop_devolucao_dentro: z.string().optional().nullable(),
  cfop_remessa_garantia_dentro: z.string().optional().nullable(),
  cfop_transferencia_dentro: z.string().optional().nullable(),
  cfop_venda_futura_dentro: z.string().optional().nullable(),
  cfop_entrega_venda_dentro: z.string().optional().nullable(),
  cfop_venda_fora: z.string().optional().nullable(),
  cfop_devolucao_fora: z.string().optional().nullable(),
  cfop_remessa_garantia_fora: z.string().optional().nullable(),
  cfop_transferencia_fora: z.string().optional().nullable(),
  cfop_venda_futura_fora: z.string().optional().nullable(),
  cfop_entrega_venda_fora: z.string().optional().nullable(),
  cfop_compra_dentro: z.string().optional().nullable(),
  cfop_compra_fora: z.string().optional().nullable(),
  codigo_enquadramento_ipi: z.string().optional().nullable(),
  tipo_calculo_ipi: z.string().optional().nullable(),
  valor_unitario_ipi: z.coerce.number().optional().nullable(),
  qtde_total_ipi: z.coerce.number().optional().nullable(),
  classe_enquadramento_ipi: z.string().optional().nullable(),
  cnpj_produtor_ipi: z.string().optional().nullable(),
  codigo_selo_controle_ipi: z.string().optional().nullable(),
  qtde_selo_controle_ipi: z.coerce.number().optional().nullable(),
  tipo_calculo_pis: z.string().optional().nullable(),
  valor_unitario_pis: z.coerce.number().optional().nullable(),
  qtde_total_pis: z.coerce.number().optional().nullable(),
  tipo_calculo_cofins: z.string().optional().nullable(),
  valor_unitario_cofins: z.coerce.number().optional().nullable(),
  qtde_total_cofins: z.coerce.number().optional().nullable(),
})

function cleanEmptyStrings<T extends Record<string, unknown>>(payload: T) {
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [key, value === '' ? null : value])
  ) as T
}

/**
 * Insere um lote em `produtos` adaptando-se ao schema real do banco.
 *
 * Se a migration 013/014/016 não foi aplicada, várias colunas ainda não existem
 * (cest, gtin, referencia, etc). Em vez de falhar, detectamos quais colunas o
 * Postgres não conhece via mensagem de erro do PostgREST e removemos do payload.
 * O Set `colunasInexistentes` é populado e reaproveitado entre lotes da mesma
 * requisição — então só pagamos o custo da descoberta uma vez.
 */
async function insertProdutosAdaptive(
  slice: Record<string, unknown>[],
  colunasInexistentes: Set<string>,
  idsAcumulados?: string[],
): Promise<{ inseridos: number; erro?: string }> {
  // Remove colunas já detectadas como inexistentes
  const stripColunas = (rows: Record<string, unknown>[]) =>
    colunasInexistentes.size === 0
      ? rows
      : rows.map((r) => {
          const cleaned: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(r)) {
            if (!colunasInexistentes.has(k)) cleaned[k] = v
          }
          return cleaned
        })

  let payload = stripColunas(slice)
  for (let tentativa = 0; tentativa < 60; tentativa++) {
    const { data, error } = await supabase.from('produtos').insert(payload).select('id')
    if (!error) {
      if (idsAcumulados && data) {
        for (const r of data) idsAcumulados.push((r as { id: string }).id)
      }
      return { inseridos: data?.length || 0 }
    }

    // PostgREST: "Could not find the 'X' column of 'produtos' in the schema cache"
    const match = error.message.match(/Could not find the '([^']+)' column/i)
    if (match) {
      colunasInexistentes.add(match[1])
      payload = stripColunas(payload)
      continue
    }
    return { inseridos: 0, erro: error.message }
  }
  return { inseridos: 0, erro: 'Excedido limite de retentativas adaptando ao schema' }
}

export async function adminProdutosRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authAdmin)

  /**
   * GET /admin/produtos?empresa_id=...&tipo=...
   *
   * O Supabase tem um limite de 1000 rows por request (config global). Para
   * suportar empresas com 20k+ produtos, fazemos paginação interna em loop
   * até esgotar — e devolvemos tudo de uma vez pro cliente paginar/filtrar
   * do lado dele.
   */
  app.get('/produtos', async (req, reply) => {
    const { empresa_id, tipo, ativo } = req.query as {
      empresa_id?: string
      tipo?: string
      ativo?: string
    }

    const PAGE_SIZE = 1000
    const MAX_TOTAL = 100_000 // limite de segurança
    const acumulado: Record<string, unknown>[] = []
    let offset = 0

    while (offset < MAX_TOTAL) {
      let q = supabase
        .from('produtos')
        .select('*')
        .order('descricao')
        .range(offset, offset + PAGE_SIZE - 1)
      if (empresa_id) q = q.eq('empresa_id', empresa_id)
      if (tipo) q = q.eq('tipo', tipo)
      if (ativo !== undefined) q = q.eq('ativo', ativo !== 'false')

      const { data, error } = await q
      if (error) return reply.status(500).send({ error: error.message })
      if (!data || data.length === 0) break
      acumulado.push(...data)
      if (data.length < PAGE_SIZE) break // última página
      offset += PAGE_SIZE
    }

    return acumulado
  })

  /** GET /admin/produtos/:id */
  app.get<{ Params: { id: string } }>('/produtos/:id', async (req, reply) => {
    const { data } = await supabase
      .from('produtos')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle()
    if (!data) return reply.status(404).send({ error: 'Produto não encontrado' })
    return data
  })

  /** POST /admin/produtos */
  app.post('/produtos', async (req, reply) => {
    const parsed = produtoSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }
    const { data, error } = await supabase
      .from('produtos')
      .insert(cleanEmptyStrings(parsed.data))
      .select()
      .single()
    if (error) return reply.status(500).send({ error: error.message })

    // Log: criação individual
    if (data) {
      await logAcao({
        empresaId: (data as { empresa_id: string }).empresa_id,
        entidade: 'produto',
        entidadeId: (data as { id: string }).id,
        tipoAcao: 'criar',
        descricao: `Criou produto "${(data as { descricao: string }).descricao}"`,
        payloadDepois: data as Record<string, unknown>,
      })
    }
    return reply.status(201).send(data)
  })

  /** PATCH /admin/produtos/:id */
  app.patch<{ Params: { id: string } }>('/produtos/:id', async (req, reply) => {
    const parsed = produtoSchema.partial().safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }

    // Snapshot ANTES (pra audit log)
    const { data: antes } = await supabase
      .from('produtos')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle()

    const payload = cleanEmptyStrings({ ...parsed.data, updated_at: new Date().toISOString() })
    const { data, error } = await supabase
      .from('produtos')
      .update(payload)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) return reply.status(500).send({ error: error.message })

    // Audit log — toggle ativo/desativado é uma ação simples; outras mudanças = "editar"
    if (antes && data) {
      const empresaId = (antes as { empresa_id: string }).empresa_id
      const descricao = (antes as { descricao: string }).descricao
      const mudouSomenteAtivo =
        Object.keys(parsed.data).length === 1 && 'ativo' in parsed.data
      const mudouSomenteArquivado =
        Object.keys(parsed.data).length === 1 && 'arquivado' in parsed.data
      if (mudouSomenteAtivo) {
        await logAcao({
          empresaId,
          entidade: 'produto',
          entidadeId: req.params.id,
          tipoAcao: parsed.data.ativo ? 'ativar' : 'desativar',
          descricao: `${parsed.data.ativo ? 'Ativou' : 'Desativou'} produto "${descricao}"`,
        })
      } else if (mudouSomenteArquivado) {
        await logAcao({
          empresaId,
          entidade: 'produto',
          entidadeId: req.params.id,
          tipoAcao: parsed.data.arquivado ? 'arquivar' : 'desarquivar',
          descricao: `${parsed.data.arquivado ? 'Arquivou' : 'Desarquivou'} produto "${descricao}"`,
        })
      } else {
        await logAcao({
          empresaId,
          entidade: 'produto',
          entidadeId: req.params.id,
          tipoAcao: 'editar',
          descricao: `Editou produto "${descricao}"`,
          payloadAntes: antes as Record<string, unknown>,
          payloadDepois: data as Record<string, unknown>,
        })
      }
    }
    return data
  })

  /**
   * DELETE /admin/produtos/:id
   *
   * Se o produto já foi usado em vendas/notas/OS, o Postgres devolve violação
   * de FK (code 23503). Nesse caso retornamos 409 com sugestão de inativar.
   */
  app.delete<{ Params: { id: string } }>('/produtos/:id', async (req, reply) => {
    const { error } = await supabase.from('produtos').delete().eq('id', req.params.id)
    if (error) {
      const msg = error.message || ''
      // Postgres FK violation
      const ehFkViolation = (error as { code?: string }).code === '23503'
        || /foreign key|violates foreign|notas_fiscais_itens|vendas_itens|ordens_servico_itens|produtos_config_fiscal/i.test(msg)
      if (ehFkViolation) {
        return reply.status(409).send({
          error: 'Produto já foi usado em vendas, notas fiscais ou ordens de serviço. Não pode ser excluído pra preservar o histórico fiscal. Inative o produto pra escondê-lo da lista.',
          codigo: 'FK_VIOLATION',
          sugestao: 'inativar',
        })
      }
      return reply.status(500).send({ error: msg })
    }
    return reply.status(204).send()
  })

  /**
   * POST /admin/produtos/:id/inativar
   *
   * Marca arquivado=true. Se a migration 019 ainda não foi aplicada (coluna
   * arquivado inexistente), faz fallback pra ativo=false (comportamento antigo).
   */
  app.post<{ Params: { id: string } }>('/produtos/:id/inativar', async (req, reply) => {
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('produtos')
      .update({ arquivado: true, updated_at: now })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return reply.status(500).send({ error: error.message })

    if (data) {
      await logAcao({
        empresaId: (data as { empresa_id: string }).empresa_id,
        entidade: 'produto',
        entidadeId: req.params.id,
        tipoAcao: 'arquivar',
        descricao: `Arquivou produto "${(data as { descricao: string }).descricao}"`,
      })
    }
    return data
  })

  /** POST /admin/produtos/:id/restaurar — desarquiva (volta pra Ativos) */
  app.post<{ Params: { id: string } }>('/produtos/:id/restaurar', async (req, reply) => {
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('produtos')
      .update({ arquivado: false, ativo: true, updated_at: now })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return reply.status(500).send({ error: error.message })

    if (data) {
      await logAcao({
        empresaId: (data as { empresa_id: string }).empresa_id,
        entidade: 'produto',
        entidadeId: req.params.id,
        tipoAcao: 'desarquivar',
        descricao: `Restaurou produto "${(data as { descricao: string }).descricao}"`,
      })
    }
    return data
  })

  /**
   * POST /admin/produtos/bulk-action — ações em lote sobre IDs selecionados.
   *
   * Body: { ids: string[], acao: 'ativar'|'desativar'|'arquivar'|'desarquivar'|'remover' }
   *
   * Resposta: { sucesso, falhas, total, acao }.
   * Registra UMA entrada no audit_log com `metadata.ids_afetados` pra permitir reverter.
   */
  app.post('/produtos/bulk-action', async (req, reply) => {
    const bulkActionSchema = z.object({
      ids: z.array(z.string().uuid()).min(1).max(50000),
      acao: z.enum(['ativar', 'desativar', 'arquivar', 'desarquivar', 'remover']),
    })
    const parsed = bulkActionSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }
    const { ids, acao } = parsed.data

    // Pega empresa_id de 1 produto. Evita SELECT em massa que estoura URL.
    const { data: amostra, error: amErr } = await supabase
      .from('produtos')
      .select('empresa_id')
      .eq('id', ids[0])
      .maybeSingle()
    if (amErr || !amostra) {
      return reply.status(404).send({ error: 'Nenhum produto encontrado para esses IDs' })
    }
    const empresaId = amostra.empresa_id as string
    let sucesso = 0
    const falhas: Array<{ id: string; erro: string }> = []

    const CHUNK = 500
    const update =
      acao === 'ativar'      ? { ativo: true,    updated_at: new Date().toISOString() } :
      acao === 'desativar'   ? { ativo: false,   updated_at: new Date().toISOString() } :
      acao === 'arquivar'    ? { arquivado: true,  updated_at: new Date().toISOString() } :
      acao === 'desarquivar' ? { arquivado: false, ativo: true, updated_at: new Date().toISOString() } :
      null

    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK)
      try {
        if (acao === 'remover') {
          const { error } = await supabase.from('produtos').delete().in('id', slice)
          if (error) throw new Error(error.message)
          sucesso += slice.length
        } else {
          const { error } = await supabase.from('produtos').update(update!).in('id', slice)
          if (error) throw new Error(error.message)
          sucesso += slice.length
        }
      } catch (e) {
        void e
        // Lote falhou — linha-a-linha pra isolar (típico: FK em delete)
        for (const id of slice) {
          try {
            if (acao === 'remover') {
              const r = await supabase.from('produtos').delete().eq('id', id)
              if (r.error) throw new Error(r.error.message)
            } else {
              const r = await supabase.from('produtos').update(update!).eq('id', id)
              if (r.error) throw new Error(r.error.message)
            }
            sucesso++
          } catch (e2) {
            falhas.push({ id, erro: (e2 as Error).message })
          }
        }
      }
    }

    // Audit log: uma única entrada com metadata.ids_afetados (permite reverter o lote inteiro)
    if (sucesso > 0) {
      const palavras: Record<string, string> = {
        ativar: 'ativados', desativar: 'desativados',
        arquivar: 'arquivados', desarquivar: 'restaurados', remover: 'removidos',
      }
      await logAcao({
        empresaId,
        entidade: 'produto',
        tipoAcao: `lote_${acao}` as 'arquivar', // reusa o discriminador; reverter sabe lidar
        descricao: `Ação em lote: ${sucesso} produto${sucesso > 1 ? 's' : ''} ${palavras[acao]}`,
        metadata: { ids_afetados: ids.filter((id) => !falhas.find((f) => f.id === id)), acao },
        reversivel: acao !== 'remover',
      })
    }

    return { acao, total: ids.length, sucesso, falhas }
  })

  /**
   * POST /admin/produtos/bulk — importação em massa via planilha.
   *
   * Validação **linha por linha** (ao invés de z.array) para reportar
   * exatamente quais registros falharam e por quê. Aceita até 10k por
   * requisição — o cliente é responsável por dividir em lotes.
   */
  app.post('/produtos/bulk', async (req, reply) => {
    const body = req.body as { produtos?: unknown[] } | undefined
    if (!body?.produtos || !Array.isArray(body.produtos) || body.produtos.length === 0) {
      return reply.status(400).send({ error: 'Envie um array "produtos"' })
    }
    if (body.produtos.length > 10_000) {
      return reply.status(400).send({
        error: `Máximo 10000 produtos por requisição (recebido ${body.produtos.length}). Divida em lotes menores.`,
      })
    }

    // 1. Valida linha por linha
    const validos: Record<string, unknown>[] = []
    const falhas: Array<{ linha: number; erro: string }> = []
    body.produtos.forEach((raw, idx) => {
      const result = produtoSchema.safeParse(raw)
      if (!result.success) {
        const issue = result.error.issues[0]
        const campo = issue.path.length > 0 ? issue.path.join('.') : '?'
        falhas.push({ linha: idx + 1, erro: `${campo}: ${issue.message}` })
        return
      }
      validos.push(cleanEmptyStrings(result.data))
    })

    // 2. Insere em lotes — adaptando ao schema real do banco
    const colunasInexistentes = new Set<string>()
    const idsAfetados: string[] = []
    let inseridos = 0
    const LOTE = 500
    for (let i = 0; i < validos.length; i += LOTE) {
      const slice = validos.slice(i, i + LOTE)
      const res = await insertProdutosAdaptive(slice, colunasInexistentes, idsAfetados)
      if (res.erro) {
        for (let j = 0; j < slice.length; j++) {
          const r = await insertProdutosAdaptive([slice[j]], colunasInexistentes, idsAfetados)
          if (r.erro) falhas.push({ linha: i + j + 1, erro: r.erro })
          else inseridos += r.inseridos
        }
      } else {
        inseridos += res.inseridos
      }
    }

    // 3. Audit log da importação em massa (permite reverter via arquivamento)
    if (inseridos > 0 && validos[0]?.empresa_id) {
      await logAcao({
        empresaId: validos[0].empresa_id as string,
        entidade: 'produto',
        tipoAcao: 'importar_massa',
        descricao: `Importou ${inseridos} produto${inseridos > 1 ? 's' : ''} em massa via xlsx`,
        metadata: { quantidade: inseridos, ids_afetados: idsAfetados },
      })
    }

    return {
      total: body.produtos.length,
      inseridos,
      falhas,
      colunas_ignoradas: colunasInexistentes.size > 0 ? [...colunasInexistentes] : undefined,
    }
  })
}
