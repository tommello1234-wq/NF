-- ============================================================
-- Fase NFS-e: mapeamento de produtos Ticto -> serviços cadastrados
-- Liga o product_id que vem no webhook da Ticto ao serviço (linha em
-- produtos com tipo='servico') que deve ser usado na emissão da NFS-e.
-- Permite override de valor unitário caso o preço Ticto difira do
-- cadastro local.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ticto_mapeamento (
  id                       uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id               uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  ticto_product_id         text NOT NULL,
  produto_id               uuid NOT NULL REFERENCES public.produtos(id) ON DELETE RESTRICT,
  valor_unitario_override  numeric(14, 2),
  ativo                    boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ticto_empresa_product
  ON public.ticto_mapeamento(empresa_id, ticto_product_id);

CREATE INDEX IF NOT EXISTS idx_ticto_empresa ON public.ticto_mapeamento(empresa_id);
CREATE INDEX IF NOT EXISTS idx_ticto_produto ON public.ticto_mapeamento(produto_id);

-- Token de webhook (cifrado) por empresa — Ticto manda token no payload e
-- precisamos validar contra o que está cadastrado.
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS ticto_webhook_token_cifrado    text,
  ADD COLUMN IF NOT EXISTS ticto_webhook_token_iv         text,
  ADD COLUMN IF NOT EXISTS ticto_webhook_token_auth_tag   text;

ALTER TABLE public.ticto_mapeamento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ticto_mapeamento_service" ON public.ticto_mapeamento;
CREATE POLICY "ticto_mapeamento_service" ON public.ticto_mapeamento
  FOR ALL TO service_role USING (true) WITH CHECK (true);
