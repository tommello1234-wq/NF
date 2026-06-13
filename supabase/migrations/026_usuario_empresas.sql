-- ============================================================
-- Controle de acesso por usuário: cada usuário só vê suas empresas
-- ------------------------------------------------------------
-- Se o usuário tem linhas aqui → vê só essas empresas (workspace isolado)
-- Se não tem nenhuma linha → vê todas (backward compat / superadmin)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.usuario_empresas (
  user_id    uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, empresa_id)
);

ALTER TABLE public.usuario_empresas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "usuario_empresas_service" ON public.usuario_empresas;
CREATE POLICY "usuario_empresas_service" ON public.usuario_empresas
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_usuario_empresas_user ON public.usuario_empresas(user_id);
