-- ============================================================
-- Fase NFS-e: tabela de eventos de webhook (idempotência)
-- Garante que o mesmo evento (gateway de pagamento) só dispare uma única
-- emissão de NFS-e mesmo se o gateway retransmitir o webhook.
-- A unique key é (provider, external_id) — provider='ticto' para o caso atual.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  provider        text NOT NULL,
  external_id     text NOT NULL,
  empresa_id      uuid REFERENCES public.empresas(id) ON DELETE SET NULL,
  event_type      text,
  payload         jsonb NOT NULL,
  nota_fiscal_id  uuid REFERENCES public.notas_fiscais(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'recebido'
    CHECK (status IN ('recebido', 'processando', 'processado', 'ignorado', 'erro')),
  erro            text,
  recebido_em     timestamptz NOT NULL DEFAULT now(),
  processado_em   timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_provider_external
  ON public.webhook_events(provider, external_id);

CREATE INDEX IF NOT EXISTS idx_webhook_empresa ON public.webhook_events(empresa_id);
CREATE INDEX IF NOT EXISTS idx_webhook_status ON public.webhook_events(status);
CREATE INDEX IF NOT EXISTS idx_webhook_recebido ON public.webhook_events(recebido_em DESC);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "webhook_events_service" ON public.webhook_events;
CREATE POLICY "webhook_events_service" ON public.webhook_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
