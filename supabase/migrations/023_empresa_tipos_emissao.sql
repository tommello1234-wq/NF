-- ============================================================
-- Flags por empresa: o que ela emite (serviço vs mercadoria)
-- ------------------------------------------------------------
-- O painel é multi-tenant — UPWARD (SaaS) só emite NFS-e, NORTE-LAB
-- (ótica) emite NFS-e (exame/ajuste) E NF-e/NFC-e (óculos). Esses
-- flags fazem a sidebar esconder items que não fazem sentido pra
-- cada empresa, mantendo o painel limpo por workspace.
--
-- Defaults intencionais:
--   - emite_nfse = TRUE → quase toda empresa emite serviço; é o mais comum
--   - emite_nfe  = FALSE → só ativa pra quem realmente vende mercadoria
--                          (precisa cadastrar CSC, série, certificado SEFAZ,
--                          etc — desligar por default protege contra "lixo"
--                          no menu)
-- ============================================================

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS emite_nfse boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS emite_nfe  boolean NOT NULL DEFAULT false;
