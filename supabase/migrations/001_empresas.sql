-- ============================================================
-- Empresas (multi-tenant do SaaS)
-- Cada cliente paga uma empresa no cadastro e recebe uma API key.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.empresas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  razao_social text NOT NULL,
  cnpj text NOT NULL UNIQUE,
  ie text,
  im text,
  regime_tributario text CHECK (regime_tributario IN ('simples', 'mei', 'lucro_presumido', 'lucro_real')),
  crt integer CHECK (crt IN (1, 2, 3, 4)),
  endereco_logradouro text,
  endereco_numero text,
  endereco_bairro text,
  endereco_cidade text,
  endereco_uf text,
  endereco_cep text,
  endereco_codigo_ibge text,
  email text,
  telefone text,
  ambiente_sefaz integer DEFAULT 2 CHECK (ambiente_sefaz IN (1, 2)),
  uf_sefaz text DEFAULT 'CE',
  csc_id text,
  csc_token text,
  ativo boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_empresas_cnpj ON public.empresas(cnpj);
CREATE INDEX IF NOT EXISTS idx_empresas_ativo ON public.empresas(ativo);

ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "empresas_service" ON public.empresas;
CREATE POLICY "empresas_service" ON public.empresas
  FOR ALL TO service_role USING (true) WITH CHECK (true);
