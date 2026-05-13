-- ============================================================
-- Fase 5.2: Vendas e Ordens de Serviço (espelhando a estrutura do ssÓtica)
-- O propósito é permitir o fluxo "OS → Venda → NFC-e automática".
-- Tudo idempotente (IF NOT EXISTS).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Ordens de Serviço (com receita óptica embutida)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ordens_servico (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id            uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  cliente_id            uuid REFERENCES public.clientes(id),
  numero                integer,
  tipo                  text,
  funcionario           text,
  data_registro         timestamptz NOT NULL DEFAULT now(),
  data_entrega          timestamptz,
  observacao            text,
  status                text NOT NULL DEFAULT 'aberta'
    CHECK (status IN ('aberta', 'em_producao', 'finalizada', 'entregue', 'cancelada')),
  -- Receita óptica (LONGE/PERTO OD/OE: Esférico, Cilíndrico, Eixo, Altura, DNP) — JSON pra flexibilidade
  receita               jsonb,
  imagem_receita_url    text,
  -- Armação (Sim/Não, formato 1-8, dimensões)
  armacao               jsonb,
  -- Tratamentos da lente (array)
  tratamentos           text[],
  observacao_receita    text,
  imagens_os            text[],
  valor_total           numeric(14, 2),
  origem_cliente        text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_os_empresa  ON public.ordens_servico(empresa_id);
CREATE INDEX IF NOT EXISTS idx_os_cliente  ON public.ordens_servico(cliente_id);
CREATE INDEX IF NOT EXISTS idx_os_status   ON public.ordens_servico(status);

ALTER TABLE public.ordens_servico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "os_service" ON public.ordens_servico;
CREATE POLICY "os_service" ON public.ordens_servico
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ordens_servico_itens (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  os_id           uuid NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  produto_id      uuid REFERENCES public.produtos(id),
  descricao       text NOT NULL,
  quantidade      numeric(14, 4) NOT NULL DEFAULT 1,
  valor_unitario  numeric(14, 2) NOT NULL,
  desconto        numeric(14, 2) NOT NULL DEFAULT 0,
  acrescimo       numeric(14, 2) NOT NULL DEFAULT 0,
  valor_total     numeric(14, 2) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_os_itens_os ON public.ordens_servico_itens(os_id);

ALTER TABLE public.ordens_servico_itens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "os_itens_service" ON public.ordens_servico_itens;
CREATE POLICY "os_itens_service" ON public.ordens_servico_itens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- 2. Vendas (que viram NFC-e automaticamente)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vendas (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id            uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  cliente_id            uuid REFERENCES public.clientes(id),
  os_id                 uuid REFERENCES public.ordens_servico(id),
  numero                integer,
  funcionario           text,
  data_venda            timestamptz NOT NULL DEFAULT now(),
  observacao            text,
  origem_cliente        text,
  -- Totais
  valor_produtos        numeric(14, 2) NOT NULL DEFAULT 0,
  valor_desconto        numeric(14, 2) NOT NULL DEFAULT 0,
  valor_acrescimo       numeric(14, 2) NOT NULL DEFAULT 0,
  valor_total           numeric(14, 2) NOT NULL DEFAULT 0,
  -- Pagamento (resumo — detalhes em vendas_pagamentos)
  forma_pagamento_padrao text,
  status                text NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'aberta', 'paga', 'cancelada')),
  -- Vínculo automático com a NFC-e gerada
  nota_fiscal_id        uuid REFERENCES public.notas_fiscais(id),
  emitir_nfce_automatico boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendas_empresa ON public.vendas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_vendas_cliente ON public.vendas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_vendas_os      ON public.vendas(os_id);
CREATE INDEX IF NOT EXISTS idx_vendas_nota    ON public.vendas(nota_fiscal_id);
CREATE INDEX IF NOT EXISTS idx_vendas_status  ON public.vendas(status);

ALTER TABLE public.vendas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vendas_service" ON public.vendas;
CREATE POLICY "vendas_service" ON public.vendas
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.vendas_itens (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  venda_id        uuid NOT NULL REFERENCES public.vendas(id) ON DELETE CASCADE,
  produto_id      uuid REFERENCES public.produtos(id),
  descricao       text NOT NULL,
  quantidade      numeric(14, 4) NOT NULL DEFAULT 1,
  valor_unitario  numeric(14, 2) NOT NULL,
  desconto        numeric(14, 2) NOT NULL DEFAULT 0,
  acrescimo       numeric(14, 2) NOT NULL DEFAULT 0,
  valor_total     numeric(14, 2) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendas_itens_venda ON public.vendas_itens(venda_id);

ALTER TABLE public.vendas_itens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vendas_itens_service" ON public.vendas_itens;
CREATE POLICY "vendas_itens_service" ON public.vendas_itens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.vendas_pagamentos (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  venda_id            uuid NOT NULL REFERENCES public.vendas(id) ON DELETE CASCADE,
  forma_pagamento     text NOT NULL,
  valor               numeric(14, 2) NOT NULL,
  parcelas            integer NOT NULL DEFAULT 1,
  primeiro_vencimento date,
  codigo_autorizacao  text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendas_pagamentos_venda ON public.vendas_pagamentos(venda_id);

ALTER TABLE public.vendas_pagamentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vendas_pagamentos_service" ON public.vendas_pagamentos;
CREATE POLICY "vendas_pagamentos_service" ON public.vendas_pagamentos
  FOR ALL TO service_role USING (true) WITH CHECK (true);
