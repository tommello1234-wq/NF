/**
 * Vendas — espelha o módulo de Vendas do ssÓtica.
 *
 * Fluxo:
 *   1. Cria Venda (rascunho) com itens.
 *   2. Marca como `paga` quando o pagamento for confirmado.
 *   3. Se `emitir_nfce_automatico=true` (default), dispara emissão NFC-e
 *      automaticamente e vincula a `nota_fiscal_id` da venda.
 *
 * Os requisitos: empresa com certificado + CSC + natureza de operação default
 * configurados.
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '../services/supabase.js'
import { authAdmin } from '../middleware/authAdmin.js'
import { emitirNfe } from '../services/nfe/orquestrador.js'
import type { NfeInput } from '../services/nfe/types.js'

const itemVendaSchema = z.object({
  produto_id: z.string().uuid(),
  quantidade: z.coerce.number().positive(),
  valor_unitario: z.coerce.number().nonnegative().optional(),
  desconto: z.coerce.number().nonnegative().optional(),
  acrescimo: z.coerce.number().nonnegative().optional(),
})

const pagamentoVendaSchema = z.object({
  forma_pagamento: z.string(),
  valor: z.coerce.number().positive(),
  parcelas: z.coerce.number().int().min(1).optional(),
  primeiro_vencimento: z.string().optional().nullable(),
  codigo_autorizacao: z.string().optional().nullable(),
})

const vendaSchema = z.object({
  empresa_id: z.string().uuid(),
  cliente_id: z.string().uuid().optional().nullable(),
  os_id: z.string().uuid().optional().nullable(),
  funcionario: z.string().max(120).optional().nullable(),
  observacao: z.string().optional().nullable(),
  origem_cliente: z.string().optional().nullable(),
  itens: z.array(itemVendaSchema).min(1),
  pagamentos: z.array(pagamentoVendaSchema).optional().default([]),
  emitir_nfce_automatico: z.boolean().optional().default(true),
  natureza_operacao_id: z.string().uuid().optional().nullable(),
})

export async function adminVendasRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authAdmin)

  /** GET /admin/vendas?empresa_id=...&status=... */
  app.get('/vendas', async (req, reply) => {
    const { empresa_id, status } = req.query as { empresa_id?: string; status?: string }
    let q = supabase
      .from('vendas')
      .select('*, clientes(nome, cpf_cnpj), empresas(nome, razao_social), notas_fiscais(id, status, numero, chave_acesso, qr_code_nfce)')
      .order('created_at', { ascending: false })
    if (empresa_id) q = q.eq('empresa_id', empresa_id)
    if (status) q = q.eq('status', status)
    const { data, error } = await q
    if (error) return reply.status(500).send({ error: error.message })
    return data || []
  })

  /** GET /admin/vendas/:id */
  app.get<{ Params: { id: string } }>('/vendas/:id', async (req, reply) => {
    const { data, error } = await supabase
      .from('vendas')
      .select('*, clientes(*), empresas(nome, razao_social, cnpj), vendas_itens(*, produtos(descricao, ncm)), vendas_pagamentos(*), notas_fiscais(*)')
      .eq('id', req.params.id)
      .maybeSingle()
    if (error) return reply.status(500).send({ error: error.message })
    if (!data) return reply.status(404).send({ error: 'Venda não encontrada' })
    return data
  })

  /**
   * POST /admin/vendas
   * Cria a venda + itens. Se emitir_nfce_automatico=true, já dispara a NFC-e.
   */
  app.post('/vendas', async (req, reply) => {
    const parsed = vendaSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() })
    }
    const body = parsed.data

    // Calcula totais a partir dos itens
    const { data: produtos } = await supabase
      .from('produtos')
      .select('id, descricao, valor_unitario, unidade')
      .in('id', body.itens.map((i) => i.produto_id))

    if (!produtos?.length) return reply.status(400).send({ error: 'Nenhum produto encontrado' })

    const prodMap = new Map(produtos.map((p) => [p.id, p]))
    const itensCalculados = body.itens.map((i) => {
      const p = prodMap.get(i.produto_id)!
      const valorUnit = i.valor_unitario ?? Number(p.valor_unitario || 0)
      const subtotal = valorUnit * i.quantidade
      const desc = i.desconto || 0
      const acr = i.acrescimo || 0
      return {
        produto_id: i.produto_id,
        descricao: p.descricao,
        quantidade: i.quantidade,
        valor_unitario: valorUnit,
        desconto: desc,
        acrescimo: acr,
        valor_total: subtotal - desc + acr,
      }
    })
    const valorProdutos = itensCalculados.reduce((s, i) => s + (i.valor_unitario * i.quantidade), 0)
    const valorDesconto = itensCalculados.reduce((s, i) => s + i.desconto, 0)
    const valorAcrescimo = itensCalculados.reduce((s, i) => s + i.acrescimo, 0)
    const valorTotal = valorProdutos - valorDesconto + valorAcrescimo

    // 1. Cria a venda (rascunho)
    const { data: venda, error: vErr } = await supabase
      .from('vendas')
      .insert({
        empresa_id: body.empresa_id,
        cliente_id: body.cliente_id || null,
        os_id: body.os_id || null,
        funcionario: body.funcionario || null,
        observacao: body.observacao || null,
        origem_cliente: body.origem_cliente || null,
        valor_produtos: valorProdutos,
        valor_desconto: valorDesconto,
        valor_acrescimo: valorAcrescimo,
        valor_total: valorTotal,
        status: 'rascunho',
        emitir_nfce_automatico: body.emitir_nfce_automatico,
        forma_pagamento_padrao: body.pagamentos[0]?.forma_pagamento || null,
      })
      .select()
      .single()

    if (vErr || !venda) {
      return reply.status(500).send({ error: `Falha ao criar venda: ${vErr?.message}` })
    }

    // 2. Salva itens
    const itensInsert = itensCalculados.map((i) => ({ venda_id: venda.id, ...i }))
    await supabase.from('vendas_itens').insert(itensInsert)

    // 3. Pagamentos
    if (body.pagamentos.length > 0) {
      await supabase.from('vendas_pagamentos').insert(
        body.pagamentos.map((p) => ({
          venda_id: venda.id,
          forma_pagamento: p.forma_pagamento,
          valor: p.valor,
          parcelas: p.parcelas || 1,
          primeiro_vencimento: p.primeiro_vencimento || null,
          codigo_autorizacao: p.codigo_autorizacao || null,
        })),
      )
    }

    // 4. Emite NFC-e automaticamente (se habilitado e tem natureza)
    let nfceResultado: unknown = null
    if (body.emitir_nfce_automatico) {
      try {
        // Resolve natureza: usa a fornecida ou a primeira ativa "venda" da empresa
        let naturezaId = body.natureza_operacao_id
        if (!naturezaId) {
          const { data: nat } = await supabase
            .from('naturezas_operacao')
            .select('id')
            .eq('empresa_id', body.empresa_id)
            .eq('ativo', true)
            .limit(1)
            .maybeSingle()
          naturezaId = nat?.id || null
        }
        if (!naturezaId) {
          throw new Error('Empresa sem natureza de operação ativa cadastrada')
        }

        const formaPagamento = (body.pagamentos[0]?.forma_pagamento || '01') as NfeInput['pagamento']['forma']
        const valorPago = body.pagamentos.reduce((s, p) => s + p.valor, 0) || valorTotal

        const input: NfeInput = {
          empresaId: body.empresa_id,
          modelo: 65,                 // NFC-e
          naturezaOperacaoId: naturezaId,
          clienteId: body.cliente_id || undefined,
          itens: body.itens.map((i) => ({
            produtoId: i.produto_id,
            quantidade: i.quantidade,
            valorUnitario: i.valor_unitario,
            valorDesconto: i.desconto,
          })),
          pagamento: {
            forma: formaPagamento,
            valor: valorPago,
            troco: valorPago > valorTotal ? valorPago - valorTotal : undefined,
          },
          informacoesComplementares: body.observacao || undefined,
          tipoDocumento: 'venda',
        }

        const result = await emitirNfe(input)
        nfceResultado = result

        // Vincula a nota à venda + atualiza status
        if (result.notaId) {
          await supabase
            .from('vendas')
            .update({
              nota_fiscal_id: result.notaId,
              status: result.status === 'autorizada' ? 'paga' : 'aberta',
            })
            .eq('id', venda.id)
        }
      } catch (e) {
        nfceResultado = { error: (e as Error).message }
      }
    } else {
      // Sem emissão automática — venda fica em "aberta"
      await supabase.from('vendas').update({ status: 'aberta' }).eq('id', venda.id)
    }

    return reply.send({ venda_id: venda.id, nfce: nfceResultado })
  })

  /** POST /admin/vendas/:id/emitir-nfce — emite NFC-e manualmente p/ uma venda existente */
  app.post<{ Params: { id: string }; Body: { natureza_operacao_id?: string } }>(
    '/vendas/:id/emitir-nfce',
    async (req, reply) => {
      const { data: venda, error } = await supabase
        .from('vendas')
        .select('*, vendas_itens(*), vendas_pagamentos(*)')
        .eq('id', req.params.id)
        .maybeSingle()
      if (error || !venda) {
        return reply.status(404).send({ error: 'Venda não encontrada' })
      }
      if (venda.nota_fiscal_id) {
        return reply.status(400).send({ error: 'Venda já tem NFC-e vinculada' })
      }

      let naturezaId = req.body?.natureza_operacao_id
      if (!naturezaId) {
        const { data: nat } = await supabase
          .from('naturezas_operacao')
          .select('id')
          .eq('empresa_id', venda.empresa_id)
          .eq('ativo', true)
          .limit(1)
          .maybeSingle()
        naturezaId = nat?.id
      }
      if (!naturezaId) {
        return reply.status(400).send({ error: 'Empresa sem natureza de operação ativa' })
      }

      try {
        const formaPagamento = (venda.vendas_pagamentos?.[0]?.forma_pagamento || '01') as NfeInput['pagamento']['forma']
        const valorPago = (venda.vendas_pagamentos || []).reduce((s: number, p: { valor: number }) => s + Number(p.valor), 0) || Number(venda.valor_total)

        const result = await emitirNfe({
          empresaId: venda.empresa_id,
          modelo: 65,
          naturezaOperacaoId: naturezaId,
          clienteId: venda.cliente_id || undefined,
          itens: (venda.vendas_itens || []).map((it: { produto_id: string; quantidade: number; valor_unitario: number; desconto: number }) => ({
            produtoId: it.produto_id,
            quantidade: Number(it.quantidade),
            valorUnitario: Number(it.valor_unitario),
            valorDesconto: Number(it.desconto || 0),
          })),
          pagamento: { forma: formaPagamento, valor: valorPago },
          informacoesComplementares: venda.observacao || undefined,
          tipoDocumento: 'venda',
        })

        if (result.notaId) {
          await supabase
            .from('vendas')
            .update({
              nota_fiscal_id: result.notaId,
              status: result.status === 'autorizada' ? 'paga' : 'aberta',
            })
            .eq('id', venda.id)
        }
        return result
      } catch (e) {
        return reply.status(500).send({ error: (e as Error).message })
      }
    },
  )

  /** PATCH /admin/vendas/:id — atualiza status / observação */
  app.patch<{ Params: { id: string }; Body: { status?: string; observacao?: string | null } }>(
    '/vendas/:id',
    async (req, reply) => {
      const { status, observacao } = req.body || {}
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (status) update.status = status
      if (observacao !== undefined) update.observacao = observacao
      const { data, error } = await supabase
        .from('vendas')
        .update(update)
        .eq('id', req.params.id)
        .select()
        .maybeSingle()
      if (error) return reply.status(500).send({ error: error.message })
      return data
    },
  )

  /** DELETE /admin/vendas/:id — só permite excluir se não tem NF vinculada */
  app.delete<{ Params: { id: string } }>('/vendas/:id', async (req, reply) => {
    const { data: venda } = await supabase
      .from('vendas')
      .select('nota_fiscal_id')
      .eq('id', req.params.id)
      .maybeSingle()
    if (venda?.nota_fiscal_id) {
      return reply.status(400).send({
        error: 'Venda com NF vinculada não pode ser excluída — cancele a NF primeiro',
      })
    }
    const { error } = await supabase.from('vendas').delete().eq('id', req.params.id)
    if (error) return reply.status(500).send({ error: error.message })
    return { ok: true }
  })
}
