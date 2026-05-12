-- ============================================================
-- Fase 4: Complementos para emissão NF-e (modelo 55) e NFC-e (modelo 65)
-- Esqueleto de teste — não popula dados, só estende o schema.
-- ============================================================

-- 1. Campos fiscais adicionais em produtos (necessários pra mercadoria física)
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS gtin            text,                              -- EAN/código de barras (ou 'SEM GTIN')
  ADD COLUMN IF NOT EXISTS cest            text,                              -- Código Especificador da Substituição Tributária
  ADD COLUMN IF NOT EXISTS peso_liquido    numeric(10, 3),
  ADD COLUMN IF NOT EXISTS peso_bruto      numeric(10, 3),
  ADD COLUMN IF NOT EXISTS unidade_tributavel text,                           -- Pode ser diferente da unidade comercial
  ADD COLUMN IF NOT EXISTS ex_tipi         text,                              -- Excecao TIPI (IPI)
  ADD COLUMN IF NOT EXISTS aliquota_ipi    numeric(5, 2),
  ADD COLUMN IF NOT EXISTS cst_pis         text,
  ADD COLUMN IF NOT EXISTS cst_cofins      text,
  ADD COLUMN IF NOT EXISTS cst_ipi         text,
  ADD COLUMN IF NOT EXISTS info_adicional_produto text;

-- 2. Campos NF-e/NFC-e específicos em notas_fiscais
ALTER TABLE public.notas_fiscais
  ADD COLUMN IF NOT EXISTS modelo                 integer
    CHECK (modelo IN (55, 65)),                                              -- 55=NF-e, 65=NFC-e
  ADD COLUMN IF NOT EXISTS natureza_operacao_id   uuid REFERENCES public.naturezas_operacao(id),
  ADD COLUMN IF NOT EXISTS cliente_id             uuid REFERENCES public.clientes(id),
  ADD COLUMN IF NOT EXISTS ambiente_nfe           integer
    CHECK (ambiente_nfe IN (1, 2)),                                          -- 1=produção, 2=homologação
  ADD COLUMN IF NOT EXISTS finalidade             integer
    CHECK (finalidade IN (1, 2, 3, 4)),                                      -- 1=normal,2=complementar,3=ajuste,4=devolução
  ADD COLUMN IF NOT EXISTS consumidor_final       boolean,
  ADD COLUMN IF NOT EXISTS indicador_presenca     integer
    CHECK (indicador_presenca BETWEEN 0 AND 9),
  ADD COLUMN IF NOT EXISTS valor_produtos         numeric(14, 2),
  ADD COLUMN IF NOT EXISTS valor_desconto         numeric(14, 2),
  ADD COLUMN IF NOT EXISTS valor_frete            numeric(14, 2),
  ADD COLUMN IF NOT EXISTS valor_seguro           numeric(14, 2),
  ADD COLUMN IF NOT EXISTS valor_outras_despesas  numeric(14, 2),
  ADD COLUMN IF NOT EXISTS valor_icms             numeric(14, 2),
  ADD COLUMN IF NOT EXISTS valor_icms_st          numeric(14, 2),
  ADD COLUMN IF NOT EXISTS valor_ipi              numeric(14, 2),
  ADD COLUMN IF NOT EXISTS valor_pis              numeric(14, 2),
  ADD COLUMN IF NOT EXISTS valor_cofins           numeric(14, 2),
  ADD COLUMN IF NOT EXISTS valor_total_tributos   numeric(14, 2),
  ADD COLUMN IF NOT EXISTS qr_code_nfce           text,                       -- URL completa do QR Code (modelo 65)
  ADD COLUMN IF NOT EXISTS url_consulta_nfce      text,                       -- URL pública pra consulta
  ADD COLUMN IF NOT EXISTS csc_id_usado           text,                       -- ID do CSC usado na assinatura do QR
  ADD COLUMN IF NOT EXISTS digest_value           text,                       -- Hash do XML assinado
  ADD COLUMN IF NOT EXISTS data_autorizacao       timestamptz,
  ADD COLUMN IF NOT EXISTS info_complementar      text,
  ADD COLUMN IF NOT EXISTS forma_pagamento        text,                       -- 01=Dinheiro,03=Cartão Crédito,04=Cartão Débito,15=Boleto,17=PIX
  ADD COLUMN IF NOT EXISTS valor_pago             numeric(14, 2),
  ADD COLUMN IF NOT EXISTS troco                  numeric(14, 2);

