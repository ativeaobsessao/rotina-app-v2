-- MIGRATION 0016: ENTREGA 04 - PERMITIR QUE TODOS OS MEMBROS ATIVOS DA FAMÍLIA REGISTRAREM OS CUIDADOS DIÁRIOS
-- Segura, idempotente e não destrutiva: mantém dados, autoria original e travas administrativas intactos.
-- Pré-requisito: migration 0014_rbac_and_rls_hardening.sql já aplicada.

-- ============================================================================
-- 0. VALIDAÇÃO DE PRÉ-REQUISITOS ESTRUTURAIS
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.family_members') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.family_members não existe.';
  END IF;

  IF to_regclass('public.patients') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.patients não existe.';
  END IF;

  IF to_regclass('public.meal_logs') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.meal_logs não existe.';
  END IF;

  IF to_regclass('public.medication_logs') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.medication_logs não existe.';
  END IF;

  IF to_regclass('public.daily_mood_logs') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.daily_mood_logs não existe.';
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
-- 1. STORAGE: LIBERAR UPLOAD/EDIÇÃO/REMOÇÃO EM 'meal-records' PARA MEMBROS ATIVOS
--    - 'patient-profile/avatars/{auth.uid()}/...' : apenas o próprio usuário
--    - 'patient-profile/{patient_id}/...'         : SOMENTE ADMIN ativo da família
--    - 'meal-records/{patient_id}/...'            : qualquer membro ativo em family_members (ADMIN ou MEMBER)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.user_can_write_storage_path(bucket_name text, object_name text)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  first_segment TEXT;
  second_segment TEXT;
  extracted_patient_id UUID;
  patient_family_id UUID;
BEGIN
  IF auth.uid() IS NULL OR bucket_name IS NULL OR object_name IS NULL OR btrim(object_name) = '' THEN
    RETURN FALSE;
  END IF;

  first_segment := split_part(object_name, '/', 1);

  IF bucket_name = 'patient-profile' AND first_segment = 'avatars' THEN
    second_segment := split_part(object_name, '/', 2);
    RETURN second_segment <> '' AND second_segment = auth.uid()::text;
  END IF;

  IF bucket_name NOT IN ('patient-profile', 'meal-records') THEN
    RETURN FALSE;
  END IF;

  BEGIN
    extracted_patient_id := first_segment::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN FALSE;
  END;

  SELECT family_id
  INTO patient_family_id
  FROM public.patients
  WHERE id = extracted_patient_id
  LIMIT 1;

  IF patient_family_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Fotos de refeições ('meal-records'): qualquer vínculo ativo em family_members (FAMILY/CAREGIVER, ADMIN/MEMBER)
  IF bucket_name = 'meal-records' THEN
    RETURN public.user_in_family(patient_family_id);
  END IF;

  -- Foto do paciente ('patient-profile'): permanece estritamente restrita a ADMIN
  RETURN public.user_is_family_admin(patient_family_id);
END;
$$;

REVOKE ALL ON FUNCTION public.user_can_write_storage_path(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_write_storage_path(text, text) TO authenticated, service_role;

-- ============================================================================
-- 2. MEAL LOGS: INSERT/UPDATE PARA QUALQUER MEMBRO ATIVO DA FAMÍLIA (DELETE SEGUE ADMIN)
-- ============================================================================

ALTER TABLE public.meal_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert meal logs for their family's patients" ON public.meal_logs;
DROP POLICY IF EXISTS "Users can update meal logs for their family's patients" ON public.meal_logs;
DROP POLICY IF EXISTS "Admins can insert meal logs for their family's patients" ON public.meal_logs;
DROP POLICY IF EXISTS "Admins can update meal logs for their family's patients" ON public.meal_logs;
DROP POLICY IF EXISTS "Family members can insert meal logs for their family's patients" ON public.meal_logs;
DROP POLICY IF EXISTS "Family members can update meal logs for their family's patients" ON public.meal_logs;

CREATE POLICY "Family members can insert meal logs for their family's patients"
  ON public.meal_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND updated_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.patients p
      WHERE p.id = meal_logs.patient_id
        AND public.user_in_family(p.family_id)
    )
  );

