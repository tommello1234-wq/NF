-- ============================================================
-- Fase 5.3: Separar "ativo" de "arquivado"
--
-- Os 3 estados que precisamos representar:
--   • Ativo, em uso (default) ............. ativo=true,  arquivado=false
--   • Desativado temporariamente .......... ativo=false, arquivado=false
--   • Arquivado (esconde da lista ativa) .. arquivado=true (ativo livre)
--
-- A aba "Ativos" mostra ambos os dois primeiros casos (arquivado=false).
-- A aba "Arquivados" mostra só o terceiro (arquivado=true).
-- ============================================================

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS arquivado boolean NOT NULL DEFAULT false;

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS arquivado boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_produtos_arquivado ON public.produtos(empresa_id, arquivado);
CREATE INDEX IF NOT EXISTS idx_clientes_arquivado ON public.clientes(empresa_id, arquivado);
