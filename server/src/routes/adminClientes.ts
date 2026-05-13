import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '../services/supabase.js'
import { authAdmin } from '../middleware/authAdmin.js'
import { logAcao } from '../services/auditLog.js'

/**
 * Limpa valores que claramente não são emails (espaços, texto avulso, acentuação,
 * formato inválido, etc). Retorna string limpa se passa pelo validator do Zod,
 * ou null caso contrário — assim a importação NUNCA falha por email ruim.
 */
const emailValidator = z.string().email()
const emailPreprocess = (v: unknown) => {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  return emailValidator.safeParse(s).success ? s : null
}

const clienteSchema = z.object({
  empresa_id: z.string().uuid(),
  // ÚNICO obrigatório — qualquer outro campo é opcional/nullable
  nome: z.string().min(1, 'Nome é obrigatório'),
  cpf_cnpj: z.string().optional().nullable(),
  ie: z.string().optional().nullable(),
  // Email: aceita qualquer valor, mas se for inválido vira null antes de validar
  email: z.preprocess(emailPreprocess, z.string().email().nullable().optional()),
  telefone: z.string().optional().nullable(),
  endereco_logradouro: z.string().optional().nullable(),
  endereco_numero: z.string().optional().nullable(),
  endereco_bairro: z.string().optional().nullable(),
  endereco_cidade: z.string().optional().nullable(),
  // UF: aceita 2 chars OU vazio/null
  endereco_uf: z.preprocess(
    (v) => (v == null || v === '' ? null : String(v).trim().toUpperCase().slice(0, 2)),
    z.string().length(2).nullable().optional(),
  ),
  endereco_cep: z.string().optional().nullable(),
  endereco_codigo_ibge: z.string().optional().nullable(),
  ativo: z.boolean().optional(),
  arquivado: z.boolean().optional(),
})

