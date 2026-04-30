-- ============================================================
-- API Keys (Bearer tokens usados pelo cliente que consome a API)
-- Nunca guardamos plaintext — só o SHA-256.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE,
  prefix text NOT NULL,
  nome text,
  ultimo_uso timestamptz,
  revogada_em timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON public.api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_empresa ON public.api_keys(empresa_id);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "api_keys_service" ON public.api_keys;
CREATE POLICY "api_keys_service" ON public.api_keys
  FOR ALL TO service_role USING (true) WITH CHECK (true);
