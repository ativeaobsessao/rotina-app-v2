-- MIGRATION 0014: ETAPA 03 + 03.1 - RBAC, RLS HARDENING, FAIL-CLOSED AUTH & AUTHORSHIP INTEGRITY
-- Segura, verdadeiramente idempotente e não destrutiva: NÃO apaga perfis, pacientes, históricos ou arquivos.
-- Requisitos: migration 0006_family_members.sql já aplicada.

-- ============================================================================
-- 0. VALIDAÇÃO DE PRÉ-REQUISITOS ESTRUTURAIS (MIGRATION 0006)
-- ============================================================================

DO $$
DECLARE
  v_missing_cols INT;
  v_has_role_check BOOLEAN := FALSE;
BEGIN
  IF to_regclass('public.family_members') IS NULL THEN
    RAISE EXCEPTION
      'Pré-requisito ausente: a tabela public.family_members não existe. Aplique a migration 0006_family_members.sql antes da migration 0014.';
  END IF;

  SELECT 3 - count(*)
  INTO v_missing_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'family_members'
    AND column_name IN ('family_id', 'user_id', 'role');

  IF v_missing_cols > 0 THEN
    RAISE EXCEPTION
      'Estrutura inválida em public.family_members: colunas family_id, user_id e role são obrigatórias. Verifique a migration 0006_family_members.sql.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.family_members'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%ADMIN%'
      AND pg_get_constraintdef(oid) ILIKE '%MEMBER%'
  ) INTO v_has_role_check;

  IF NOT COALESCE(v_has_role_check, FALSE) THEN
    RAISE EXCEPTION
      'Restrição CHECK para papéis ADMIN e MEMBER ausente em public.family_members. Verifique a migration 0006_family_members.sql.';
  END IF;
END;
$$;

