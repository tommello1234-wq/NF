-- ============================================================
-- Notas Fiscais emitidas (placeholder — preenchido na Fase 2)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notas_fiscais (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('nfe', 'nfce')),
  numero integer,
  serie integer,
  chave_acesso text UNIQUE,
  protocolo text,
  status text NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'processando', 'autorizada', 'rejeitada', 'cancelada', 'inutilizada')),
  xml_path text,
  danfe_path text,
  destinatario_nome text,
  destinatario_cpf_cnpj text,
  valor_total numeric(14,2),
  payload_original jsonb,
  motivo_rejeicao text,
  emitida_em timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notas_empresa ON public.notas_fiscais(empresa_id);
CREATE INDEX IF NOT EXISTS idx_notas_status ON public.notas_fiscais(status);
CREATE INDEX IF NOT EXISTS idx_notas_chave ON public.notas_fiscais(chave_acesso);
CREATE INDEX IF NOT EXISTS idx_notas_emitida ON public.notas_fiscais(emitida_em);

ALTER TABLE public.notas_fiscais ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notas_fiscais_service" ON public.notas_fiscais;
CREATE POLICY "notas_fiscais_service" ON public.notas_fiscais
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Bucket privado pros XMLs e DANFEs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'notas-xml') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('notas-xml', 'notas-xml', false, 10485760,
            ARRAY['application/xml', 'text/xml']);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'notas-danfe') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('notas-danfe', 'notas-danfe', false, 10485760,
            ARRAY['application/pdf']);
  END IF;
END $$;