export async function adminClientesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authAdmin)

  /** GET /admin/clientes?empresa_id=... */
  app.get('/clientes', async (req, reply) => {
    const { empresa_id, ativo } = req.query as { empresa_id?: string; ativo?: string }

    // Paginação interna em loop pra burlar o limite de 1000 rows do Supabase.
    const PAGE_SIZE = 1000
    const MAX_TOTAL = 100_000
    const acumulado: Record<string, unknown>[] = []
    let offset = 0

    while (offset < MAX_TOTAL) {
      let q = supabase
        .from('clientes')
        .select('*')
        .order('nome')
        .range(offset, offset + PAGE_SIZE - 1)
      if (empresa_id) q = q.eq('empresa_id', empresa_id)
      if (ativo !== undefined) q = q.eq('ativo', ativo !== 'false')

      const { data, error } = await q
      if (error) return reply.status(500).send({ error: error.message })
      if (!data || data.length === 0) break
      acumulado.push(...data)
      if (data.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }

    return acumulado
  })

  /** GET /admin/clientes/:id */
  app.get<{ Params: { id: string } }>('/clientes/:id', async (req, reply) => {
    const { data } = await supabase
      .from('clientes')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle()
    if (!data) return reply.status(404).send({ error: 'Cliente não encontrado' })
    return data
  })

  /** POST /admin/clientes */
  app.post('/clientes', async (req, reply) => {
    const parsed = clienteSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }
    const payload = {
      ...parsed.data,
      cpf_cnpj: parsed.data.cpf_cnpj ? parsed.data.cpf_cnpj.replace(/\D/g, '') : null,
      email: parsed.data.email || null,
    }
    const { data, error } = await supabase
      .from('clientes')
      .insert(payload)
      .select()
      .single()
    if (error) return reply.status(500).send({ error: error.message })

    if (data) {
      await logAcao({
        empresaId: (data as { empresa_id: string }).empresa_id,
        entidade: 'cliente',
        entidadeId: (data as { id: string }).id,
        tipoAcao: 'criar',
        descricao: `Cadastrou cliente "${(data as { nome: string }).nome}"`,
        payloadDepois: data as Record<string, unknown>,
      })
    }
    return reply.status(201).send(data)
  })

  /** PATCH /admin/clientes/:id */
  app.patch<{ Params: { id: string } }>('/clientes/:id', async (req, reply) => {
    const parsed = clienteSchema.partial().safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }

    const { data: antes } = await supabase
      .from('clientes')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle()

    const payload: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() }
    if (parsed.data.cpf_cnpj) payload.cpf_cnpj = parsed.data.cpf_cnpj.replace(/\D/g, '')
    if (parsed.data.email === '') payload.email = null

    const { data, error } = await supabase
      .from('clientes')
      .update(payload)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) return reply.status(500).send({ error: error.message })

    if (antes && data) {
      const empresaId = (antes as { empresa_id: string }).empresa_id
      const nome = (antes as { nome: string }).nome
      const mudouSomenteAtivo = Object.keys(parsed.data).length === 1 && 'ativo' in parsed.data
      const mudouSomenteArquivado = Object.keys(parsed.data).length === 1 && 'arquivado' in parsed.data
      if (mudouSomenteAtivo) {
        await logAcao({
          empresaId,
          entidade: 'cliente',
          entidadeId: req.params.id,
          tipoAcao: parsed.data.ativo ? 'ativar' : 'desativar',
          descricao: `${parsed.data.ativo ? 'Ativou' : 'Desativou'} cliente "${nome}"`,
        })
      } else if (mudouSomenteArquivado) {
        await logAcao({
          empresaId,
          entidade: 'cliente',
          entidadeId: req.params.id,
          tipoAcao: parsed.data.arquivado ? 'arquivar' : 'desarquivar',
          descricao: `${parsed.data.arquivado ? 'Arquivou' : 'Desarquivou'} cliente "${nome}"`,
        })
      } else {
        await logAcao({
          empresaId,
          entidade: 'cliente',
          entidadeId: req.params.id,
          tipoAcao: 'editar',
          descricao: `Editou cliente "${nome}"`,
          payloadAntes: antes as Record<string, unknown>,
          payloadDepois: data as Record<string, unknown>,
        })
      }
    }
    return data
  })

  /**
   * DELETE /admin/clientes/:id
   *
   * Se o cliente já foi usado em vendas/notas, FK rejeita o delete.
   * Devolvemos 409 com sugestão de inativar pra preservar histórico fiscal.
   */
  app.delete<{ Params: { id: string } }>('/clientes/:id', async (req, reply) => {
    const { error } = await supabase.from('clientes').delete().eq('id', req.params.id)
    if (error) {
      const msg = error.message || ''
      const ehFkViolation = (error as { code?: string }).code === '23503'
        || /foreign key|violates foreign|notas_fiscais|vendas|ordens_servico/i.test(msg)
      if (ehFkViolation) {
        return reply.status(409).send({
          error: 'Cliente já foi usado em vendas, notas fiscais ou ordens de serviço. Não pode ser excluído. Inative-o pra escondê-lo da lista.',
          codigo: 'FK_VIOLATION',
          sugestao: 'inativar',
        })
      }
      return reply.status(500).send({ error: msg })
    }
    return reply.status(204).send()
  })

  /** POST /admin/clientes/:id/inativar — arquiva o cliente. */
  app.post<{ Params: { id: string } }>('/clientes/:id/inativar', async (req, reply) => {
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('clientes')
      .update({ arquivado: true, updated_at: now })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return reply.status(500).send({ error: error.message })
    if (data) {
      await logAcao({
        empresaId: (data as { empresa_id: string }).empresa_id,
        entidade: 'cliente',
        entidadeId: req.params.id,
        tipoAcao: 'arquivar',
        descricao: `Arquivou cliente "${(data as { nome: string }).nome}"`,
      })
    }
    return data
  })

  /** POST /admin/clientes/:id/restaurar — desarquiva. */
  app.post<{ Params: { id: string } }>('/clientes/:id/restaurar', async (req, reply) => {
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('clientes')
      .update({ arquivado: false, ativo: true, updated_at: now })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return reply.status(500).send({ error: error.message })
    if (data) {
      await logAcao({
        empresaId: (data as { empresa_id: string }).empresa_id,
        entidade: 'cliente',
        entidadeId: req.params.id,
        tipoAcao: 'desarquivar',
        descricao: `Restaurou cliente "${(data as { nome: string }).nome}"`,
      })
    }
    return data
  })

  /**
   * POST /admin/clientes/bulk-action — ações em lote.
   * Body: { ids: string[], acao: 'ativar'|'desativar'|'arquivar'|'desarquivar'|'remover' }
   */
  app.post('/clientes/bulk-action', async (req, reply) => {
    const schema = z.object({
      ids: z.array(z.string().uuid()).min(1).max(50000),
      acao: z.enum(['ativar', 'desativar', 'arquivar', 'desarquivar', 'remover']),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }
    const { ids, acao } = parsed.data

    // Pega empresa_id de UM cliente (suficiente pro log). Evita SELECT massivo
    // que estouraria o limite de URL do PostgREST com 1000+ UUIDs.
    const { data: amostra, error: amErr } = await supabase
      .from('clientes')
      .select('empresa_id')
      .eq('id', ids[0])
      .maybeSingle()
    if (amErr || !amostra) {
      return reply.status(404).send({ error: 'Nenhum cliente encontrado com os IDs informados' })
    }
    const empresaId = amostra.empresa_id as string
    let sucesso = 0
    const falhas: Array<{ id: string; erro: string }> = []

    // PostgREST tem limite de URL — lotamos em chunks de 500 IDs por query.
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
          const { error } = await supabase.from('clientes').delete().in('id', slice)
          if (error) throw new Error(error.message)
          sucesso += slice.length
        } else {
          const { error } = await supabase.from('clientes').update(update!).in('id', slice)
          if (error) throw new Error(error.message)
          sucesso += slice.length
        }
      } catch (e) {
        void e
        // Lote falhou — vai linha-a-linha pra isolar quem deu erro (FK em delete, etc)
        for (const id of slice) {
          try {
            if (acao === 'remover') {
              const r = await supabase.from('clientes').delete().eq('id', id)
              if (r.error) throw new Error(r.error.message)
            } else {
              const r = await supabase.from('clientes').update(update!).eq('id', id)
              if (r.error) throw new Error(r.error.message)
            }
            sucesso++
          } catch (e2) {
            falhas.push({ id, erro: (e2 as Error).message })
          }
        }
      }
    }

    if (sucesso > 0) {
      const palavras: Record<string, string> = {
        ativar: 'ativados', desativar: 'desativados',
        arquivar: 'arquivados', desarquivar: 'restaurados', remover: 'removidos',
      }
      await logAcao({
        empresaId,
        entidade: 'cliente',
        tipoAcao: `lote_${acao}` as 'arquivar',
        descricao: `Ação em lote: ${sucesso} cliente${sucesso > 1 ? 's' : ''} ${palavras[acao]}`,
        metadata: { ids_afetados: ids.filter((id) => !falhas.find((f) => f.id === id)), acao },
        reversivel: acao !== 'remover',
      })
    }

    return { acao, total: ids.length, sucesso, falhas }
  })

  /**
   * POST /admin/clientes/bulk — importação em massa via planilha.
   *
   * Estratégia: como não temos UNIQUE (empresa_id, cpf_cnpj), buscamos antes
   * todos os CPF/CNPJ já cadastrados pra essa empresa e classificamos:
   *   - novo → INSERT
   *   - já existe + modo='atualizar' → UPDATE (preenche/sobrescreve campos)
   *   - já existe + modo='pular' (default) → ignorado
   */
  app.post('/clientes/bulk', async (req, reply) => {
    const body = req.body as { clientes?: unknown[]; modo?: 'pular' | 'atualizar' } | undefined
    if (!body?.clientes || !Array.isArray(body.clientes) || body.clientes.length === 0) {
      return reply.status(400).send({ error: 'Envie um array "clientes"' })
    }
    if (body.clientes.length > 10_000) {
      return reply.status(400).send({
        error: `Máximo 10000 clientes por requisição (recebido ${body.clientes.length}). Divida em lotes menores.`,
      })
    }
    const modo: 'pular' | 'atualizar' = body.modo === 'atualizar' ? 'atualizar' : 'pular'

    // 1. Valida linha por linha pra reportar erros precisos
    const falhas: Array<{ linha: number; erro: string }> = []
    const registros: z.infer<typeof clienteSchema>[] = []
    body.clientes.forEach((raw, idx) => {
      const r = clienteSchema.safeParse(raw)
      if (!r.success) {
        const issue = r.error.issues[0]
        const campo = issue.path.length > 0 ? issue.path.join('.') : '?'
        falhas.push({ linha: idx + 1, erro: `${campo}: ${issue.message}` })
        return
      }
      registros.push({
        ...r.data,
        // Mantém só dígitos no CPF/CNPJ se vier preenchido; senão deixa null
        cpf_cnpj: r.data.cpf_cnpj ? r.data.cpf_cnpj.replace(/\D/g, '') : null,
        email: r.data.email || null,
      })
    })

    // Dedup só registra quem TEM cpf_cnpj. Quem não tem é sempre novo.
    const empresaIds = [...new Set(registros.map((r) => r.empresa_id))]
    const existentes = new Map<string, string>() // key=`${empresa_id}|${cpf}` → id
    for (const empId of empresaIds) {
      const documentos = registros
        .filter((r) => r.empresa_id === empId && r.cpf_cnpj)
        .map((r) => r.cpf_cnpj as string)
      if (documentos.length === 0) continue
      // PostgREST tem limite de URL; quebra em chunks de 500
      for (let i = 0; i < documentos.length; i += 500) {
        const slice = documentos.slice(i, i + 500)
        const { data } = await supabase
          .from('clientes')
          .select('id, cpf_cnpj, empresa_id')
          .eq('empresa_id', empId)
          .in('cpf_cnpj', slice)
        for (const c of data || []) {
          existentes.set(`${c.empresa_id}|${c.cpf_cnpj}`, c.id as string)
        }
      }
    }

    // Sem cpf_cnpj → sempre considera "novo"
    const novos = registros.filter((r) => !r.cpf_cnpj || !existentes.has(`${r.empresa_id}|${r.cpf_cnpj}`))
    const duplicados = registros.filter((r) => r.cpf_cnpj && existentes.has(`${r.empresa_id}|${r.cpf_cnpj}`))

    let inseridos = 0
    let atualizados = 0
    let pulados = 0

    // INSERTs em lotes (com auto-strip de colunas inexistentes no schema atual)
    const colunasInexistentes = new Set<string>()
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

    const idsAfetados: string[] = []
    async function insertAdaptive(slice: Record<string, unknown>[]): Promise<{ inseridos: number; erro?: string }> {
      let payload = stripColunas(slice)
      for (let tentativa = 0; tentativa < 60; tentativa++) {
        const { data, error } = await supabase.from('clientes').insert(payload).select('id')
        if (!error) {
          if (data) for (const r of data) idsAfetados.push((r as { id: string }).id)
          return { inseridos: data?.length || 0 }
        }
        const match = error.message.match(/Could not find the '([^']+)' column/i)
        if (match) {
          colunasInexistentes.add(match[1])
          payload = stripColunas(payload)
          continue
        }
        return { inseridos: 0, erro: error.message }
      }
      return { inseridos: 0, erro: 'Limite de retentativas excedido' }
    }

    const LOTE = 500
    for (let i = 0; i < novos.length; i += LOTE) {
      const slice = novos.slice(i, i + LOTE)
      const res = await insertAdaptive(slice)
      if (res.erro) {
        for (let j = 0; j < slice.length; j++) {
          const r = await insertAdaptive([slice[j]])
          if (r.erro) falhas.push({ linha: i + j + 1, erro: r.erro })
          else inseridos += r.inseridos
        }
      } else {
        inseridos += res.inseridos
      }
    }

    // UPDATEs (se modo='atualizar')
    if (modo === 'atualizar') {
      for (const reg of duplicados) {
        const id = existentes.get(`${reg.empresa_id}|${reg.cpf_cnpj}`)
        if (!id) continue
        try {
          const { error } = await supabase
            .from('clientes')
            .update({ ...reg, updated_at: new Date().toISOString() })
            .eq('id', id)
          if (error) throw new Error(error.message)
          atualizados += 1
        } catch (e2) {
          falhas.push({ linha: 0, erro: `${reg.cpf_cnpj}: ${(e2 as Error).message}` })
        }
      }
    } else {
      pulados = duplicados.length
    }

    // Audit log da importação em massa
    if (inseridos > 0 && registros[0]?.empresa_id) {
      await logAcao({
        empresaId: registros[0].empresa_id,
        entidade: 'cliente',
        tipoAcao: 'importar_massa',
        descricao: `Importou ${inseridos} cliente${inseridos > 1 ? 's' : ''} em massa via xlsx`,
        metadata: { quantidade: inseridos, ids_afetados: idsAfetados },
      })
    }

    return { total: body.clientes.length, inseridos, atualizados, pulados, falhas }
  })
}