-- ============================================================================
-- 1. FUNÇÕES AUXILIARES DE AUTORIZAÇÃO FAIL-CLOSED (SECURITY DEFINER + search_path = public)
-- ============================================================================

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

  -- Fail-closed: public.family_members é a ÚNICA fonte de verdade de pertencimento ativo.
  -- Se a tabela não existir ou o usuário tiver sido removido dela, retorna FALSE (sem fallback para profiles).
  IF to_regclass('public.family_members') IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.family_members
    WHERE family_id = f_id
      AND user_id = auth.uid()
  ) INTO v_match;

  RETURN COALESCE(v_match, FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.user_is_family_admin(f_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL OR f_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Fail-closed: jamais promove perfis da tabela profiles a administradores sem vínculo ADMIN ativo.
  IF to_regclass('public.family_members') IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.family_members
    WHERE family_id = f_id
      AND user_id = auth.uid()
      AND role = 'ADMIN'
  ) INTO v_is_admin;

  RETURN COALESCE(v_is_admin, FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_current_family_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  -- Fail-closed: exige vínculo ativo em family_members para reconhecer a família ativa do perfil.
  IF to_regclass('public.family_members') IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT m.family_id
  INTO v_family_id
  FROM public.profiles p
  JOIN public.family_members m
    ON m.family_id = p.family_id
   AND m.user_id = p.id
  WHERE p.id = auth.uid()
  LIMIT 1;

  RETURN v_family_id;
END;
$$;

-- Leitura de Storage (preserva assinatura exata user_can_access_storage_path(object_name text))
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
  IF auth.uid() IS NULL OR object_name IS NULL OR btrim(object_name) = '' THEN
    RETURN FALSE;
  END IF;

  first_segment := split_part(object_name, '/', 1);

  -- Caminho de avatar: avatars/{user_id}/{filename}
  IF first_segment = 'avatars' THEN
    second_segment := split_part(object_name, '/', 2);
    IF second_segment = '' THEN
      RETURN FALSE;
    END IF;

    -- O próprio usuário sempre pode acessar seu avatar
    IF second_segment = auth.uid()::text THEN
      RETURN TRUE;
    END IF;

    -- Outros avatares: SOMENTE com vínculo ativo compartilhado em family_members (fail-closed, sem fallback em profiles)
    IF to_regclass('public.family_members') IS NULL THEN
      RETURN FALSE;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.family_members me
      JOIN public.family_members target
        ON target.family_id = me.family_id
      WHERE me.user_id = auth.uid()
        AND target.user_id::text = second_segment
    ) INTO v_shared_family;

    RETURN COALESCE(v_shared_family, FALSE);
  END IF;

  -- Caminho de paciente / refeição: {patient_id}/{filename}
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

  RETURN public.user_in_family(patient_family_id);
END;
$$;

-- Escrita/Exclusão de Storage:
--   - patient-profile/avatars/{auth.uid()}/... : apenas o próprio dono
--   - patient-profile/{patient_id}/...         : apenas ADMIN ativo da família do paciente
--   - meal-records/{patient_id}/...            : apenas ADMIN ativo da família do paciente
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

  RETURN public.user_is_family_admin(patient_family_id);
END;
$$;

-- ============================================================================
-- 2. PRIVILÉGIOS EXECUTE E SEARCH_PATH COMPATÍVEL COM PGCRYPTO
-- ============================================================================

REVOKE ALL ON FUNCTION public.user_in_family(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_in_family(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.user_is_family_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_is_family_admin(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_current_family_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_family_id() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.user_can_access_storage_path(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_access_storage_path(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.user_can_write_storage_path(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_write_storage_path(text, text) TO authenticated, service_role;

-- Descobrir o schema real da extensão pgcrypto via pg_extension/pg_namespace
-- (compatível tanto com public quanto com extensions no Supabase)
DO $$
DECLARE
  v_pgcrypto_schema TEXT;
  v_invite_search_path TEXT;
BEGIN
  SELECT n.nspname
  INTO v_pgcrypto_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto'
  LIMIT 1;

  IF v_pgcrypto_schema IS NULL THEN
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    SELECT n.nspname
    INTO v_pgcrypto_schema
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pgcrypto'
    LIMIT 1;
  END IF;

  IF v_pgcrypto_schema IS NULL THEN
    RAISE EXCEPTION 'Extensão pgcrypto não encontrada para os fluxos de convite familiar.';
  END IF;

  IF v_pgcrypto_schema = 'public' THEN
    v_invite_search_path := 'public';
  ELSE
    v_invite_search_path := format('public, %I', v_pgcrypto_schema);
  END IF;

  IF to_regprocedure('public.create_family_invite()') IS NOT NULL THEN
    EXECUTE format('ALTER FUNCTION public.create_family_invite() SET search_path = %s', v_invite_search_path);
    REVOKE ALL ON FUNCTION public.create_family_invite() FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.create_family_invite() TO authenticated, service_role;
  END IF;

  IF to_regprocedure('public.accept_family_invite(text)') IS NOT NULL THEN
    EXECUTE format('ALTER FUNCTION public.accept_family_invite(text) SET search_path = %s', v_invite_search_path);
    REVOKE ALL ON FUNCTION public.accept_family_invite(text) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.accept_family_invite(text) TO authenticated, service_role;
  END IF;

  IF to_regprocedure('public.set_active_family(uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.set_active_family(uuid) SET search_path = public;
    REVOKE ALL ON FUNCTION public.set_active_family(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.set_active_family(uuid) TO authenticated, service_role;
  END IF;

  IF to_regprocedure('public.remove_family_member(uuid,uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.remove_family_member(uuid, uuid) SET search_path = public;
    REVOKE ALL ON FUNCTION public.remove_family_member(uuid, uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.remove_family_member(uuid, uuid) TO authenticated, service_role;
  END IF;

  IF to_regprocedure('public.revoke_family_invite(uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.revoke_family_invite(uuid) SET search_path = public;
    REVOKE ALL ON FUNCTION public.revoke_family_invite(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.revoke_family_invite(uuid) TO authenticated, service_role;
  END IF;

  IF to_regprocedure('public.update_family_member_role(uuid,uuid,text)') IS NOT NULL THEN
    ALTER FUNCTION public.update_family_member_role(uuid, uuid, text) SET search_path = public;
    REVOKE ALL ON FUNCTION public.update_family_member_role(uuid, uuid, text) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.update_family_member_role(uuid, uuid, text) TO authenticated, service_role;
  END IF;
END;
$$;

-- ============================================================================
-- 3. TRIGGERS DE INTEGRIDADE (TROCA DE FAMÍLIA E AUTORIA ORIGINAL DE LOGS)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prevent_unauthorized_profile_family_switch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_member BOOLEAN := FALSE;
BEGIN
  IF NEW.family_id IS DISTINCT FROM OLD.family_id AND auth.uid() IS NOT NULL THEN
    -- Fail-closed: se family_members estiver ausente, bloqueia qualquer troca de família
    IF to_regclass('public.family_members') IS NULL THEN
      RAISE EXCEPTION 'Tabela family_members ausente; alteração de contexto familiar bloqueada.'
        USING ERRCODE = '42501';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.family_members
      WHERE family_id = NEW.family_id
        AND user_id = NEW.id
    ) INTO v_is_member;

    IF NOT COALESCE(v_is_member, FALSE) THEN
      RAISE EXCEPTION 'Acesso negado ao alterar contexto familiar para família sem vínculo ativo.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_unauthorized_profile_family_switch() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_profile_family_switch ON public.profiles;
CREATE TRIGGER protect_profile_family_switch
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_unauthorized_profile_family_switch();

-- Preservar autoria original (created_by e created_at) em atualizações de refeições e medicações
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

DROP TRIGGER IF EXISTS preserve_meal_log_creator ON public.meal_logs;
CREATE TRIGGER preserve_meal_log_creator
  BEFORE UPDATE ON public.meal_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.preserve_log_creator_authorship();

DROP TRIGGER IF EXISTS preserve_medication_log_creator ON public.medication_logs;
CREATE TRIGGER preserve_medication_log_creator
  BEFORE UPDATE ON public.medication_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.preserve_log_creator_authorship();

-- ============================================================================
-- 4. REVISÃO, ENDURECIMENTO E IDEMPOTÊNCIA COMPLETA DAS POLÍTICAS RLS
-- ============================================================================

-- 4.0 FAMILY MEMBERS (Fonte de verdade de papéis: leitura para membros ativos; escrita direta bloqueada)
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.family_members FROM anon, authenticated;
DROP POLICY IF EXISTS "Users can view members of their families" ON public.family_members;
CREATE POLICY "Users can view members of their families"
  ON public.family_members
  FOR SELECT
  TO authenticated
  USING (public.user_in_family(family_id));

-- 4.0b FAMILY INVITES (Leitura restrita a ADMIN; escrita direta bloqueada — mutações via RPCs SECURITY DEFINER)
DO $$
BEGIN
  IF to_regclass('public.family_invites') IS NOT NULL THEN
    ALTER TABLE public.family_invites ENABLE ROW LEVEL SECURITY;
    REVOKE INSERT, UPDATE, DELETE ON public.family_invites FROM anon, authenticated;
    DROP POLICY IF EXISTS "Admins can view their family invites" ON public.family_invites;
    CREATE POLICY "Admins can view their family invites"
      ON public.family_invites
      FOR SELECT
      TO authenticated
      USING (public.user_is_family_admin(family_id));
  END IF;
END;
$$;

-- 4.1 FAMILIES
ALTER TABLE public.families ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own family" ON public.families;
CREATE POLICY "Users can view their own family"
  ON public.families
  FOR SELECT
  TO authenticated
  USING (public.user_in_family(id));

-- 4.2 PROFILES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view profiles in their family" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

CREATE POLICY "Users can view profiles in their family"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.family_members me
      JOIN public.family_members target
        ON target.family_id = me.family_id
      WHERE me.user_id = auth.uid()
        AND target.user_id = profiles.id
    )
  );

CREATE POLICY "Users can update their own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- 4.3 PATIENTS (Leitura: membros ativos; Escrita: apenas ADMIN)
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view patients in their family" ON public.patients;
DROP POLICY IF EXISTS "Users can insert patients in their family" ON public.patients;
DROP POLICY IF EXISTS "Users can update patients in their family" ON public.patients;
DROP POLICY IF EXISTS "Users can delete patients in their family" ON public.patients;
DROP POLICY IF EXISTS "Admins can insert patients in their family" ON public.patients;
DROP POLICY IF EXISTS "Admins can update patients in their family" ON public.patients;
DROP POLICY IF EXISTS "Admins can delete patients in their family" ON public.patients;

CREATE POLICY "Users can view patients in their family"
  ON public.patients
  FOR SELECT
  TO authenticated
  USING (public.user_in_family(family_id));

CREATE POLICY "Admins can insert patients in their family"
  ON public.patients
  FOR INSERT
  TO authenticated
  WITH CHECK (public.user_is_family_admin(family_id));

CREATE POLICY "Admins can update patients in their family"
  ON public.patients
  FOR UPDATE
  TO authenticated
  USING (public.user_is_family_admin(family_id))
  WITH CHECK (public.user_is_family_admin(family_id));

CREATE POLICY "Admins can delete patients in their family"
  ON public.patients
  FOR DELETE
  TO authenticated
  USING (public.user_is_family_admin(family_id));

-- 4.4 MEAL CONFIGS (Leitura: membros ativos; Escrita: apenas ADMIN)
ALTER TABLE public.meal_configs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view meal configs of their family's patients" ON public.meal_configs;
DROP POLICY IF EXISTS "Users can insert meal configs for their family's patients" ON public.meal_configs;
DROP POLICY IF EXISTS "Users can update meal configs for their family's patients" ON public.meal_configs;
DROP POLICY IF EXISTS "Admins can insert meal configs for their family's patients" ON public.meal_configs;
DROP POLICY IF EXISTS "Admins can update meal configs for their family's patients" ON public.meal_configs;
DROP POLICY IF EXISTS "Admins can delete meal configs for their family's patients" ON public.meal_configs;

CREATE POLICY "Users can view meal configs of their family's patients"
  ON public.meal_configs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = meal_configs.patient_id
        AND public.user_in_family(p.family_id)
    )
  );

CREATE POLICY "Admins can insert meal configs for their family's patients"
  ON public.meal_configs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = meal_configs.patient_id
        AND public.user_is_family_admin(p.family_id)
    )
  );

CREATE POLICY "Admins can update meal configs for their family's patients"
  ON public.meal_configs
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = meal_configs.patient_id
        AND public.user_is_family_admin(p.family_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = meal_configs.patient_id
        AND public.user_is_family_admin(p.family_id)
    )
  );

CREATE POLICY "Admins can delete meal configs for their family's patients"
  ON public.meal_configs
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = meal_configs.patient_id
        AND public.user_is_family_admin(p.family_id)
    )
  );

-- 4.5 MEDICATION PERIODS (Leitura: membros ativos; Escrita: apenas ADMIN)
ALTER TABLE public.medication_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view med periods of their family's patients" ON public.medication_periods;
DROP POLICY IF EXISTS "Users can insert med periods for their family's patients" ON public.medication_periods;
DROP POLICY IF EXISTS "Users can update med periods for their family's patients" ON public.medication_periods;
DROP POLICY IF EXISTS "Admins can insert med periods for their family's patients" ON public.medication_periods;
DROP POLICY IF EXISTS "Admins can update med periods for their family's patients" ON public.medication_periods;
DROP POLICY IF EXISTS "Admins can delete med periods for their family's patients" ON public.medication_periods;

CREATE POLICY "Users can view med periods of their family's patients"
  ON public.medication_periods
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = medication_periods.patient_id
        AND public.user_in_family(p.family_id)
    )
  );

CREATE POLICY "Admins can insert med periods for their family's patients"
  ON public.medication_periods
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = medication_periods.patient_id
        AND public.user_is_family_admin(p.family_id)
    )
  );

