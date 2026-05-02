-- ============================================================
-- Fase 2: Tabela de clientes/destinatários por empresa
-- ============================================================

CREATE TABLE IF NOT EXISTS public.clientes (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id            uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nome                  text NOT NULL,
  cpf_cnpj              text NOT NULL,
  ie                    text,
  email                 text,
  telefone              text,
  endereco_logradouro   text,
  endereco_numero       text,
  endereco_bairro       text,
  endereco_cidade       text,
  endereco_uf           text,
  endereco_cep          text,
  endereco_codigo_ibge  text,
  ativo                 boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clientes_empresa ON public.clientes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_clientes_cpf_cnpj ON public.clientes(cpf_cnpj);
CREATE INDEX IF NOT EXISTS idx_clientes_ativo ON public.clientes(ativo);

ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clientes_service" ON public.clientes;
CREATE POLICY "clientes_service" ON public.clientes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
