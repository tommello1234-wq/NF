-- ============================================================
-- Fase 2: Tabela de produtos/serviços por empresa
-- ============================================================

CREATE TABLE IF NOT EXISTS public.produtos (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id       uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  descricao        text NOT NULL,
  codigo_interno   text,
  ncm              text,
  cfop             text,
  unidade          text NOT NULL DEFAULT 'UN',
  valor_unitario   numeric(14, 2),
  origem           integer NOT NULL DEFAULT 0
    CHECK (origem BETWEEN 0 AND 8),
  cst_csosn        text,
  aliquota_icms    numeric(5, 2),
  aliquota_pis     numeric(5, 2),
  aliquota_cofins  numeric(5, 2),
  tipo             text NOT NULL DEFAULT 'produto'
    CHECK (tipo IN ('produto', 'servico')),
  ativo            boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_produtos_empresa ON public.produtos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_produtos_ativo ON public.produtos(ativo);
CREATE INDEX IF NOT EXISTS idx_produtos_tipo ON public.produtos(tipo);

ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "produtos_service" ON public.produtos;
CREATE POLICY "produtos_service" ON public.produtos
  FOR ALL TO service_role USING (true) WITH CHECK (true);
