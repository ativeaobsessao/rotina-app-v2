-- MIGRATION 0013: PRODUCTION INTEGRITY, RLS & SCHEMA PARITY FIXES
-- Segura e idempotente: NÃO remove nem altera dados existentes.

-- 0. Garantir função auxiliar public.user_in_family(UUID)
-- Alguns ambientes que pularam a migration 0006 podem não possuir esta função.
CREATE OR REPLACE FUNCTION public.user_in_family(f_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL OR f_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF to_regclass('public.family_members') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.family_members WHERE family_id = $1 AND user_id = $2)'
      INTO v_match
      USING f_id, auth.uid();
    IF COALESCE(v_match, FALSE) THEN
      RETURN TRUE;
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND family_id = f_id
  ) INTO v_match;

  RETURN COALESCE(v_match, FALSE);
END;
$$;

-- 1. Garantir paridade de colunas usadas pelo frontend
ALTER TABLE public.patients
ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('M', 'F'));

ALTER TABLE public.meal_logs
ADD COLUMN IF NOT EXISTS meal_time TIME;

ALTER TABLE public.meal_logs
ADD COLUMN IF NOT EXISTS drink_description TEXT;

-- 2. Corrigir política RLS ausente para reabertura de dia (DELETE em daily_closures)
-- Sem esta política, deleteDailyClosure falhava silenciosamente retornando 0 linhas removidas.
DROP POLICY IF EXISTS "Users can delete daily closures of their family" ON public.daily_closures;
CREATE POLICY "Users can delete daily closures of their family"
  ON public.daily_closures
  FOR DELETE
  USING (public.user_in_family(family_id));

-- 3. Permitir upload/leitura segura de avatar próprio em patient-profile/avatars/{auth.uid()}/...
-- mantendo a trava estrita de família para fotos de pacientes ({patient_id}/...).
CREATE OR REPLACE FUNCTION public.user_can_access_storage_path(object_name text)
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
  v_shared_family BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  first_segment := split_part(object_name, '/', 1);

  IF first_segment = 'avatars' THEN
    second_segment := split_part(object_name, '/', 2);
    IF second_segment = auth.uid()::text THEN
      RETURN TRUE;
    END IF;

    IF to_regclass('public.family_members') IS NOT NULL THEN
      EXECUTE '
        SELECT EXISTS (
          SELECT 1
          FROM public.family_members me
          JOIN public.family_members target ON target.family_id = me.family_id
          WHERE me.user_id = $1
            AND target.user_id::text = $2
        )'
        INTO v_shared_family
        USING auth.uid(), second_segment;
      IF COALESCE(v_shared_family, FALSE) THEN
        RETURN TRUE;
      END IF;
    END IF;

    RETURN EXISTS (
      SELECT 1
      FROM public.profiles me
      JOIN public.profiles target ON target.family_id = me.family_id
      WHERE me.id = auth.uid()
        AND target.id::text = second_segment
    );
  END IF;

  BEGIN
    extracted_patient_id := first_segment::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN FALSE;
  END;

  SELECT family_id INTO patient_family_id FROM public.patients WHERE id = extracted_patient_id LIMIT 1;
  IF patient_family_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN public.user_in_family(patient_family_id);
END;
$$;

-- 4. Índices compostos para consultas diárias e histórico
CREATE INDEX IF NOT EXISTS idx_meal_logs_patient_event_date
  ON public.meal_logs(patient_id, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_medication_logs_patient_event_date
  ON public.medication_logs(patient_id, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_closures_patient_date
  ON public.daily_closures(patient_id, date DESC);

NOTIFY pgrst, 'reload schema';
