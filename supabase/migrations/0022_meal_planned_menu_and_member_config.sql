-- MIGRATION 0022: CARDÁPIO PROGRAMADO DAS REFEIÇÕES + PERMISSÃO UNIVERSAL DE CONFIGURAÇÃO DE REFEIÇÕES
-- Segura, idempotente e não destrutiva: mantém dados existentes intactos.
-- Pré-requisito: migration 0014 aplicada (public.user_in_family, public.user_is_family_admin).

-- ============================================================================
-- 0. VALIDAÇÃO DE PRÉ-REQUISITOS ESTRUTURAIS
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.meal_configs') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.meal_configs não existe.';
  END IF;

  IF to_regclass('public.patients') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.patients não existe.';
  END IF;

  IF to_regprocedure('public.user_in_family(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.user_in_family(uuid) não encontrada.';
  END IF;

  IF to_regprocedure('public.user_is_family_admin(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.user_is_family_admin(uuid) não encontrada.';
  END IF;
END;
$$;

-- ============================================================================
-- 1. COLUNAS DE CARDÁPIO PROGRAMADO EM public.meal_configs
-- ============================================================================

ALTER TABLE public.meal_configs
  ADD COLUMN IF NOT EXISTS default_description TEXT,
  ADD COLUMN IF NOT EXISTS default_drink_description TEXT;

COMMENT ON COLUMN public.meal_configs.default_description IS
  'Cardápio ou preparo programado na rotina para orientar quem vai servir e pré-preencher o registro da refeição.';

COMMENT ON COLUMN public.meal_configs.default_drink_description IS
  'Bebida ou líquido sugerido na rotina para esta refeição.';

-- ============================================================================
-- 2. RLS: TODAS AS CONTAS ATIVAS DA FAMÍLIA PODEM CONFIGURAR O CARDÁPIO DE REFEIÇÕES
-- ============================================================================
-- Mantém SELECT e DELETE conforme política existente (DELETE continua exclusivo de ADMIN).
-- Permite que qualquer membro ativo da família (ADMIN, familiar ou cuidadora) atualize as
-- orientações do cardápio em public.meal_configs.

ALTER TABLE public.meal_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can update meal configs for their family's patients" ON public.meal_configs;
DROP POLICY IF EXISTS "Users can update meal configs for their family's patients" ON public.meal_configs;
DROP POLICY IF EXISTS "Family members can update meal configs for their family's patients" ON public.meal_configs;

CREATE POLICY "Family members can update meal configs for their family's patients"
  ON public.meal_configs
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = meal_configs.patient_id
        AND public.user_in_family(p.family_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = meal_configs.patient_id
        AND public.user_in_family(p.family_id)
    )
  );

-- Atualiza cache do PostgREST para expor as novas colunas imediatamente
NOTIFY pgrst, 'reload schema';
