-- ============================================================
-- Flags que controlam quais integrações aparecem na sidebar
-- ------------------------------------------------------------
-- usa_stripe: mostra "Integração Stripe" no menu (padrão: false)
-- usa_ticto:  mostra "Integração Ticto"  no menu (padrão: false)
--
-- Separado de emite_nfse porque uma empresa pode emitir NFS-e
-- sem ter integração Stripe (ex: nota manual) e vice-versa.
-- ============================================================

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS usa_stripe boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS usa_ticto  boolean NOT NULL DEFAULT false;

-- UPWARD CREATIVE ACADEMY já usa Stripe (webhook configurado)
UPDATE public.empresas
SET usa_stripe = true
WHERE cnpj = '39280949000128';
