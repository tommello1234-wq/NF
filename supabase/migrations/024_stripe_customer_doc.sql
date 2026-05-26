-- ============================================================
-- Tabela pra guardar CPF/CNPJ capturado no checkout.session.completed
-- ------------------------------------------------------------
-- Por que precisa: a Stripe NÃO copia o `custom_fields` do Checkout
-- Session pro `invoice.payment_succeeded`. Quando o cliente preenche
-- "CPF" via Payment Link, esse valor só aparece no evento
-- `checkout.session.completed`. Como a NFS-e é emitida com o invoice,
-- precisamos guardar o CPF ali na hora do checkout e buscar quando o
-- invoice chegar (segundos depois).
--
-- Chave única: (empresa_id, stripe_customer_id) — cada customer Stripe
-- só tem 1 CPF/CNPJ. Se vier outro update do mesmo customer (renovou
-- com CPF diferente?), substitui.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.stripe_customer_doc (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id          uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  stripe_customer_id  text NOT NULL,
  cpf                 text,
  cnpj                text,
  nome                text,
  email               text,
  fonte               text,  -- "checkout_session.custom_fields.CPF", etc — pra auditoria
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_customer_doc
  ON public.stripe_customer_doc(empresa_id, stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_stripe_customer_doc_empresa
  ON public.stripe_customer_doc(empresa_id);

ALTER TABLE public.stripe_customer_doc ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stripe_customer_doc_service" ON public.stripe_customer_doc;
CREATE POLICY "stripe_customer_doc_service" ON public.stripe_customer_doc
  FOR ALL TO service_role USING (true) WITH CHECK (true);
