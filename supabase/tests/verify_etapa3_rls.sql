-- SCRIPT DE VERIFICAÇÃO RLS EM HOMOLOGAÇÃO (ETAPA 03)
-- Executa integralmente dentro de uma transação com ROLLBACK ao final
-- para testar Testes A, B, C e D sem sujar dados reais.
-- IMPORTANTE: Execute APENAS em ambiente de homologação/staging após aplicar a migration 0014.

BEGIN;

DO $$
DECLARE
  v_admin_uid UUID := gen_random_uuid();
  v_member_uid UUID := gen_random_uuid();
  v_family_id UUID := gen_random_uuid();
  v_other_family_id UUID := gen_random_uuid();
  v_patient_id UUID := gen_random_uuid();
  v_meal_cfg_id UUID := gen_random_uuid();
  v_med_period_id UUID := gen_random_uuid();
  v_med_id UUID := gen_random_uuid();
  v_count INT;
  v_bool BOOLEAN;
BEGIN
  -- 1. Seed temporário (role postgres / owner)
  INSERT INTO auth.users (id, email, aud, role, created_at, updated_at)
  VALUES
    (v_admin_uid, 'test-admin@duca.local', 'authenticated', 'authenticated', now(), now()),
    (v_member_uid, 'test-member@duca.local', 'authenticated', 'authenticated', now(), now())
  ON CONFLICT DO NOTHING;

  INSERT INTO public.families (id, name) VALUES
    (v_family_id, 'Família Teste RLS'),
    (v_other_family_id, 'Família Externa');

  INSERT INTO public.profiles (id, family_id, name, email) VALUES
    (v_admin_uid, v_family_id, 'Admin Teste', 'test-admin@duca.local'),
    (v_member_uid, v_family_id, 'Member Teste', 'test-member@duca.local')
  ON CONFLICT (id) DO UPDATE SET family_id = EXCLUDED.family_id;

  INSERT INTO public.family_members (family_id, user_id, role) VALUES
    (v_family_id, v_admin_uid, 'ADMIN'),
    (v_family_id, v_member_uid, 'MEMBER');

  INSERT INTO public.patients (id, family_id, name) VALUES (v_patient_id, v_family_id, 'Dona Maria Teste');
  INSERT INTO public.meal_configs (id, patient_id, name, type, scheduled_time, display_order)
    VALUES (v_meal_cfg_id, v_patient_id, 'Almoço Teste', 'lunch', '12:00', 1);
  INSERT INTO public.medication_periods (id, patient_id, name, scheduled_time, display_order)
    VALUES (v_med_period_id, v_patient_id, 'Manhã Teste', '08:00', 1);
  INSERT INTO public.medications (id, patient_id, medication_period_id, name, dosage, frequency)
    VALUES (v_med_id, v_patient_id, v_med_period_id, 'Vitamina D', '1 comp', 'daily');

  -- =========================================================================
  -- TESTE B (ADMIN): Deve conseguir inserir logs e encerrar/reabrir dia
  -- =========================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO public.meal_logs (meal_config_id, patient_id, event_date, consumption_status, description, created_by, updated_by)
  VALUES (v_meal_cfg_id, v_patient_id, CURRENT_DATE, 'normal', 'Refeição Admin', v_admin_uid, v_admin_uid);

  INSERT INTO public.daily_closures (family_id, patient_id, date, status, closed_by)
  VALUES (v_family_id, v_patient_id, CURRENT_DATE, 'closed', v_admin_uid);

  DELETE FROM public.daily_closures WHERE patient_id = v_patient_id AND date = CURRENT_DATE;

  RESET ROLE;

  -- =========================================================================
  -- TESTE A (MEMBER): Deve ler tudo, mas NUNCA escrever/encerrar/reabrir
  -- =========================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member_uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_count FROM public.meal_logs WHERE patient_id = v_patient_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALHA TESTE A: MEMBER deveria conseguir ler meal_logs (count=%).', v_count;
  END IF;

  IF NOT public.user_can_access_storage_path(v_patient_id::text || '/foto.jpg') THEN
    RAISE EXCEPTION 'FALHA TESTE A: MEMBER deveria conseguir ler fotos de meal-records/patient-profile.';
  END IF;

  IF public.user_can_write_storage_path('meal-records', v_patient_id::text || '/hack.jpg') THEN
    RAISE EXCEPTION 'FALHA TESTE A: MEMBER NÃO deveria poder gravar em meal-records.';
  END IF;

  IF public.user_can_write_storage_path('patient-profile', v_patient_id::text || '/hack.jpg') THEN
    RAISE EXCEPTION 'FALHA TESTE A: MEMBER NÃO deveria poder gravar foto do paciente.';
  END IF;

  IF NOT public.user_can_write_storage_path('patient-profile', 'avatars/' || v_member_uid::text || '/me.jpg') THEN
    RAISE EXCEPTION 'FALHA TESTE A: MEMBER deveria poder atualizar o próprio avatar.';
  END IF;

  BEGIN
    INSERT INTO public.medication_logs (medication_id, patient_id, event_date, status, created_by, updated_by)
    VALUES (v_med_id, v_patient_id, CURRENT_DATE, 'administered', v_member_uid, v_member_uid);
    RAISE EXCEPTION 'FALHA TESTE A: MEMBER conseguiu inserir em medication_logs!';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL; -- Esperado (42501 RLS)
  END;

  BEGIN
    INSERT INTO public.daily_closures (family_id, patient_id, date, status, closed_by)
    VALUES (v_family_id, v_patient_id, CURRENT_DATE, 'closed', v_member_uid);
    RAISE EXCEPTION 'FALHA TESTE A: MEMBER conseguiu encerrar o dia!';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL; -- Esperado
  END;

  BEGIN
    UPDATE public.meal_configs SET name = 'Alterado por Member' WHERE id = v_meal_cfg_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'FALHA TESTE A: MEMBER conseguiu alterar meal_configs!';
    END IF;
  END;

  RESET ROLE;

  -- =========================================================================
  -- TESTE C (USUÁRIO REMOVIDO): Remover de family_members mantendo profiles.family_id!
  -- =========================================================================
  DELETE FROM public.family_members WHERE family_id = v_family_id AND user_id = v_member_uid;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member_uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT public.user_in_family(v_family_id) INTO v_bool;
  IF v_bool THEN
    RAISE EXCEPTION 'FALHA TESTE C: Usuário removido ainda retornou TRUE em user_in_family!';
  END IF;

  SELECT count(*) INTO v_count FROM public.patients WHERE id = v_patient_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA TESTE C: Usuário removido ainda visualiza paciente (count=%)!', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.meal_logs WHERE patient_id = v_patient_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA TESTE C: Usuário removido ainda visualiza meal_logs!';
  END IF;

  -- =========================================================================
  -- TESTE D (STORAGE): Usuário removido NÃO vê avatar do admin nem fotos do paciente,
  -- mas continua podendo acessar seu próprio avatar
  -- =========================================================================
  IF public.user_can_access_storage_path('avatars/' || v_admin_uid::text || '/avatar.jpg') THEN
    RAISE EXCEPTION 'FALHA TESTE D: Usuário removido ainda acessa avatar do administrador!';
  END IF;

  IF public.user_can_access_storage_path(v_patient_id::text || '/foto.jpg') THEN
    RAISE EXCEPTION 'FALHA TESTE D: Usuário removido ainda acessa foto do paciente/refeição!';
  END IF;

  IF NOT public.user_can_access_storage_path('avatars/' || v_member_uid::text || '/avatar.jpg') THEN
    RAISE EXCEPTION 'FALHA TESTE D: Usuário removido perdeu acesso ao próprio avatar!';
  END IF;

  RESET ROLE;
  RAISE NOTICE 'SUCESSO ETAPA 03: Todos os testes A, B, C e D passaram com 100%% de conformidade!';
END;
$$;

ROLLBACK;