CREATE POLICY "Family members can update meal logs for their family's patients"
  ON public.meal_logs
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.patients p
      WHERE p.id = meal_logs.patient_id
        AND public.user_in_family(p.family_id)
    )
  )
  WITH CHECK (
    updated_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.patients p
      WHERE p.id = meal_logs.patient_id
        AND public.user_in_family(p.family_id)
    )
  );

-- ============================================================================
-- 3. MEDICATION LOGS: INSERT/UPDATE PARA QUALQUER MEMBRO ATIVO DA FAMÍLIA (DELETE SEGUE ADMIN)
-- ============================================================================

ALTER TABLE public.medication_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert med logs for their family's patients" ON public.medication_logs;
DROP POLICY IF EXISTS "Users can update med logs for their family's patients" ON public.medication_logs;
DROP POLICY IF EXISTS "Admins can insert med logs for their family's patients" ON public.medication_logs;
DROP POLICY IF EXISTS "Admins can update med logs for their family's patients" ON public.medication_logs;
DROP POLICY IF EXISTS "Family members can insert med logs for their family's patients" ON public.medication_logs;
DROP POLICY IF EXISTS "Family members can update med logs for their family's patients" ON public.medication_logs;

CREATE POLICY "Family members can insert med logs for their family's patients"
  ON public.medication_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND updated_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.patients p
      WHERE p.id = medication_logs.patient_id
        AND public.user_in_family(p.family_id)
    )
  );

CREATE POLICY "Family members can update med logs for their family's patients"
  ON public.medication_logs
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.patients p
      WHERE p.id = medication_logs.patient_id
        AND public.user_in_family(p.family_id)
    )
  )
  WITH CHECK (
    updated_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.patients p
      WHERE p.id = medication_logs.patient_id
        AND public.user_in_family(p.family_id)
    )
  );

-- ============================================================================
-- 4. DAILY MOOD LOGS: INSERT/UPDATE PARA QUALQUER MEMBRO ATIVO DA FAMÍLIA (DELETE SEGUE ADMIN)
-- ============================================================================

ALTER TABLE public.daily_mood_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Membros da família podem registrar ou atualizar o estado de espírito" ON public.daily_mood_logs;
DROP POLICY IF EXISTS "Apenas administradores podem inserir o estado de espírito" ON public.daily_mood_logs;
DROP POLICY IF EXISTS "Apenas administradores podem atualizar o estado de espírito" ON public.daily_mood_logs;
DROP POLICY IF EXISTS "Membros da família podem inserir o estado de espírito" ON public.daily_mood_logs;
DROP POLICY IF EXISTS "Membros da família podem atualizar o estado de espírito" ON public.daily_mood_logs;

CREATE POLICY "Membros da família podem inserir o estado de espírito"
  ON public.daily_mood_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    updated_by = auth.uid()
    AND public.user_in_family(family_id)
    AND EXISTS (
      SELECT 1
      FROM public.patients p
      WHERE p.id = daily_mood_logs.patient_id
        AND p.family_id = daily_mood_logs.family_id
    )
  );

CREATE POLICY "Membros da família podem atualizar o estado de espírito"
  ON public.daily_mood_logs
  FOR UPDATE
  TO authenticated
  USING (public.user_in_family(family_id))
  WITH CHECK (
    updated_by = auth.uid()
    AND public.user_in_family(family_id)
    AND EXISTS (
      SELECT 1
      FROM public.patients p
      WHERE p.id = daily_mood_logs.patient_id
        AND p.family_id = daily_mood_logs.family_id
    )
  );

-- ============================================================================
-- 5. PRESERVAÇÃO EXPLÍCITA DAS TRIGGERS DE AUTORIA E DIA ENCERRADO
-- ============================================================================
-- As triggers prevent_meal_mutation_on_closed_day, prevent_med_mutation_on_closed_day,
-- preserve_meal_log_creator e preserve_medication_log_creator permanecem ativas sem alterações.
-- As políticas DELETE de meal_logs, medication_logs e daily_mood_logs seguem estritas a ADMIN.
-- Todas as tabelas administrativas (patients, meal_configs, medication_periods, medications,
-- daily_closures, family_members, family_invites) e bucket patient-profile seguem estritas a ADMIN.

NOTIFY pgrst, 'reload schema';