CREATE POLICY "Admins can update med periods for their family's patients"
  ON public.medication_periods
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = medication_periods.patient_id
        AND public.user_is_family_admin(p.family_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = medication_periods.patient_id
        AND public.user_is_family_admin(p.family_id)
    )
  );

CREATE POLICY "Admins can delete med periods for their family's patients"
  ON public.medication_periods
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = medication_periods.patient_id
        AND public.user_is_family_admin(p.family_id)
    )
  );

-- 4.6 MEDICATIONS (Leitura: membros ativos; Escrita: apenas ADMIN)
ALTER TABLE public.medications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view meds of their family's patients" ON public.medications;
DROP POLICY IF EXISTS "Users can insert meds for their family's patients" ON public.medications;
DROP POLICY IF EXISTS "Users can update meds for their family's patients" ON public.medications;
DROP POLICY IF EXISTS "Admins can insert meds for their family's patients" ON public.medications;
DROP POLICY IF EXISTS "Admins can update meds for their family's patients" ON public.medications;
DROP POLICY IF EXISTS "Admins can delete meds for their family's patients" ON public.medications;

CREATE POLICY "Users can view meds of their family's patients"
  ON public.medications
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = medications.patient_id
        AND public.user_in_family(p.family_id)
    )
  );

CREATE POLICY "Admins can insert meds for their family's patients"
  ON public.medications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = medications.patient_id
        AND public.user_is_family_admin(p.family_id)
    )
  );

