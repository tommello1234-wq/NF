-- ============================================================
-- Fase 3: Naturezas de operacao para emissao de NF-e
-- ============================================================

CREATE TABLE IF NOT EXISTS public.naturezas_operacao (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id            uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nome                  text NOT NULL,
  natureza              text NOT NULL DEFAULT 'VENDA DE MERCADORIA',
  tipo_operacao         text NOT NULL DEFAULT 'saida'
    CHECK (tipo_operacao IN ('entrada', 'saida')),
  finalidade            text NOT NULL DEFAULT 'normal'
    CHECK (finalidade IN ('normal', 'complementar', 'ajuste', 'devolucao')),
  cfop_padrao           text,
  consumidor_final      boolean NOT NULL DEFAULT true,
  indicador_presenca    integer NOT NULL DEFAULT 9
    CHECK (indicador_presenca BETWEEN 0 AND 9),
  modalidade_frete      integer NOT NULL DEFAULT 9
    CHECK (modalidade_frete BETWEEN 0 AND 9),
  informacoes_adicionais text,
  ativo                 boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_naturezas_empresa ON public.naturezas_operacao(empresa_id);
CREATE INDEX IF NOT EXISTS idx_naturezas_ativo ON public.naturezas_operacao(ativo);

ALTER TABLE public.naturezas_operacao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "naturezas_service" ON public.naturezas_operacao;
CREATE POLICY "naturezas_service" ON public.naturezas_operacao
  FOR ALL TO service_role USING (true) WITH CHECK (true);
