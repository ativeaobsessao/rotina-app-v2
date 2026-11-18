-- MIGRATION 0018: PERMITIR QUE TODAS AS CONTAS VINCULADAS À FAMÍLIA ENCERREM O DIA
-- Segura, idempotente e não destrutiva: libera INSERT em daily_closures para qualquer vínculo ativo
-- em public.family_members (FAMILY/CAREGIVER, ADMIN/MEMBER) exigindo autoria (closed_by = auth.uid()),
-- enquanto mantém a reabertura de dias encerrados (DELETE) estritamente restrita a ADMIN.

-- ============================================================================
-- 0. VALIDAÇÃO DE PRÉ-REQUISITOS
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.daily_closures') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.daily_closures não existe.';
  END IF;

  IF to_regclass('public.patients') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.patients não existe.';
  END IF;

  IF to_regclass('public.family_members') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.family_members não existe.';
  END IF;

  IF to_regprocedure('public.user_in_family(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: função public.user_in_family(uuid) não encontrada. Aplique a migration 0014.';
  END IF;

  IF to_regprocedure('public.user_is_family_admin(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: função public.user_is_family_admin(uuid) não encontrada. Aplique a migration 0014.';
  END IF;
END;
$$;

-- ============================================================================
-- 1. DAILY CLOSURES: ENCERRAMENTO (INSERT) PARA TODOS OS MEMBROS ATIVOS;
--    REABERTURA (DELETE) PERMANECE RESTRITA A ADMIN
-- ============================================================================

ALTER TABLE public.daily_closures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert daily closures for their family" ON public.daily_closures;
DROP POLICY IF EXISTS "Admins can insert daily closures for their family" ON public.daily_closures;
DROP POLICY IF EXISTS "Family members can insert daily closures for their family" ON public.daily_closures;

CREATE POLICY "Family members can insert daily closures for their family"
  ON public.daily_closures
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.user_in_family(family_id)
    AND closed_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.patients p
      WHERE p.id = daily_closures.patient_id
        AND p.family_id = daily_closures.family_id
    )
  );

-- Garante que leitura para membros ativos e reabertura exclusiva de ADMIN seguem íntegras
DROP POLICY IF EXISTS "Users can view daily closures of their family" ON public.daily_closures;
CREATE POLICY "Users can view daily closures of their family"
  ON public.daily_closures
  FOR SELECT
  TO authenticated
  USING (public.user_in_family(family_id));

DROP POLICY IF EXISTS "Users can delete daily closures of their family" ON public.daily_closures;
DROP POLICY IF EXISTS "Admins can delete daily closures of their family" ON public.daily_closures;
CREATE POLICY "Admins can delete daily closures of their family"
  ON public.daily_closures
  FOR DELETE
  TO authenticated
  USING (public.user_is_family_admin(family_id));

NOTIFY pgrst, 'reload schema';