CREATE POLICY "Admins can update meds for their family's patients"
  ON public.medications
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = medications.patient_id
        AND public.user_is_family_admin(p.family_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = medications.patient_id
        AND public.user_is_family_admin(p.family_id)
    )
  );

CREATE POLICY "Admins can delete meds for their family's patients"
  ON public.medications
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = medications.patient_id
        AND public.user_is_family_admin(p.family_id)
    )
  );

-- 4.7 MEAL LOGS (Leitura: membros ativos; Escrita: apenas ADMIN + autoria íntegra)
ALTER TABLE public.meal_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view meal logs of their family's patients" ON public.meal_logs;
DROP POLICY IF EXISTS "Users can insert meal logs for their family's patients" ON public.meal_logs;
DROP POLICY IF EXISTS "Users can update meal logs for their family's patients" ON public.meal_logs;
DROP POLICY IF EXISTS "Admins can insert meal logs for their family's patients" ON public.meal_logs;
DROP POLICY IF EXISTS "Admins can update meal logs for their family's patients" ON public.meal_logs;
DROP POLICY IF EXISTS "Admins can delete meal logs for their family's patients" ON public.meal_logs;

CREATE POLICY "Users can view meal logs of their family's patients"
  ON public.meal_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = meal_logs.patient_id
        AND public.user_in_family(p.family_id)
    )
  );

