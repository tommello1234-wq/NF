-- ============================================================
-- Fase 5.4: Audit Log para reverter ações
--
-- Registra cada ação simples (arquivar, desarquivar, ativar, desativar,
-- importar em massa, etc) com payloads antes/depois para permitir reverter.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id    uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  entidade      text NOT NULL,
    -- 'produto', 'cliente', 'venda', etc.
  entidade_id   uuid,
    -- pode ser null no caso de operações em massa
  tipo_acao     text NOT NULL,
    -- 'arquivar' | 'desarquivar' | 'ativar' | 'desativar' | 'importar_massa'
    -- | 'criar' | 'editar' | 'excluir'
  descricao     text NOT NULL,
  payload_antes jsonb,
  payload_depois jsonb,
  metadata      jsonb,
    -- info extra: { quantidade, ids_afetados, planilha, ... }
  reversivel    boolean NOT NULL DEFAULT true,
  revertida     boolean NOT NULL DEFAULT false,
  revertida_em  timestamptz,
  reverte_log_id uuid REFERENCES public.audit_log(id),
    -- se esta entrada é uma reversão, aponta pro log original
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_empresa_entidade
  ON public.audit_log(empresa_id, entidade, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entidade_id
  ON public.audit_log(entidade_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_revertida
  ON public.audit_log(revertida);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_log_service" ON public.audit_log;
CREATE POLICY "audit_log_service" ON public.audit_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);
