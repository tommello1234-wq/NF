-- ============================================================
-- Certificados Digitais A1 por empresa
-- ============================================================

CREATE TABLE IF NOT EXISTS public.certificados_digitais (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id uuid NOT NULL UNIQUE REFERENCES public.empresas(id) ON DELETE CASCADE,
  cnpj text NOT NULL,
  razao_social text,
  serial_number text,
  valido_ate timestamptz NOT NULL,
  storage_path text NOT NULL,
  senha_criptografada text NOT NULL,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cert_empresa ON public.certificados_digitais(empresa_id);
CREATE INDEX IF NOT EXISTS idx_cert_cnpj ON public.certificados_digitais(cnpj);

ALTER TABLE public.certificados_digitais ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cert_service_only" ON public.certificados_digitais;
CREATE POLICY "cert_service_only" ON public.certificados_digitais
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Bucket privado para os .pfx
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'certificados') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('certificados', 'certificados', false, 5242880,
            ARRAY['application/x-pkcs12', 'application/octet-stream']);
  END IF;
END $$;
