-- ============================================================
-- Fase 5.1: Intermediador/Marketplace, Frete completo, Status granular e Tipos de Documento
-- Inspirado no formulário "Editando NF-e" do ssÓtica.
-- Tudo aditivo — não altera nem remove colunas/checks existentes.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Intermediador / Marketplace (grupo <infIntermed> da NF-e 4.0)
-- ------------------------------------------------------------
ALTER TABLE public.notas_fiscais
  ADD COLUMN IF NOT EXISTS ind_intermed                integer
    CHECK (ind_intermed IN (0, 1)),                                      -- 0=op. sem intermed, 1=marketplace
  ADD COLUMN IF NOT EXISTS cnpj_intermediador          text,
  ADD COLUMN IF NOT EXISTS id_cadastro_intermediador   text;

-- ------------------------------------------------------------
-- 2. Frete completo (grupo <transp> da NF-e)
-- ------------------------------------------------------------
ALTER TABLE public.notas_fiscais
  ADD COLUMN IF NOT EXISTS modalidade_frete            integer
    CHECK (modalidade_frete BETWEEN 0 AND 9),                            -- modFrete
  ADD COLUMN IF NOT EXISTS transportadora_nome         text,
  ADD COLUMN IF NOT EXISTS transportadora_cnpj_cpf     text,
  ADD COLUMN IF NOT EXISTS transportadora_ie           text,
  ADD COLUMN IF NOT EXISTS transportadora_endereco     text,
  ADD COLUMN IF NOT EXISTS transportadora_municipio    text,
  ADD COLUMN IF NOT EXISTS transportadora_uf           text,
  ADD COLUMN IF NOT EXISTS frete_soma_total_nota       boolean NOT NULL DEFAULT true,
  -- Veículo
  ADD COLUMN IF NOT EXISTS veiculo_placa               text,
  ADD COLUMN IF NOT EXISTS veiculo_uf                  text,
  ADD COLUMN IF NOT EXISTS veiculo_rntc                text,
  -- Volumes
  ADD COLUMN IF NOT EXISTS volumes_quantidade          integer,
  ADD COLUMN IF NOT EXISTS volumes_especie             text,
  ADD COLUMN IF NOT EXISTS volumes_marca               text,
  ADD COLUMN IF NOT EXISTS volumes_numeracao           text,
  ADD COLUMN IF NOT EXISTS volumes_peso_liquido        numeric(14, 3),
  ADD COLUMN IF NOT EXISTS volumes_peso_bruto          numeric(14, 3);

-- ------------------------------------------------------------
-- 3. Tipo de documento fiscal (Venda/Devolução/Garantia/Importação/Outros)
-- ------------------------------------------------------------
ALTER TABLE public.notas_fiscais
  ADD COLUMN IF NOT EXISTS tipo_documento text DEFAULT 'venda';

-- Constraint criada de forma idempotente (recria com NOT VALID se já existe).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'notas_fiscais_tipo_documento_check'
  ) THEN
    ALTER TABLE public.notas_fiscais
      ADD CONSTRAINT notas_fiscais_tipo_documento_check
      CHECK (tipo_documento IN (
        'venda',
        'devolucao',
        'devolucao_xml',
        'remessa_garantia',
        'remessa_garantia_xml',
        'importacao',
        'outros',
        'complementar',
        'ajuste'
      ));
  END IF;
END$$;

-- ------------------------------------------------------------
-- 4. Status granular (estilo ssÓtica)
-- ------------------------------------------------------------
ALTER TABLE public.notas_fiscais
  ADD COLUMN IF NOT EXISTS status_detalhado text;

-- 'rascunho','em_processamento','autorizada','denegada','rejeitada','cancelada',
-- 'inutilizada','contingencia_offline_rejeitada','falha_comunicacao'.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'notas_fiscais_status_detalhado_check'
  ) THEN
    ALTER TABLE public.notas_fiscais
      ADD CONSTRAINT notas_fiscais_status_detalhado_check
      CHECK (status_detalhado IS NULL OR status_detalhado IN (
        'rascunho',
        'em_processamento',
        'autorizada',
        'denegada',
        'rejeitada',
        'cancelada',
        'inutilizada',
        'contingencia_offline_rejeitada',
        'falha_comunicacao'
      ));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_notas_status_detalhado ON public.notas_fiscais(status_detalhado);
CREATE INDEX IF NOT EXISTS idx_notas_tipo_documento   ON public.notas_fiscais(tipo_documento);

-- ------------------------------------------------------------
-- 5. Flags de envio (espelhando "Enviar Danfe e XML por email após emitir")
-- ------------------------------------------------------------
ALTER TABLE public.notas_fiscais
  ADD COLUMN IF NOT EXISTS enviar_email_pos_emissao   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_enviado_em           timestamptz,
  ADD COLUMN IF NOT EXISTS email_destinatario         text;

-- ------------------------------------------------------------
-- 6. Documento de referência (devolução / complementar precisam apontar pra outra NF-e)
-- ------------------------------------------------------------
ALTER TABLE public.notas_fiscais
  ADD COLUMN IF NOT EXISTS chave_acesso_referenciada  text,
  ADD COLUMN IF NOT EXISTS nf_referencia_id            uuid REFERENCES public.notas_fiscais(id);
