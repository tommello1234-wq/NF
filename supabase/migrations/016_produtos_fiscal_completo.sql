-- ============================================================
-- Fase 5: Configuração fiscal completa por produto
-- Inspirada na arquitetura do ssÓtica (tabs CFOP/ICMS/ICMS-ST/IPI/PIS/COFINS).
-- Tudo aditivo (ADD COLUMN IF NOT EXISTS) para não quebrar dados existentes.
-- ============================================================

-- ------------------------------------------------------------
-- 1. CFOP por sentido e UF
-- ------------------------------------------------------------
ALTER TABLE public.produtos
  -- CFOP Saída — Dentro do Estado (mesmo UF do destinatário)
  ADD COLUMN IF NOT EXISTS cfop_venda_dentro            text,
  ADD COLUMN IF NOT EXISTS cfop_devolucao_dentro        text,
  ADD COLUMN IF NOT EXISTS cfop_remessa_garantia_dentro text,
  ADD COLUMN IF NOT EXISTS cfop_transferencia_dentro    text,
  ADD COLUMN IF NOT EXISTS cfop_venda_futura_dentro     text,
  ADD COLUMN IF NOT EXISTS cfop_entrega_venda_dentro    text,
  -- CFOP Saída — Fora do Estado
  ADD COLUMN IF NOT EXISTS cfop_venda_fora              text,
  ADD COLUMN IF NOT EXISTS cfop_devolucao_fora          text,
  ADD COLUMN IF NOT EXISTS cfop_remessa_garantia_fora   text,
  ADD COLUMN IF NOT EXISTS cfop_transferencia_fora      text,
  ADD COLUMN IF NOT EXISTS cfop_venda_futura_fora       text,
  ADD COLUMN IF NOT EXISTS cfop_entrega_venda_fora      text,
  -- CFOP Entrada
  ADD COLUMN IF NOT EXISTS cfop_compra_dentro           text,
  ADD COLUMN IF NOT EXISTS cfop_compra_fora             text;

-- ------------------------------------------------------------
-- 2. ICMS — CSOSN (Simples) e CST (Regime Normal) com variações de operação
-- ------------------------------------------------------------
ALTER TABLE public.produtos
  -- CSOSN/CST principal já existe em cst_csosn. Mantém retrocompat.
  ADD COLUMN IF NOT EXISTS csosn                        text,   -- preferido para CRT=1/4
  ADD COLUMN IF NOT EXISTS cst_icms                     text,   -- preferido para CRT=3
  -- CST específico para Venda Futura (O.S.) e Entrega
  ADD COLUMN IF NOT EXISTS cst_icms_venda_futura        text,
  ADD COLUMN IF NOT EXISTS cst_icms_entrega             text,
  -- Alíquotas e percentuais
  ADD COLUMN IF NOT EXISTS aliquota_credito_icms        numeric(5, 2),
  ADD COLUMN IF NOT EXISTS percentual_base_calculo_icms numeric(5, 2);

-- ------------------------------------------------------------
-- 3. ICMS-ST (Substituição Tributária)
-- ------------------------------------------------------------
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS aliquota_icms_st             numeric(5, 2),
  ADD COLUMN IF NOT EXISTS percentual_mva               numeric(5, 2),  -- Margem de Valor Adicionado
  ADD COLUMN IF NOT EXISTS percentual_reducao_bc_st     numeric(5, 2);

-- ------------------------------------------------------------
-- 4. IPI completo
-- ------------------------------------------------------------
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS codigo_enquadramento_ipi     text,
  ADD COLUMN IF NOT EXISTS tipo_calculo_ipi             text,        -- 'percentual' | 'valor'
  ADD COLUMN IF NOT EXISTS valor_unitario_ipi           numeric(14, 4),
  ADD COLUMN IF NOT EXISTS qtde_total_ipi               numeric(14, 4),
  ADD COLUMN IF NOT EXISTS classe_enquadramento_ipi     text,
  ADD COLUMN IF NOT EXISTS cnpj_produtor_ipi            text,
  ADD COLUMN IF NOT EXISTS codigo_selo_controle_ipi     text,
  ADD COLUMN IF NOT EXISTS qtde_selo_controle_ipi       numeric(14, 0);

-- ------------------------------------------------------------
-- 5. PIS / COFINS — tipo de cálculo e valor por unidade
-- ------------------------------------------------------------
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS tipo_calculo_pis             text,        -- 'percentual' | 'valor'
  ADD COLUMN IF NOT EXISTS valor_unitario_pis           numeric(14, 4),
  ADD COLUMN IF NOT EXISTS qtde_total_pis               numeric(14, 4),
  ADD COLUMN IF NOT EXISTS tipo_calculo_cofins          text,
  ADD COLUMN IF NOT EXISTS valor_unitario_cofins        numeric(14, 4),
  ADD COLUMN IF NOT EXISTS qtde_total_cofins            numeric(14, 4);

-- ------------------------------------------------------------
-- 6. Atributos auxiliares (referência, marca/grife, controle estoque)
-- ------------------------------------------------------------
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS referencia                   text,
  ADD COLUMN IF NOT EXISTS marca                        text,
  ADD COLUMN IF NOT EXISTS controla_estoque             boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS venda_somente_com_os         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS observacao                   text;

-- ------------------------------------------------------------
-- 7. Override fiscal por produto × empresa
--    (mesmo conceito do "+ Nova Configuração Fiscal" do ssÓtica)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.produtos_config_fiscal (
  id                            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  produto_id                    uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  empresa_id                    uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  -- Mesmos campos opcionais que sobrescrevem a config geral do produto
  cfop_venda_dentro             text,
  cfop_venda_fora               text,
  csosn                         text,
  cst_icms                      text,
  aliquota_icms                 numeric(5, 2),
  aliquota_credito_icms         numeric(5, 2),
  percentual_base_calculo_icms  numeric(5, 2),
  aliquota_icms_st              numeric(5, 2),
  percentual_mva                numeric(5, 2),
  cst_ipi                       text,
  aliquota_ipi                  numeric(5, 2),
  cst_pis                       text,
  aliquota_pis                  numeric(5, 2),
  cst_cofins                    text,
  aliquota_cofins               numeric(5, 2),
  observacao                    text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (produto_id, empresa_id)
);

CREATE INDEX IF NOT EXISTS idx_pcf_produto ON public.produtos_config_fiscal(produto_id);
CREATE INDEX IF NOT EXISTS idx_pcf_empresa ON public.produtos_config_fiscal(empresa_id);

ALTER TABLE public.produtos_config_fiscal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pcf_service" ON public.produtos_config_fiscal;
CREATE POLICY "pcf_service" ON public.produtos_config_fiscal
  FOR ALL TO service_role USING (true) WITH CHECK (true);