CREATE INDEX IF NOT EXISTS idx_notas_modelo  ON public.notas_fiscais(modelo);
CREATE INDEX IF NOT EXISTS idx_notas_cliente ON public.notas_fiscais(cliente_id);

-- 3. Itens de nota fiscal (uma linha por produto vendido)
CREATE TABLE IF NOT EXISTS public.notas_fiscais_itens (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nota_id               uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE CASCADE,
  produto_id            uuid REFERENCES public.produtos(id),
  numero_item           integer NOT NULL,                                    -- nItem no XML
  codigo_produto        text NOT NULL,
  descricao             text NOT NULL,
  ncm                   text,
  cest                  text,
  cfop                  text,
  unidade_comercial     text,
  quantidade_comercial  numeric(14, 4) NOT NULL,
  valor_unitario        numeric(14, 4) NOT NULL,
  valor_total           numeric(14, 2) NOT NULL,
  valor_desconto        numeric(14, 2),
  gtin                  text,
  origem                integer,
  cst_csosn             text,
  aliquota_icms         numeric(5, 2),
  valor_icms            numeric(14, 2),
  cst_pis               text,
  aliquota_pis          numeric(5, 2),
  valor_pis             numeric(14, 2),
  cst_cofins            text,
  aliquota_cofins       numeric(5, 2),
  valor_cofins          numeric(14, 2),
  info_adicional        text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_itens_nota    ON public.notas_fiscais_itens(nota_id);
CREATE INDEX IF NOT EXISTS idx_itens_produto ON public.notas_fiscais_itens(produto_id);

ALTER TABLE public.notas_fiscais_itens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notas_itens_service" ON public.notas_fiscais_itens;
CREATE POLICY "notas_itens_service" ON public.notas_fiscais_itens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. Eventos de nota (cancelamento, inutilização, carta de correção)
CREATE TABLE IF NOT EXISTS public.notas_fiscais_eventos (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nota_id               uuid REFERENCES public.notas_fiscais(id) ON DELETE CASCADE,
  empresa_id            uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tipo_evento           text NOT NULL
    CHECK (tipo_evento IN ('cancelamento', 'inutilizacao', 'carta_correcao')),
  sequencial            integer NOT NULL DEFAULT 1,
  motivo                text,
  protocolo             text,
  status                text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'autorizado', 'rejeitado')),
  xml_evento_path       text,
  xml_retorno_path      text,
  data_evento           timestamptz,
  mensagens_retorno     jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eventos_nota    ON public.notas_fiscais_eventos(nota_id);
CREATE INDEX IF NOT EXISTS idx_eventos_empresa ON public.notas_fiscais_eventos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_eventos_tipo    ON public.notas_fiscais_eventos(tipo_evento);

ALTER TABLE public.notas_fiscais_eventos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notas_eventos_service" ON public.notas_fiscais_eventos;
CREATE POLICY "notas_eventos_service" ON public.notas_fiscais_eventos
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. Range de inutilização (quando precisa "queimar" um intervalo de números)
CREATE TABLE IF NOT EXISTS public.inutilizacoes (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id            uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  modelo                integer NOT NULL CHECK (modelo IN (55, 65)),
  serie                 integer NOT NULL,
  numero_inicial        integer NOT NULL,
  numero_final          integer NOT NULL,
  ano                   integer NOT NULL,
  justificativa         text NOT NULL,
  protocolo             text,
  status                text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'autorizada', 'rejeitada')),
  xml_pedido_path       text,
  xml_retorno_path      text,
  data_processamento    timestamptz,
  mensagens_retorno     jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inutil_empresa ON public.inutilizacoes(empresa_id);

ALTER TABLE public.inutilizacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inutilizacoes_service" ON public.inutilizacoes;
CREATE POLICY "inutilizacoes_service" ON public.inutilizacoes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