CREATE POLICY "Admins can insert meal logs for their family's patients"
  ON public.meal_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND updated_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = meal_logs.patient_id
        AND public.user_is_family_admin(p.family_id)
    )
  );

CREATE POLICY "Admins can update meal logs for their family's patients"
  ON public.meal_logs
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = meal_logs.patient_id
        AND public.user_is_family_admin(p.family_id)
    )
  )
  WITH CHECK (
    updated_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = meal_logs.patient_id
        AND public.user_is_family_admin(p.family_id)
    )
  );

CREATE POLICY "Admins can delete meal logs for their family's patients"
  ON public.meal_logs
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = meal_logs.patient_id
        AND public.user_is_family_admin(p.family_id)
    )
  );

-- 4.8 MEDICATION LOGS (Leitura: membros ativos; Escrita: apenas ADMIN + autoria íntegra)
ALTER TABLE public.medication_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view med logs of their family's patients" ON public.medication_logs;
DROP POLICY IF EXISTS "Users can insert med logs for their family's patients" ON public.medication_logs;
DROP POLICY IF EXISTS "Users can update med logs for their family's patients" ON public.medication_logs;
DROP POLICY IF EXISTS "Admins can insert med logs for their family's patients" ON public.medication_logs;
DROP POLICY IF EXISTS "Admins can update med logs for their family's patients" ON public.medication_logs;
DROP POLICY IF EXISTS "Admins can delete med logs for their family's patients" ON public.medication_logs;

CREATE POLICY "Users can view med logs of their family's patients"
  ON public.medication_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = medication_logs.patient_id
        AND public.user_in_family(p.family_id)
    )
  );

CREATE POLICY "Admins can insert med logs for their family's patients"
  ON public.medication_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND updated_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = medication_logs.patient_id
        AND public.user_is_family_admin(p.family_id)
    )
  );

CREATE POLICY "Admins can update med logs for their family's patients"
  ON public.medication_logs
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = medication_logs.patient_id
        AND public.user_is_family_admin(p.family_id)
    )
  )
  WITH CHECK (
    updated_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = medication_logs.patient_id
        AND public.user_is_family_admin(p.family_id)
    )
  );

CREATE POLICY "Admins can delete med logs for their family's patients"
  ON public.medication_logs
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = medication_logs.patient_id
        AND public.user_is_family_admin(p.family_id)
    )
  );

-- 4.9 DAILY CLOSURES (Leitura: membros ativos; Encerramento e Reabertura: apenas ADMIN + closed_by = auth.uid())
ALTER TABLE public.daily_closures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view daily closures of their family" ON public.daily_closures;
DROP POLICY IF EXISTS "Users can insert daily closures for their family" ON public.daily_closures;
DROP POLICY IF EXISTS "Users can delete daily closures of their family" ON public.daily_closures;
DROP POLICY IF EXISTS "Admins can insert daily closures for their family" ON public.daily_closures;
DROP POLICY IF EXISTS "Admins can delete daily closures of their family" ON public.daily_closures;

CREATE POLICY "Users can view daily closures of their family"
  ON public.daily_closures
  FOR SELECT
  TO authenticated
  USING (public.user_in_family(family_id));

CREATE POLICY "Admins can insert daily closures for their family"
  ON public.daily_closures
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.user_is_family_admin(family_id)
    AND closed_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = daily_closures.patient_id
        AND p.family_id = daily_closures.family_id
    )
  );

CREATE POLICY "Admins can delete daily closures of their family"
  ON public.daily_closures
  FOR DELETE
  TO authenticated
  USING (public.user_is_family_admin(family_id));

