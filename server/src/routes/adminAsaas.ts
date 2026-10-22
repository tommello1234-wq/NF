import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { supabase } from '../services/supabase.js'
import { authAdmin } from '../middleware/authAdmin.js'
import { decryptSecret, encryptSecret } from '../services/crypto-utils.js'
import { AsaasApiError, buscarPagamento, ehChaveSandbox, listarClientes, listarCobrancasPorStatus, validarChave } from '../services/webhooks/asaas-client.js'
import { chaveEmissao, type AsaasPayment } from '../services/webhooks/asaas-types.js'
import { emitirPorPagamentoAsaas, reprocessarEventoAsaas } from '../services/webhooks/asaas-processar.js'

export async function adminAsaasRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authAdmin)

  /** GET /admin/empresas/:empresaId/asaas-config */
  app.get<{ Params: { empresaId: string } }>('/empresas/:empresaId/asaas-config', async (req, reply) => {
    const { data: empresa } = await supabase
      .from('empresas')
      .select(
        'id, nome, asaas_webhook_token_cifrado, asaas_api_key_cifrado, asaas_produto_default_id, produtos:asaas_produto_default_id(id, descricao, codigo_lc116, aliquota_iss, ativo)',
      )
      .eq('id', req.params.empresaId)
      .maybeSingle()
    if (!empresa) return reply.status(404).send({ error: 'Empresa não encontrada' })

    // O ambiente da chave é útil na tela (chave de sandbox em empresa de
    // produção nunca vai achar os clientes reais). A chave em si não sai daqui.
    let apiKeySandbox: boolean | null = null
    if (empresa.asaas_api_key_cifrado) {
      try {
        apiKeySandbox = ehChaveSandbox(decryptSecret(empresa.asaas_api_key_cifrado))
      } catch {
        apiKeySandbox = null
      }
    }

    return {
      empresa_id: empresa.id,
      empresa_nome: empresa.nome,
      token_configurado: !!empresa.asaas_webhook_token_cifrado,
      api_key_configurada: !!empresa.asaas_api_key_cifrado,
      api_key_sandbox: apiKeySandbox,
      webhook_path: `/webhooks/asaas/${empresa.id}`,
      produto_default_id: empresa.asaas_produto_default_id,
      produto_default: empresa.produtos || null,
    }
  })

  /**
   * POST /admin/empresas/:empresaId/asaas-token/gerar
   *
   * O token é gerado aqui, e não digitado: o Asaas exige pelo menos 32
   * caracteres e ninguém inventa isso bem à mão. Ele volta UMA vez, pra ser
   * colado no cadastro do webhook no Asaas; depois só existe cifrado. Gerar de
   * novo invalida o anterior — aí é preciso atualizar lá também.
   */
  app.post<{ Params: { empresaId: string } }>('/empresas/:empresaId/asaas-token/gerar', async (req, reply) => {
    const token = randomBytes(36).toString('base64url') // 48 caracteres
    const { error } = await supabase
      .from('empresas')
      .update({ asaas_webhook_token_cifrado: encryptSecret(token), updated_at: new Date().toISOString() })
      .eq('id', req.params.empresaId)
    if (error) return reply.status(500).send({ error: error.message })
    return { ok: true, token }
  })

  /** DELETE /admin/empresas/:empresaId/asaas-token — desliga o webhook */
  app.delete<{ Params: { empresaId: string } }>('/empresas/:empresaId/asaas-token', async (req, reply) => {
    const { error } = await supabase
      .from('empresas')
      .update({ asaas_webhook_token_cifrado: null, updated_at: new Date().toISOString() })
      .eq('id', req.params.empresaId)
    if (error) return reply.status(500).send({ error: error.message })
    return { ok: true }
  })

  /**
   * POST /admin/empresas/:empresaId/asaas-api-key { api_key }
   *
   * Testa a chave no Asaas ANTES de salvar — uma chave errada só apareceria
   * na primeira venda, como "não consegui buscar o cliente". Vazio = remove.
   */
  app.post<{ Params: { empresaId: string }; Body: { api_key?: string } }>(
    '/empresas/:empresaId/asaas-api-key',
    async (req, reply) => {
      const apiKey = (req.body?.api_key || '').trim()
      if (!apiKey) {
        const { error } = await supabase
          .from('empresas')
          .update({ asaas_api_key_cifrado: null, updated_at: new Date().toISOString() })
          .eq('id', req.params.empresaId)
        if (error) return reply.status(500).send({ error: error.message })
        return { ok: true, configurada: false }
      }
      if (!apiKey.startsWith('$aact_')) {
        return reply.status(400).send({
          error: 'Chave inválida. As chaves da API do Asaas começam com "$aact_".',
        })
      }

      let conta
      try {
        conta = await validarChave(apiKey)
      } catch (e) {
        const status = e instanceof AsaasApiError && e.status === 401 ? 400 : 502
        return reply.status(status).send({ error: (e as Error).message })
      }

      const { error } = await supabase
        .from('empresas')
        .update({ asaas_api_key_cifrado: encryptSecret(apiKey), updated_at: new Date().toISOString() })
        .eq('id', req.params.empresaId)
      if (error) return reply.status(500).send({ error: error.message })
      return { ok: true, configurada: true, conta: conta.nome, sandbox: conta.sandbox }
    },
  )

  /** POST /admin/empresas/:empresaId/asaas-produto-default { produto_id } */
  app.post<{ Params: { empresaId: string }; Body: { produto_id?: string | null } }>(
    '/empresas/:empresaId/asaas-produto-default',
    async (req, reply) => {
      const produtoId = (req.body?.produto_id || '').trim()
      if (!produtoId) {
        const { error } = await supabase
          .from('empresas')
          .update({ asaas_produto_default_id: null, updated_at: new Date().toISOString() })
          .eq('id', req.params.empresaId)
        if (error) return reply.status(500).send({ error: error.message })
        return { ok: true, configurado: false }
      }
      const { data: prod } = await supabase
        .from('produtos')
        .select('id, empresa_id')
        .eq('id', produtoId)
        .maybeSingle()
      if (!prod) return reply.status(404).send({ error: 'Produto não encontrado' })
      if (prod.empresa_id !== req.params.empresaId) {
        return reply.status(400).send({ error: 'Produto pertence a outra empresa' })
      }
      const { error } = await supabase
        .from('empresas')
        .update({ asaas_produto_default_id: produtoId, updated_at: new Date().toISOString() })
        .eq('id', req.params.empresaId)
      if (error) return reply.status(500).send({ error: error.message })
      return { ok: true, configurado: true, produto_id: produtoId }
    },
  )


  /**
   * GET /admin/empresas/:empresaId/asaas/sem-nota
   *
   * Vendas pagas no Asaas que não passaram pela integração — ou seja, sem
   * NFS-e emitida por ela. Só leitura. Serve pra dimensionar o passivo (o
   * contador decide o que fazer) e é a lista que um backfill vai percorrer.
   *
   * Uma venda = uma chave de emissão: parcelamento conta uma vez, pelo total
   * pago, na data da primeira parcela confirmada. Notas emitidas à mão (fora
   * da integração) não têm como ser cruzadas aqui e aparecem como pendentes.
   */
  app.get<{ Params: { empresaId: string }; Querystring: { nomes?: string } }>('/empresas/:empresaId/asaas/sem-nota', async (req, reply) => {
    // Os nomes exigem baixar o cadastro inteiro de clientes, que é a parte
    // lenta. Pra dimensionar ou montar um lote não são necessários.
    const comNomes = req.query.nomes === '1'
    const { data: empresa } = await supabase
      .from('empresas')
      .select('asaas_api_key_cifrado')
      .eq('id', req.params.empresaId)
      .maybeSingle()
    if (!empresa?.asaas_api_key_cifrado) {
      return reply.status(400).send({ error: 'Chave da API do Asaas não configurada' })
    }
    const apiKey = decryptSecret(empresa.asaas_api_key_cifrado)

    let cobrancas: AsaasPayment[]
    let clientes: Awaited<ReturnType<typeof listarClientes>>
    try {
      const [recebidas, confirmadas, cadastro] = await Promise.all([
        listarCobrancasPorStatus(apiKey, 'RECEIVED'),
        listarCobrancasPorStatus(apiKey, 'CONFIRMED'),
        comNomes ? listarClientes(apiKey) : Promise.resolve(new Map()),
      ])
      clientes = cadastro
      const porId = new Map<string, AsaasPayment>()
      for (const c of [...recebidas, ...confirmadas]) porId.set(c.id, c)
      cobrancas = [...porId.values()]
    } catch (e) {
      return reply.status(502).send({ error: (e as Error).message })
    }

    // Vendas que a integração já processou (com nota emitida).
    const { data: processadas } = await supabase
      .from('webhook_events')
      .select('external_id')
      .eq('provider', 'asaas')
      .eq('empresa_id', req.params.empresaId)
      .not('nota_fiscal_id', 'is', null)
    const comNota = new Set((processadas || []).map((e) => e.external_id as string))

    const dataDaVenda = (c: AsaasPayment) =>
      (c.confirmedDate || c.paymentDate || c.clientPaymentDate || c.dateCreated || '').slice(0, 10)

    const vendas = new Map<
      string,
      {
        chave: string
        /** Cobrança que representa a venda (a 1ª parcela, no parcelado). */
        payment_id: string
        data: string
        valor: number
        forma: string
        cliente: string
        cliente_nome: string
        /** PF ou PJ — o número do documento fica no Asaas, não sai daqui. */
        cliente_tipo: 'PF' | 'PJ' | '?'
        descricao: string
        cobrancas: number
        /** Cada cobrança da venda, pra conferir com o extrato do Asaas. */
        parcelas: Array<{ fatura: string; valor: number; status: string; data: string }>
      }
    >()
    for (const c of cobrancas) {
      const chave = chaveEmissao(c)
      if (comNota.has(chave)) continue
      const v = vendas.get(chave) || {
        chave,
        payment_id: c.id,
        data: dataDaVenda(c),
        valor: 0,
        forma: c.billingType || '?',
        cliente: c.customer,
        cliente_nome: (clientes.get(c.customer)?.name || '').trim(),
        cliente_tipo: ((d) => (d.length === 11 ? 'PF' : d.length === 14 ? 'PJ' : '?'))(
          (clientes.get(c.customer)?.cpfCnpj || '').replace(/\D/g, ''),
        ),
        descricao: (c.description || '').replace(/^Parcela \d+ de \d+\.?\s*/i, '').slice(0, 120),
        cobrancas: 0,
        parcelas: [],
      }
      v.valor = Math.round((v.valor + Number(c.value || 0)) * 100) / 100
      v.cobrancas++
      v.parcelas.push({
        fatura: String(c.invoiceNumber || ''),
        valor: Number(c.value || 0),
        status: c.status || '?',
        data: dataDaVenda(c),
      })
      const d = dataDaVenda(c)
      if (d && (!v.data || d < v.data)) v.data = d
      vendas.set(chave, v)
    }

    const lista = [...vendas.values()].sort((a, b) => a.data.localeCompare(b.data))
    const porMes: Record<string, { vendas: number; valor: number }> = {}
    const porForma: Record<string, number> = {}
    for (const v of lista) {
      const m = v.data.slice(0, 7) || '?'
      porMes[m] = porMes[m] || { vendas: 0, valor: 0 }
      porMes[m].vendas++
      porMes[m].valor = Math.round((porMes[m].valor + v.valor) * 100) / 100
      porForma[v.forma] = (porForma[v.forma] || 0) + 1
    }
    return {
      cobrancas_pagas_no_asaas: cobrancas.length,
      vendas_com_nota_pela_integracao: comNota.size,
      vendas_sem_nota: lista.length,
      valor_sem_nota: Math.round(lista.reduce((s, v) => s + v.valor, 0) * 100) / 100,
      parceladas: lista.filter((v) => v.chave.startsWith('parcelamento:')).length,
      por_mes: porMes,
      por_forma: porForma,
      vendas: lista,
    }
  })


  /**
   * GET /admin/empresas/:empresaId/asaas/fora-da-lista
   *
   * Cobranças que não contam como venda a faturar: estornadas, em
   * contestação, recebidas em dinheiro. Serve pra explicar a diferença entre
   * a lista sem-nota e o extrato do Asaas (que mostra o que entrou, mesmo que
   * tenha sido estornado depois). Só leitura.
   */
  app.get<{ Params: { empresaId: string } }>('/empresas/:empresaId/asaas/fora-da-lista', async (req, reply) => {
    const { data: empresa } = await supabase
      .from('empresas')
      .select('asaas_api_key_cifrado')
      .eq('id', req.params.empresaId)
      .maybeSingle()
    if (!empresa?.asaas_api_key_cifrado) {
      return reply.status(400).send({ error: 'Chave da API do Asaas não configurada' })
    }
    const apiKey = decryptSecret(empresa.asaas_api_key_cifrado)
    const STATUS = [
      'REFUNDED',
      'REFUND_REQUESTED',
      'REFUND_IN_PROGRESS',
      'CHARGEBACK_REQUESTED',
      'CHARGEBACK_DISPUTE',
      'AWAITING_CHARGEBACK_REVERSAL',
      'RECEIVED_IN_CASH',
    ]
    try {
      const listas = await Promise.all(STATUS.map((s) => listarCobrancasPorStatus(apiKey, s)))
      return {
        cobrancas: listas.flat().map((c) => ({
          fatura: String(c.invoiceNumber || ''),
          status: c.status,
          valor: Number(c.value || 0),
          data: (c.confirmedDate || c.paymentDate || c.dateCreated || '').slice(0, 10),
          chave: chaveEmissao(c),
          descricao: (c.description || '').slice(0, 80),
        })),
      }
    } catch (e) {
      return reply.status(502).send({ error: (e as Error).message })
    }
  })

  /**
   * POST /admin/empresas/:empresaId/asaas/emitir-lote { payment_ids, excluir_chaves? }
   *
   * Emite as NFS-e de vendas antigas do Asaas — as anteriores à integração.
   * A competência é a data da EMISSÃO (decisão da contabilidade): a nota atrasada
   * entra no faturamento do mês em que sai, não no da venda.
   *
   * Pensado pra ser chamado em blocos pequenos: cada emissão leva alguns
   * segundos e a função tem limite de tempo. Quem chama percorre a lista da
   * rota sem-nota e manda até 8 ids por vez.
   *
   * É seguro repetir: a venda é registrada em webhook_events pela mesma chave
   * da emissão automática, então nada sai em duplicidade — nem se o webhook do
   * Asaas avisar a mesma venda de novo. Venda estornada ou que já tem nota é
   * pulada, e o motivo volta no resultado.
   */
  app.post<{
    Params: { empresaId: string }
    Body: { payment_ids?: string[]; excluir_chaves?: string[] }
  }>('/empresas/:empresaId/asaas/emitir-lote', async (req, reply) => {
    const ids = [...new Set((req.body?.payment_ids || []).map((s) => String(s).trim()).filter(Boolean))]
    if (ids.length === 0) return reply.status(400).send({ error: 'Informe payment_ids' })
    if (ids.length > 8) return reply.status(400).send({ error: 'No máximo 8 por chamada' })
    const excluir = new Set(req.body?.excluir_chaves || [])

    const { data: empresa } = await supabase
      .from('empresas')
      .select('asaas_api_key_cifrado')
      .eq('id', req.params.empresaId)
      .maybeSingle()
    if (!empresa?.asaas_api_key_cifrado) {
      return reply.status(400).send({ error: 'Chave da API do Asaas não configurada' })
    }
    const apiKey = decryptSecret(empresa.asaas_api_key_cifrado)

    const resultados: Array<{
      payment_id: string
      chave?: string
      resultado: 'emitida' | 'pulada' | 'erro'
      motivo?: string
      nota_id?: string
    }> = []

    for (const id of ids) {
      try {
        const pagamento = await buscarPagamento(apiKey, id)
        // Estornada, vencida ou não paga: não há venda a faturar.
        if (pagamento.status !== 'RECEIVED' && pagamento.status !== 'CONFIRMED') {
          resultados.push({ payment_id: id, resultado: 'pulada', motivo: `status ${pagamento.status}` })
          continue
        }
        const chave = chaveEmissao(pagamento)
        if (excluir.has(chave)) {
          resultados.push({ payment_id: id, chave, resultado: 'pulada', motivo: 'excluída (já tem nota emitida à mão)' })
          continue
        }

        const { data: existente } = await supabase
          .from('webhook_events')
          .select('id, status, nota_fiscal_id')
          .eq('provider', 'asaas')
          .eq('external_id', chave)
          .maybeSingle()

        let eventoId: string
        if (existente) {
          // Já tem nota, ou outra chamada está emitindo agora: não toca.
          if (existente.nota_fiscal_id || existente.status !== 'erro') {
            resultados.push({
              payment_id: id,
              chave,
              resultado: 'pulada',
              motivo: existente.nota_fiscal_id ? 'já tem nota' : `evento ${existente.status}`,
              nota_id: existente.nota_fiscal_id ?? undefined,
            })
            continue
          }
          // Tentativa anterior falhou: refaz no mesmo registro.
          eventoId = existente.id as string
          await supabase.from('webhook_events').update({ status: 'processando', erro: null }).eq('id', eventoId)
        } else {
          const { data: novo, error } = await supabase
            .from('webhook_events')
            .insert({
              provider: 'asaas',
              external_id: chave,
              empresa_id: req.params.empresaId,
              event_type: 'PAYMENT_RECEIVED',
              payload: { event: 'PAYMENT_RECEIVED', payment: pagamento, backfill: true, competencia: 'hoje' },
              status: 'processando',
            })
            .select('id')
            .single()
          if (error || !novo) {
            // O índice único barrou: outra chamada (ou o webhook) pegou antes.
            resultados.push({ payment_id: id, chave, resultado: 'pulada', motivo: 'já em andamento' })
            continue
          }
          eventoId = novo.id as string
        }

        const r = await emitirPorPagamentoAsaas(eventoId, req.params.empresaId, pagamento, { competenciaHoje: true })
        resultados.push({
          payment_id: id,
          chave,
          resultado: r.ok ? 'emitida' : 'erro',
          motivo: r.erro,
          nota_id: r.notaId,
        })
      } catch (e) {
        resultados.push({ payment_id: id, resultado: 'erro', motivo: (e as Error).message })
      }
    }
    return { total: ids.length, emitidas: resultados.filter((r) => r.resultado === 'emitida').length, resultados }
  })

  /**
   * POST /admin/asaas/webhook-events/:id/reprocessar
   *
   * Pra destravar eventos que falharam — chave da API configurada depois,
   * cliente sem CPF corrigido no Asaas, SEFIN fora do ar. Segue exatamente o
   * mesmo caminho do webhook.
   */
  app.post<{ Params: { id: string } }>('/asaas/webhook-events/:id/reprocessar', async (req, reply) => {
    const r = await reprocessarEventoAsaas(req.params.id)
    if (r.ok) return reply.status(200).send({ ok: true, nota_id: r.notaId, status: r.notaStatus })
    const msg = r.erro || 'Falha ao reprocessar'
    if (msg.includes('não encontrado')) return reply.status(404).send({ error: msg })
    if (msg.includes('já processado') || msg.includes('só pra eventos')) {
      return reply.status(400).send({ error: msg })
    }
    return reply.status(200).send({ ok: false, erro: msg })
  })
}
