-- ============================================================
-- Fase 4.2: nfeProc autorizado + Carta de Correção (CC-e)
-- ============================================================

-- 1. Caminho do XML autorizado oficial (<nfeProc> = NFe + protNFe)
ALTER TABLE public.notas_fiscais
  ADD COLUMN IF NOT EXISTS xml_proc_path text;

-- 2. Permite o tipo de evento 'carta_correcao' já existe no check de 013, então
-- só validamos que não há regressão. (No-op se já permitido.)
-- A constraint criada em 013 já cobre 'carta_correcao' — nada a fazer aqui.
