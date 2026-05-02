-- ============================================================
-- Fase 2: Configuração Fiscal por empresa
-- Adiciona campos de série, numeração e status fiscal
-- Expande os status permitidos de notas_fiscais
-- ============================================================

-- 1. Novos campos na tabela empresas
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS serie_nfe      integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS proximo_numero_nfe   integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS serie_nfce     integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS proximo_numero_nfce  integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS tipo_emissao_habilitado text NOT NULL DEFAULT 'teste_local'
    CHECK (tipo_emissao_habilitado IN ('teste_local', 'nfe', 'nfce', 'nfe_nfce')),
  ADD COLUMN IF NOT EXISTS status_fiscal  text NOT NULL DEFAULT 'incompleta'
    CHECK (status_fiscal IN ('incompleta', 'pronta_homologacao', 'pronta_producao'));

-- 2. Expandir status permitidos em notas_fiscais
-- Remove o constraint antigo e cria um novo mais completo
ALTER TABLE public.notas_fiscais
  DROP CONSTRAINT IF EXISTS notas_fiscais_status_check;

ALTER TABLE public.notas_fiscais
  ADD CONSTRAINT notas_fiscais_status_check
  CHECK (status IN (
    'rascunho',
    'validando',
    'pronta_para_emitir',
    'emitida_teste',
    'aguardando_sefaz',
    'autorizada',
    'rejeitada',
    'cancelada',
    'inutilizada'
  ));
