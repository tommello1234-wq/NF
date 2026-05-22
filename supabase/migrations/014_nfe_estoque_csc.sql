-- ============================================================
-- Fase 4.1: Estoque, split CSC homol/prod, índices auxiliares
-- ============================================================

-- 1. Estoque por produto (decrementado na autorização da NF-e/NFC-e)
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS estoque numeric(14, 4) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_produtos_estoque ON public.produtos(empresa_id, estoque);

-- 2. CSC separado por ambiente (NFC-e exige um CSC pra homologação e outro pra produção;
-- mantém csc_id/csc_token legados pra compatibilidade durante migração).
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS csc_id_homol     text,
  ADD COLUMN IF NOT EXISTS csc_token_homol  text,
  ADD COLUMN IF NOT EXISTS csc_id_prod      text,
  ADD COLUMN IF NOT EXISTS csc_token_prod   text;

-- Copia o que já existia em csc_id/csc_token para o slot de homologação,
-- já que praticamente todo cadastro até agora era em ambiente=2.
UPDATE public.empresas
   SET csc_id_homol    = COALESCE(csc_id_homol, csc_id),
       csc_token_homol = COALESCE(csc_token_homol, csc_token)
 WHERE (csc_id_homol IS NULL OR csc_token_homol IS NULL)
   AND (csc_id IS NOT NULL OR csc_token IS NOT NULL);
