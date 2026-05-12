-- ============================================================
-- Fase NFS-e: configuração NFS-e por empresa
-- Acrescenta os campos necessários para emissão pelo Padrão Nacional NFS-e:
-- inscrição municipal, código IBGE do município emissor, regime especial,
-- ambiente, série e numeração DPS, e padrões de tributação (LC 116).
-- ============================================================

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS inscricao_municipal                 text,
  ADD COLUMN IF NOT EXISTS municipio_emissor_codigo            text,
  ADD COLUMN IF NOT EXISTS regime_especial_tributacao          text,
  ADD COLUMN IF NOT EXISTS incentivo_fiscal                    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nfse_ambiente                       smallint NOT NULL DEFAULT 2
    CHECK (nfse_ambiente IN (1, 2)),
  ADD COLUMN IF NOT EXISTS serie_dps                           integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS proximo_numero_dps                  integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS nfse_codigo_lc116_padrao            text,
  ADD COLUMN IF NOT EXISTS nfse_codigo_tributario_municipal_padrao text;

-- Sobral tem código IBGE 2312908 — preenchimento default opcional, mas
-- não setamos automático aqui pra empresas existentes (cada uma confirma
-- pelo painel onde está estabelecida).
