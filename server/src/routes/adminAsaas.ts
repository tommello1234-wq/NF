import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { supabase } from '../services/supabase.js'
import { authAdmin } from '../middleware/authAdmin.js'
import { decryptSecret, encryptSecret } from '../services/crypto-utils.js'
import { AsaasApiError, ehChaveSandbox, validarChave } from '../services/webhooks/asaas-client.js'
import { reprocessarEventoAsaas } from '../services/webhooks/asaas-processar.js'

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
