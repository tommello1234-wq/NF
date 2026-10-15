import type { FastifyInstance } from 'fastify'
import { supabase } from '../services/supabase.js'
import { decryptSecret, timingSafeEqual } from '../services/crypto-utils.js'
import {
  chaveEmissao,
  isEventoCancelar,
  isEventoEmitir,
  type AsaasWebhookPayload,
} from '../services/webhooks/asaas-types.js'
import {
  cancelarPorEstornoAsaas,
  emitirPorPagamentoAsaas,
} from '../services/webhooks/asaas-processar.js'

/**
 * Webhook Asaas — POST /webhooks/asaas/:empresaId
 *
 * Diferenças vs Stripe/Ticto:
 *   - Autenticação pelo header `asaas-access-token`, que é o token gerado no
 *     painel e colado no cadastro do webhook no Asaas.
 *   - O payload traz só o ID do cliente; CPF/CNPJ e endereço vêm da API
 *     (por isso a integração também guarda a chave da API).
 *   - Idempotência pela COBRANÇA, não pelo evento: o cartão avisa duas vezes
 *     (CONFIRMED e depois RECEIVED) e as duas têm que dar numa nota só.
 *
 * Sempre responde 200 depois de autenticado, mesmo quando a emissão falha:
 * o Asaas reenvia o que não recebe 200 e, depois de várias falhas seguidas,
 * PAUSA a fila inteira do webhook — uma nota com problema travaria todas as
 * outras. A falha fica registrada no evento e é reprocessada pelo painel.
 */
export async function webhooksAsaasRoutes(app: FastifyInstance) {
  app.post<{ Params: { empresaId: string }; Body: AsaasWebhookPayload }>(
    '/asaas/:empresaId',
    async (req, reply) => {
      const { empresaId } = req.params
      const payload = req.body

      // 1. Empresa + token
      const { data: empresa } = await supabase
        .from('empresas')
        .select('id, asaas_webhook_token_cifrado')
        .eq('id', empresaId)
        .maybeSingle()
      if (!empresa) return reply.status(404).send({ error: 'Empresa não encontrada' })
      if (!empresa.asaas_webhook_token_cifrado) {
        return reply.status(400).send({ error: 'Empresa sem token do Asaas configurado' })
      }
      const recebido = String(req.headers['asaas-access-token'] || '').trim()
      try {
        const esperado = decryptSecret(empresa.asaas_webhook_token_cifrado)
        if (!recebido || !timingSafeEqual(recebido, esperado)) {
          return reply.status(401).send({ error: 'Token inválido' })
        }
      } catch (e) {
        app.log.error({ err: e }, 'Erro ao validar token Asaas')
        return reply.status(500).send({ error: 'Erro ao validar token' })
      }

      // 2. Só eventos de cobrança interessam
      const evento = String(payload?.event || '')
      const payment = payload?.payment
      if (!payment?.id) {
        return reply.status(200).send({ ok: true, ignored: true, motivo: 'evento sem cobrança', event: evento })
      }

      const externalId = isEventoEmitir(evento)
        ? chaveEmissao(payment)
        : isEventoCancelar(evento)
          ? `estorno:${payment.id}`
          : `${evento}:${payment.id}`

      // 3. Idempotência
      const { data: existente } = await supabase
        .from('webhook_events')
        .select('id, status, nota_fiscal_id')
        .eq('provider', 'asaas')
        .eq('external_id', externalId)
        .maybeSingle()
      if (existente) {
        return reply.status(200).send({
          ok: true,
          idempotent: true,
          webhook_event_id: existente.id,
          status: existente.status,
        })
      }

      const { data: registro, error: insErr } = await supabase
        .from('webhook_events')
        .insert({
          provider: 'asaas',
          external_id: externalId,
          empresa_id: empresaId,
          event_type: evento,
          payload: payload as unknown as Record<string, unknown>,
          status: 'processando',
        })
        .select('id')
        .single()
      if (insErr || !registro) {
        // CONFIRMED e RECEIVED chegando juntos: o índice único barrou o
        // segundo. O primeiro está emitindo — esse aqui não faz nada.
        return reply.status(200).send({ ok: true, idempotent: true })
      }

      // 4. Despacha
      try {
        if (isEventoEmitir(evento)) {
          const r = await emitirPorPagamentoAsaas(registro.id, empresaId, payment)
          return reply.status(200).send({ ok: r.ok, nota_id: r.notaId, status: r.notaStatus, erro: r.erro })
        }
        if (isEventoCancelar(evento)) {
          const r = await cancelarPorEstornoAsaas(registro.id, empresaId, payment)
          return reply.status(200).send({ ok: r.ok, nota_id: r.notaId, status: r.notaStatus, erro: r.erro })
        }
      } catch (e) {
        app.log.error({ err: e }, 'Erro ao processar webhook Asaas')
        await supabase
          .from('webhook_events')
          .update({ status: 'erro', erro: (e as Error).message.slice(0, 1000), processado_em: new Date().toISOString() })
          .eq('id', registro.id)
        return reply.status(200).send({ ok: false, erro: (e as Error).message })
      }

      await supabase
        .from('webhook_events')
        .update({ status: 'ignorado', processado_em: new Date().toISOString() })
        .eq('id', registro.id)
      return reply.status(200).send({ ok: true, ignored: true, event: evento })
    },
  )
}
