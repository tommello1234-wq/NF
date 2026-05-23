-- ============================================================
-- Produto default por empresa pra integração Stripe
-- ------------------------------------------------------------
-- Quando o webhook chega com price_id que NÃO tá em stripe_mapeamento,
-- o backend cai nesse fallback. Resolve o caso comum em que a empresa
-- só vende um tipo de serviço (ex: SaaS / Licenciamento) e cria payment
-- links na Stripe à vontade sem precisar cadastrar cada price_id.
-- O mapeamento explícito continua valendo (sobrescreve o default).
-- ============================================================

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS stripe_produto_default_id uuid
    REFERENCES public.produtos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_empresas_stripe_produto_default
  ON public.empresas(stripe_produto_default_id)
  WHERE stripe_produto_default_id IS NOT NULL;