-- 4.10 DAILY MOOD LOGS (Leitura: membros ativos; Escrita: apenas ADMIN + updated_by = auth.uid())
ALTER TABLE public.daily_mood_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Membros da família podem visualizar o estado de espírito" ON public.daily_mood_logs;
DROP POLICY IF EXISTS "Membros da família podem registrar ou atualizar o estado de espírito" ON public.daily_mood_logs;
DROP POLICY IF EXISTS "Apenas administradores podem inserir o estado de espírito" ON public.daily_mood_logs;
DROP POLICY IF EXISTS "Apenas administradores podem atualizar o estado de espírito" ON public.daily_mood_logs;
DROP POLICY IF EXISTS "Apenas administradores podem remover o estado de espírito" ON public.daily_mood_logs;

CREATE POLICY "Membros da família podem visualizar o estado de espírito"
  ON public.daily_mood_logs
  FOR SELECT
  TO authenticated
  USING (public.user_in_family(family_id));

CREATE POLICY "Apenas administradores podem inserir o estado de espírito"
  ON public.daily_mood_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    updated_by = auth.uid()
    AND public.user_is_family_admin(family_id)
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = daily_mood_logs.patient_id
        AND p.family_id = daily_mood_logs.family_id
    )
  );

CREATE POLICY "Apenas administradores podem atualizar o estado de espírito"
  ON public.daily_mood_logs
  FOR UPDATE
  TO authenticated
  USING (public.user_is_family_admin(family_id))
  WITH CHECK (
    updated_by = auth.uid()
    AND public.user_is_family_admin(family_id)
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = daily_mood_logs.patient_id
        AND p.family_id = daily_mood_logs.family_id
    )
  );

CREATE POLICY "Apenas administradores podem remover o estado de espírito"
  ON public.daily_mood_logs
  FOR DELETE
  TO authenticated
  USING (public.user_is_family_admin(family_id));

-- 4.11 STORAGE OBJECTS ('patient-profile' e 'meal-records')
DROP POLICY IF EXISTS "Authenticated users can view patient profiles" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload patient profiles" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update patient profiles" ON storage.objects;
DROP POLICY IF EXISTS "Family members can view patient profiles" ON storage.objects;
DROP POLICY IF EXISTS "Family members can upload patient profiles" ON storage.objects;
DROP POLICY IF EXISTS "Family members can update patient profiles" ON storage.objects;
DROP POLICY IF EXISTS "Family members can delete patient profiles" ON storage.objects;

DROP POLICY IF EXISTS "Authenticated users can view meal records" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload meal records" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update meal records" ON storage.objects;
DROP POLICY IF EXISTS "Family members can view meal records" ON storage.objects;
DROP POLICY IF EXISTS "Family members can upload meal records" ON storage.objects;
DROP POLICY IF EXISTS "Family members can update meal records" ON storage.objects;
DROP POLICY IF EXISTS "Family members can delete meal records" ON storage.objects;

-- Patient Profile bucket
CREATE POLICY "Family members can view patient profiles"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'patient-profile'
    AND public.user_can_access_storage_path(name)
  );

CREATE POLICY "Family members can upload patient profiles"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'patient-profile'
    AND public.user_can_write_storage_path('patient-profile', name)
  );

CREATE POLICY "Family members can update patient profiles"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'patient-profile'
    AND public.user_can_write_storage_path('patient-profile', name)
  )
  WITH CHECK (
    bucket_id = 'patient-profile'
    AND public.user_can_write_storage_path('patient-profile', name)
  );

CREATE POLICY "Family members can delete patient profiles"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'patient-profile'
    AND public.user_can_write_storage_path('patient-profile', name)
  );

-- Meal Records bucket
CREATE POLICY "Family members can view meal records"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'meal-records'
    AND public.user_can_access_storage_path(name)
  );

CREATE POLICY "Family members can upload meal records"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'meal-records'
    AND public.user_can_write_storage_path('meal-records', name)
  );

CREATE POLICY "Family members can update meal records"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'meal-records'
    AND public.user_can_write_storage_path('meal-records', name)
  )
  WITH CHECK (
    bucket_id = 'meal-records'
    AND public.user_can_write_storage_path('meal-records', name)
  );

CREATE POLICY "Family members can delete meal records"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'meal-records'
    AND public.user_can_write_storage_path('meal-records', name)
  );

-- Garantir preservação explícita das triggers de proteção de dia encerrado
-- (prevent_meal_mutation_on_closed_day e prevent_med_mutation_on_closed_day não são alteradas)

NOTIFY pgrst, 'reload schema';
