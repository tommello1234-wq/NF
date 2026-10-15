-- ============================================================
-- Integração Asaas — emissão automática de NFS-e por pagamento
-- ------------------------------------------------------------
-- Mesmo desenho do Stripe (021/022/025):
--
--   asaas_webhook_token_cifrado  token que o Asaas manda no header
--                                `asaas-access-token` de cada webhook.
--                                Gerado pelo painel, nunca digitado.
--   asaas_api_key_cifrado        chave da API do Asaas. Necessária porque o
--                                webhook de pagamento traz só o ID do cliente
--                                (cus_...) — CPF/CNPJ, nome e endereço do
--                                tomador vêm de GET /v3/customers/{id}.
--   asaas_produto_default_id     serviço usado na NFS-e. O Asaas não tem
--                                catálogo de produto no pagamento, então não
--                                há o que mapear: é sempre o default.
--   usa_asaas                    mostra "Integração Asaas" no menu.
--
-- Os dois segredos ficam cifrados com a mesma chave do servidor
-- (CERT_ENCRYPTION_KEY) usada pro Stripe e pra Ticto.
--
-- webhook_events não muda: `provider` é texto livre e o índice
-- único (provider, external_id) já cobre a idempotência.
-- ============================================================

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS usa_asaas boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS asaas_webhook_token_cifrado text,
  ADD COLUMN IF NOT EXISTS asaas_api_key_cifrado text,
  ADD COLUMN IF NOT EXISTS asaas_produto_default_id uuid
    REFERENCES public.produtos(id) ON DELETE SET NULL;

-- UPWARD CREATIVE ACADEMY vende pelo Asaas.
-- Já deixa o serviço padrão apontado pro mesmo que as 200+ NFS-e do
-- Stripe usam (Assinatura SaaS - Licenciamento de software, LC 01.05.01).
UPDATE public.empresas e
SET usa_asaas = true,
    asaas_produto_default_id = COALESCE(
      e.asaas_produto_default_id,
      e.stripe_produto_default_id,
      (SELECT p.id FROM public.produtos p
        WHERE p.id = '293c7d46-d7ef-4591-94e9-b9e23089035b'
          AND p.empresa_id = e.id)
    )
WHERE e.cnpj = '41911178000171';
