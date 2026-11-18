-- MIGRATION 0021: SEÇÃO ATIVIDADES (CONSULTAS, EXAMES, EXERCÍCIOS E LAZER) + LOGS DIÁRIOS
-- Segura, idempotente e não destrutiva: mantém dados e travas existentes intactos.
-- Pré-requisito: migrations 0014 e 0016 aplicadas (user_in_family, user_is_family_admin,
-- check_daily_closure_status, preserve_log_creator_authorship).

-- ============================================================================
-- 0. VALIDAÇÃO DE PRÉ-REQUISITOS ESTRUTURAIS
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.patients') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.patients não existe.';
  END IF;

  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.profiles não existe.';
  END IF;

  IF to_regclass('public.family_members') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.family_members não existe.';
  END IF;

  IF to_regprocedure('public.user_in_family(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.user_in_family(uuid) não encontrada.';
  END IF;

  IF to_regprocedure('public.user_is_family_admin(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.user_is_family_admin(uuid) não encontrada.';
  END IF;
END;
$$;

-- Garantir funções auxiliares de integridade caso o ambiente tenha pulado alguma etapa anterior
CREATE OR REPLACE FUNCTION public.check_daily_closure_status()
RETURNS TRIGGER AS $$
DECLARE
  v_is_closed BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.daily_closures
    WHERE patient_id = NEW.patient_id
      AND date = NEW.event_date
      AND status = 'closed'
  ) INTO v_is_closed;

  IF v_is_closed THEN
    RAISE EXCEPTION 'Não é possível modificar registros de um dia que já foi encerrado.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.preserve_log_creator_authorship()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Não é permitido alterar o autor original do registro.'
      USING ERRCODE = '42501';
  END IF;

  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.preserve_log_creator_authorship() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 1. TABELA DE CONFIGURAÇÃO DE ATIVIDADES (RECORRENTES OU DATA ESPECÍFICA)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('medical', 'wellness')),
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('one_time', 'weekly')),
  scheduled_date DATE,
  weekdays TEXT[],
  scheduled_time TIME NOT NULL,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  updated_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.activities
  DROP CONSTRAINT IF EXISTS activities_title_not_empty_check;
ALTER TABLE public.activities
  ADD CONSTRAINT activities_title_not_empty_check CHECK (btrim(title) <> '');

ALTER TABLE public.activities
  DROP CONSTRAINT IF EXISTS activities_schedule_consistency_check;
ALTER TABLE public.activities
  ADD CONSTRAINT activities_schedule_consistency_check CHECK (
    (schedule_type = 'one_time' AND scheduled_date IS NOT NULL)
    OR
    (
      schedule_type = 'weekly'
      AND weekdays IS NOT NULL
      AND cardinality(weekdays) >= 1
      AND weekdays <@ ARRAY[
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday'
      ]::TEXT[]
    )
  );

CREATE INDEX IF NOT EXISTS idx_activities_patient_active
  ON public.activities(patient_id, active);

CREATE INDEX IF NOT EXISTS idx_activities_patient_schedule_date
  ON public.activities(patient_id, schedule_type, scheduled_date);

-- ============================================================================
-- 2. TABELA DE REGISTROS DIÁRIOS DE ATIVIDADES (ACTIVITY LOGS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  event_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'not_completed')),
  reason TEXT,
  notes TEXT,
  completed_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  updated_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT activity_logs_activity_date_unique UNIQUE (activity_id, event_date)
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_patient_event_date
  ON public.activity_logs(patient_id, event_date DESC);

-- ============================================================================
-- 3. TRIGGERS DE AUTORIA E TRAVA DE DIA ENCERRADO
-- ============================================================================

DROP TRIGGER IF EXISTS preserve_activity_creator ON public.activities;
CREATE TRIGGER preserve_activity_creator
  BEFORE UPDATE ON public.activities
  FOR EACH ROW
  EXECUTE FUNCTION public.preserve_log_creator_authorship();

DROP TRIGGER IF EXISTS preserve_activity_log_creator ON public.activity_logs;
CREATE TRIGGER preserve_activity_log_creator
  BEFORE UPDATE ON public.activity_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.preserve_log_creator_authorship();

DROP TRIGGER IF EXISTS prevent_activity_log_mutation_on_closed_day ON public.activity_logs;
CREATE TRIGGER prevent_activity_log_mutation_on_closed_day
  BEFORE INSERT OR UPDATE ON public.activity_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.check_daily_closure_status();

-- ============================================================================
-- 4. RLS: TODOS OS MEMBROS ATIVOS PODEM VISUALIZAR, CRIAR E EDITAR ATIVIDADES
--    E REGISTRAR/ATUALIZAR LOGS DIÁRIOS; EXCLUSÃO RESTRITA A ADMIN
-- ============================================================================

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Family members can view activities for their family's patients" ON public.activities;
DROP POLICY IF EXISTS "Family members can insert activities for their family's patients" ON public.activities;
DROP POLICY IF EXISTS "Family members can update activities for their family's patients" ON public.activities;
DROP POLICY IF EXISTS "Admins can delete activities for their family's patients" ON public.activities;

CREATE POLICY "Family members can view activities for their family's patients"
  ON public.activities
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = activities.patient_id
        AND public.user_in_family(p.family_id)
    )
  );

CREATE POLICY "Family members can insert activities for their family's patients"
  ON public.activities
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND updated_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = activities.patient_id
        AND public.user_in_family(p.family_id)
    )
  );

CREATE POLICY "Family members can update activities for their family's patients"
  ON public.activities
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = activities.patient_id
        AND public.user_in_family(p.family_id)
    )
  )
  WITH CHECK (
    updated_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = activities.patient_id
        AND public.user_in_family(p.family_id)
    )
  );

CREATE POLICY "Admins can delete activities for their family's patients"
  ON public.activities
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = activities.patient_id
        AND public.user_is_family_admin(p.family_id)
    )
  );

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Family members can view activity logs for their family's patients" ON public.activity_logs;
DROP POLICY IF EXISTS "Family members can insert activity logs for their family's patients" ON public.activity_logs;
DROP POLICY IF EXISTS "Family members can update activity logs for their family's patients" ON public.activity_logs;
DROP POLICY IF EXISTS "Admins can delete activity logs for their family's patients" ON public.activity_logs;

CREATE POLICY "Family members can view activity logs for their family's patients"
  ON public.activity_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = activity_logs.patient_id
        AND public.user_in_family(p.family_id)
    )
  );

CREATE POLICY "Family members can insert activity logs for their family's patients"
  ON public.activity_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND updated_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = activity_logs.patient_id
        AND public.user_in_family(p.family_id)
    )
  );

CREATE POLICY "Family members can update activity logs for their family's patients"
  ON public.activity_logs
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = activity_logs.patient_id
        AND public.user_in_family(p.family_id)
    )
  )
  WITH CHECK (
    updated_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = activity_logs.patient_id
        AND public.user_in_family(p.family_id)
    )
  );

CREATE POLICY "Admins can delete activity logs for their family's patients"
  ON public.activity_logs
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = activity_logs.patient_id
        AND public.user_is_family_admin(p.family_id)
    )
  );

-- Habilitar Realtime com segurança caso a publicação exista
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'activities'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.activities';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'activity_logs'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_logs';
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

NOTIFY pgrst, 'reload schema';
