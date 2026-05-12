-- ============================================================
-- Fase NFS-e: campos de serviço em produtos + suporte a NFS-e em notas_fiscais
-- Adapta o cadastro de produtos para também armazenar dados de serviço
-- (LC 116, código tributário municipal, ISS) e expande notas_fiscais para
-- aceitar tipo='nfse' com numeração DPS e chave de acesso de 50 caracteres.
-- ============================================================

-- 1. Campos NFS-e na tabela produtos (quando tipo='servico')
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS codigo_lc116                  text,
  ADD COLUMN IF NOT EXISTS codigo_tributario_municipal   text,
  ADD COLUMN IF NOT EXISTS codigo_nbs                    text,
  ADD COLUMN IF NOT EXISTS cnae                          text,
  ADD COLUMN IF NOT EXISTS aliquota_iss                  numeric(5, 2),
  ADD COLUMN IF NOT EXISTS iss_retido                    boolean NOT NULL DEFAULT false;

-- 2. Expandir constraint tipo em notas_fiscais para aceitar 'nfse'
ALTER TABLE public.notas_fiscais
  DROP CONSTRAINT IF EXISTS notas_fiscais_tipo_check;

ALTER TABLE public.notas_fiscais
  ADD CONSTRAINT notas_fiscais_tipo_check
  CHECK (tipo IN ('nfe', 'nfce', 'nfse'));

-- 3. Expandir status em notas_fiscais para cobrir o fluxo NFS-e
ALTER TABLE public.notas_fiscais
  DROP CONSTRAINT IF EXISTS notas_fiscais_status_check;

ALTER TABLE public.notas_fiscais
  ADD CONSTRAINT notas_fiscais_status_check
  CHECK (status IN (
    'rascunho',
    'validando',
    'pronta_para_emitir',
    'emitida_teste',
    'assinada',
    'transmitindo',
    'aguardando_sefaz',
    'autorizada',
    'rejeitada',
    'falha_temporaria',
    'falha_permanente',
    'cancelada',
    'inutilizada'
  ));

-- 4. Colunas específicas de NFS-e
ALTER TABLE public.notas_fiscais
  ADD COLUMN IF NOT EXISTS numero_dps          integer,
  ADD COLUMN IF NOT EXISTS serie_dps           integer,
  ADD COLUMN IF NOT EXISTS numero_nfse         text,
  ADD COLUMN IF NOT EXISTS chave_acesso_nfse   text,
  ADD COLUMN IF NOT EXISTS ambiente_nfse       smallint
    CHECK (ambiente_nfse IN (1, 2)),
  ADD COLUMN IF NOT EXISTS xml_dps_path        text,
  ADD COLUMN IF NOT EXISTS xml_nfse_path       text,
  ADD COLUMN IF NOT EXISTS dps_assinada_em     timestamptz,
  ADD COLUMN IF NOT EXISTS mensagens_retorno   jsonb,
  ADD COLUMN IF NOT EXISTS tentativas          integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_notas_chave_nfse ON public.notas_fiscais(chave_acesso_nfse);
CREATE INDEX IF NOT EXISTS idx_notas_tipo ON public.notas_fiscais(tipo);

-- chave NFS-e (50 chars) é UNIQUE quando preenchida
CREATE UNIQUE INDEX IF NOT EXISTS uq_notas_chave_nfse
  ON public.notas_fiscais(chave_acesso_nfse)
  WHERE chave_acesso_nfse IS NOT NULL;

-- 5. Bucket privado pros XMLs de NFS-e (DPS + retorno SEFIN)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'nfse-xml') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('nfse-xml', 'nfse-xml', false, 10485760,
            ARRAY['application/xml', 'text/xml']);
  END IF;
END $$;
