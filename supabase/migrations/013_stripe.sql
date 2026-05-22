-- ============================================================
-- Integração Stripe (webhook + mapeamento price/product -> serviço)
-- Espelha a tabela ticto_mapeamento, mas o "external id" da Stripe é
-- o `price.id` (pricing recorrente) — pra MVP usamos isso como
-- identificador do produto vendido.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.stripe_mapeamento (
  id                       uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id               uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  stripe_price_id          text NOT NULL,
  produto_id               uuid NOT NULL REFERENCES public.produtos(id) ON DELETE RESTRICT,
  /**
   * Override em centavos pra ignorar amount_paid da Stripe se a empresa
   * quiser destacar valor diferente na NFS-e (ex: separar IOF/desconto).
   * Quando NULL usa amount_paid do webhook.
   */
  valor_unitario_override  numeric(14, 2),
  ativo                    boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_empresa_price
  ON public.stripe_mapeamento(empresa_id, stripe_price_id);

CREATE INDEX IF NOT EXISTS idx_stripe_empresa ON public.stripe_mapeamento(empresa_id);
CREATE INDEX IF NOT EXISTS idx_stripe_produto ON public.stripe_mapeamento(produto_id);

-- Endpoint secret da Stripe (whsec_...) cifrado AES-256-GCM por empresa
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS stripe_webhook_secret_cifrado text;

ALTER TABLE public.stripe_mapeamento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stripe_mapeamento_service" ON public.stripe_mapeamento;
CREATE POLICY "stripe_mapeamento_service" ON public.stripe_mapeamento
  FOR ALL TO service_role USING (true) WITH CHECK (true);
