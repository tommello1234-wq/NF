import { FastifyInstance } from 'fastify'
import { supabase } from '../services/supabase.js'
import { decryptSecret, timingSafeEqual } from '../services/crypto-utils.js'
import { mapearTictoParaEmissao } from '../services/webhooks/ticto-mapper.js'
import {
  isEventoCancelar,
  isEventoEmitir,
  type TictoWebhookV2,
} from '../services/webhooks/ticto-types.js'
import { cancelarNfse, emitirNfse } from '../services/nfse/orquestrador.js'

/**
 * Rotas públicas de webhook (sem authAdmin — autenticação via token cifrado
 * cadastrado por empresa).
 *
 * Fluxo:
 *   1. Recebe payload Ticto v2
 *   2. Carrega empresa pela URL (:empresaId), valida token
 *   3. Idempotência: tenta inserir em webhook_events com UNIQUE(provider, external_id).
 *      Se já existe → 200 OK silencioso (não reprocessa)
 *   4. Se status='authorized' → mapeia → emite NFS-e
 *      Se status='refunded'/'chargeback' → cancela NFS-e existente (se houver)
 *      Outros status → registra evento mas não emite (paid pendente etc)
 *   5. Atualiza webhook_events com nota_fiscal_id e status final
 */
export async function webhooksTictoRoutes(app: FastifyInstance) {
  app.post<{ Params: { empresaId: string }; Body: TictoWebhookV2 }>(
    '/ticto/:empresaId',
    async (req, reply) => {
      const empresaId = req.params.empresaId
      const payload = req.body

      // 1. Valida empresa + token
      const { data: empresa } = await supabase
        .from('empresas')
        .select('id, municipio_emissor_codigo, endereco_codigo_ibge, ticto_webhook_token_cifrado')
        .eq('id', empresaId)
        .maybeSingle()
      if (!empresa) {
        return reply.status(404).send({ error: 'Empresa não encontrada' })
      }
      if (!empresa.ticto_webhook_token_cifrado) {
        return reply.status(400).send({ error: 'Empresa sem token Ticto configurado' })
      }
      try {
        const tokenEsperado = decryptSecret(empresa.ticto_webhook_token_cifrado)
        const tokenRecebido = (payload?.token || '').trim()
        if (!tokenRecebido || !timingSafeEqual(tokenRecebido, tokenEsperado)) {
          return reply.status(401).send({ error: 'Token inválido' })
        }
      } catch (e) {
        app.log.error({ err: e }, 'Erro ao validar token Ticto')
        return reply.status(500).send({ error: 'Erro ao validar token' })
      }

      // 2. external_id pra idempotência
      const externalId = payload?.order?.transaction_hash || payload?.order?.hash
      if (!externalId) {
        return reply.status(400).send({ error: 'Payload sem order.transaction_hash' })
      }

      // 3. Insere webhook_events (UNIQUE provider+external_id evita duplicidade)
      const { data: existente } = await supabase
        .from('webhook_events')
        .select('id, status, nota_fiscal_id')
        .eq('provider', 'ticto')
        .eq('external_id', externalId)
        .maybeSingle()
      if (existente) {
        // Reentrega: responde 200 OK sem reprocessar (idempotência)
        return reply
          .status(200)
          .send({ ok: true, idempotent: true, webhook_event_id: existente.id, status: existente.status })
      }

      const { data: evento, error: evtErr } = await supabase
        .from('webhook_events')
        .insert({
          provider: 'ticto',
          external_id: externalId,
          empresa_id: empresaId,
          event_type: payload?.status || 'unknown',
          payload: payload as unknown as Record<string, unknown>,
          status: 'processando',
        })
        .select()
        .single()
      if (evtErr || !evento) {
        // Race condition possível: outro request já inseriu — trata como idempotência
        return reply.status(200).send({ ok: true, idempotent: true })
      }

      const status = (payload?.status || '').toLowerCase()

      // 4a. Compra aprovada → emite
      if (isEventoEmitir(status)) {
        const cMunFallback = String(
          empresa.municipio_emissor_codigo || empresa.endereco_codigo_ibge || ''
        )
        if (cMunFallback.length !== 7) {
          await marcarEventoErro(evento.id, 'Empresa sem código IBGE de município emissor')
          return reply.status(200).send({ ok: false, erro: 'Empresa sem código IBGE de município emissor' })
        }

        let mapped
        try {
          mapped = mapearTictoParaEmissao(payload, cMunFallback)
        } catch (e) {
          await marcarEventoErro(evento.id, (e as Error).message)
          return reply.status(200).send({ ok: false, erro: (e as Error).message })
        }

        // Resolve mapeamento ticto_product_id → produto_id
        const { data: mapping } = await supabase
          .from('ticto_mapeamento')
          .select('produto_id, valor_unitario_override, ativo')
          .eq('empresa_id', empresaId)
          .eq('ticto_product_id', mapped.tictoProductId)
          .eq('ativo', true)
          .maybeSingle()

        if (!mapping) {
          await marcarEventoErro(
            evento.id,
            `Sem mapeamento Ticto para product_id=${mapped.tictoProductId}. Cadastre em /integracoes/ticto.`
          )
          return reply.status(200).send({
            ok: false,
            erro: `Sem mapeamento Ticto para product_id=${mapped.tictoProductId}`,
          })
        }

        const valorFinal = mapping.valor_unitario_override
          ? Number(mapping.valor_unitario_override)
          : mapped.valorServicos

        try {
          const result = await emitirNfse({
            empresaId,
            produtoId: mapping.produto_id,
            tomadorOverride: mapped.tomador,
            valorServicos: valorFinal,
            descricao: mapped.descricao,
          })
          await supabase
            .from('webhook_events')
            .update({
              status: result.status === 'autorizada' ? 'processado' : 'erro',
              nota_fiscal_id: result.notaId,
              processado_em: new Date().toISOString(),
              erro: result.status !== 'autorizada' ? result.erros?.[0]?.descricao : null,
            })
            .eq('id', evento.id)
          return reply.status(200).send({ ok: true, nota_id: result.notaId, status: result.status })
        } catch (e) {
          await marcarEventoErro(evento.id, (e as Error).message)
          return reply.status(200).send({ ok: false, erro: (e as Error).message })
        }
      }

      // 4b. Reembolso/chargeback → cancela nota anterior
      if (isEventoCancelar(status)) {
        // Tenta achar a nota emitida antes (procura webhook_events com mesmo
        // produto Ticto + cliente Ticto, ou via order.transaction_hash original)
        // Solução simples: procurar webhook_events processados anteriormente
        // pelo mesmo order.id ou hash relacionado.
        const orderId = String(payload?.order?.id || '')
        const orderHash = String(payload?.order?.hash || '')

        let notaIdToCancel: string | null = null
        if (orderHash) {
          const { data: prev } = await supabase
            .from('webhook_events')
            .select('nota_fiscal_id')
            .eq('provider', 'ticto')
            .eq('empresa_id', empresaId)
            .or(`external_id.eq.${orderHash},payload->order->>id.eq.${orderId}`)
            .not('nota_fiscal_id', 'is', null)
            .order('recebido_em', { ascending: false })
            .limit(1)
            .maybeSingle()
          notaIdToCancel = prev?.nota_fiscal_id || null
        }

        if (!notaIdToCancel) {
          await marcarEventoErro(
            evento.id,
            `Não achei NFS-e emitida pra cancelar (order.hash=${orderHash}, order.id=${orderId})`
          )
          return reply.status(200).send({ ok: false, erro: 'Nota original não encontrada' })
        }

        try {
          const motivoStatus = status === 'refunded' ? 'Reembolso pelo gateway' : 'Chargeback'
          const result = await cancelarNfse({
            notaId: notaIdToCancel,
            codigoMotivo: '9', // Outros
            descricaoMotivo: `Cancelamento automatico via webhook Ticto: ${motivoStatus}`,
          })
          await supabase
            .from('webhook_events')
            .update({
              status: result.status === 'cancelada' ? 'processado' : 'erro',
              nota_fiscal_id: notaIdToCancel,
              processado_em: new Date().toISOString(),
              erro: result.status !== 'cancelada' ? result.erros?.[0]?.descricao : null,
            })
            .eq('id', evento.id)
          return reply.status(200).send({ ok: true, nota_id: notaIdToCancel, status: result.status })
        } catch (e) {
          await marcarEventoErro(evento.id, (e as Error).message)
          return reply.status(200).send({ ok: false, erro: (e as Error).message })
        }
      }

      // 4c. Outros status — só registra como ignorado
      await supabase
        .from('webhook_events')
        .update({ status: 'ignorado', processado_em: new Date().toISOString() })
        .eq('id', evento.id)
      return reply.status(200).send({ ok: true, ignored: true, status })
    }
  )
}

async function marcarEventoErro(eventoId: string, mensagem: string) {
  await supabase
    .from('webhook_events')
    .update({ status: 'erro', erro: mensagem.slice(0, 1000), processado_em: new Date().toISOString() })
    .eq('id', eventoId)
}
