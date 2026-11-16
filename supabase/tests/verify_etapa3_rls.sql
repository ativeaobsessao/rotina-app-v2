-- SCRIPT DE VERIFICAÇÃO RLS, RPC, STORAGE E INTEGRIDADE EM HOMOLOGAÇÃO (ETAPA 03.1)
-- Executa integralmente dentro de uma transação com ROLLBACK ao final
-- para testar Testes A, B, C, D, E e F no PostgreSQL real sem sujar dados.
-- IMPORTANTE: Execute APENAS em ambiente de homologação/staging após aplicar a migration 0014.

BEGIN;

DO $$
DECLARE
  v_admin_uid UUID := gen_random_uuid();
  v_member_uid UUID := gen_random_uuid();
  v_invitee_uid UUID := gen_random_uuid();
  v_outsider_uid UUID := gen_random_uuid();
  v_family_id UUID := gen_random_uuid();
  v_second_family_id UUID := gen_random_uuid();
  v_other_family_id UUID := gen_random_uuid();
  v_patient_id UUID := gen_random_uuid();
  v_meal_cfg_id UUID := gen_random_uuid();
  v_med_period_id UUID := gen_random_uuid();
  v_med_id UUID := gen_random_uuid();
  v_meal_log_id UUID;
  v_count INT;
  v_bool BOOLEAN;
  v_blocked BOOLEAN;
  v_role TEXT;
  v_invite_json JSON;
  v_invite2_json JSON;
  v_accept_json JSON;
  v_token TEXT;
  v_invite2_id UUID;
BEGIN
  -- 0. Seed inicial da estrutura de buckets e usuários temporários (role postgres)
  INSERT INTO storage.buckets (id, name, public)
  VALUES
    ('patient-profile', 'patient-profile', false),
    ('meal-records', 'meal-records', false)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.users (id, email, aud, role, created_at, updated_at)
  VALUES
    (v_admin_uid, 'test-admin@duca.local', 'authenticated', 'authenticated', now(), now()),
    (v_member_uid, 'test-member@duca.local', 'authenticated', 'authenticated', now(), now()),
    (v_invitee_uid, 'test-invitee@duca.local', 'authenticated', 'authenticated', now(), now()),
    (v_outsider_uid, 'test-outsider@duca.local', 'authenticated', 'authenticated', now(), now())
  ON CONFLICT DO NOTHING;

  INSERT INTO public.families (id, name) VALUES
    (v_family_id, 'Família Teste RLS'),
    (v_second_family_id, 'Segunda Família do Member'),
    (v_other_family_id, 'Família Externa');

  INSERT INTO public.profiles (id, family_id, name, email) VALUES
    (v_admin_uid, v_family_id, 'Admin Teste', 'test-admin@duca.local'),
    (v_member_uid, v_family_id, 'Member Teste', 'test-member@duca.local'),
    (v_invitee_uid, v_other_family_id, 'Convidado Teste', 'test-invitee@duca.local'),
    (v_outsider_uid, v_other_family_id, 'Externo Teste', 'test-outsider@duca.local')
  ON CONFLICT (id) DO UPDATE SET family_id = EXCLUDED.family_id;

  INSERT INTO public.family_members (family_id, user_id, role) VALUES
    (v_family_id, v_admin_uid, 'ADMIN'),
    (v_family_id, v_member_uid, 'MEMBER'),
    (v_second_family_id, v_member_uid, 'MEMBER'),
    (v_other_family_id, v_outsider_uid, 'ADMIN'),
    (v_other_family_id, v_invitee_uid, 'ADMIN');

  INSERT INTO public.patients (id, family_id, name)
    VALUES (v_patient_id, v_family_id, 'Dona Maria Teste');
  INSERT INTO public.meal_configs (id, patient_id, name, type, scheduled_time, display_order)
    VALUES (v_meal_cfg_id, v_patient_id, 'Almoço Teste', 'lunch', '12:00', 1);
  INSERT INTO public.medication_periods (id, patient_id, name, scheduled_time, display_order)
    VALUES (v_med_period_id, v_patient_id, 'Manhã Teste', '08:00', 1);
  INSERT INTO public.medications (id, patient_id, medication_period_id, name, dosage, frequency)
    VALUES (v_med_id, v_patient_id, v_med_period_id, 'Vitamina D', '1 comp', 'daily');

  -- Seed inicial de objetos em storage.objects
  INSERT INTO storage.objects (bucket_id, name) VALUES
    ('patient-profile', v_patient_id::text || '/seeded-patient.jpg'),
    ('meal-records', v_patient_id::text || '/seeded-meal.jpg'),
    ('patient-profile', 'avatars/' || v_admin_uid::text || '/seeded-admin.jpg'),
    ('patient-profile', 'avatars/' || v_member_uid::text || '/seeded-member.jpg');

  -- Auditoria estática de catálogo pg_policies em family_members e family_invites
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'family_members'
    AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA AUDITORIA: public.family_members possui políticas diretas de escrita!';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'family_invites'
    AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA AUDITORIA: public.family_invites possui políticas diretas de escrita!';
  END IF;

  -- =========================================================================
  -- TESTE F.1 (ADMIN BASE): Inserir log inicial + validar proteção de dia encerrado
  -- =========================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO public.meal_logs (
    meal_config_id, patient_id, event_date, consumption_status, description, created_by, updated_by
  ) VALUES (
    v_meal_cfg_id, v_patient_id, CURRENT_DATE, 'normal', 'Refeição Admin', v_admin_uid, v_admin_uid
  )
  RETURNING id INTO v_meal_log_id;

  INSERT INTO public.daily_mood_logs (patient_id, family_id, date, mood, pain_level, updated_by)
  VALUES (v_patient_id, v_family_id, CURRENT_DATE, 'happy', 'none', v_admin_uid);

  -- Encerrar dia e verificar que trigger prevent_meal_mutation_on_closed_day bloqueia edição mesmo do ADMIN
  INSERT INTO public.daily_closures (family_id, patient_id, date, status, closed_by)
  VALUES (v_family_id, v_patient_id, CURRENT_DATE, 'closed', v_admin_uid);

  v_blocked := FALSE;
  BEGIN
    UPDATE public.meal_logs
    SET description = 'Edição com dia fechado', updated_by = v_admin_uid
    WHERE id = v_meal_log_id;
  EXCEPTION WHEN raise_exception THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE F: Trigger de dia encerrado deveria bloquear alteração em meal_logs!';
  END IF;

  -- Reabrir dia (DELETE daily_closures) e verificar que volta a permitir edição legítima
  DELETE FROM public.daily_closures WHERE patient_id = v_patient_id AND date = CURRENT_DATE;

  UPDATE public.meal_logs
  SET description = 'Refeição Editada Admin', updated_by = v_admin_uid
  WHERE id = v_meal_log_id;

  RESET ROLE;

  -- =========================================================================
  -- TESTE E — INTEGRIDADE DE AUTORIA (created_by / updated_by / closed_by)
  -- =========================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_blocked := FALSE;
  BEGIN
    INSERT INTO public.meal_logs (
      meal_config_id, patient_id, event_date, consumption_status, created_by, updated_by
    ) VALUES (
      v_meal_cfg_id, v_patient_id, CURRENT_DATE - 1, 'normal', v_member_uid, v_admin_uid
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE E: ADMIN conseguiu inserir meal_logs com created_by de terceiro!';
  END IF;

  v_blocked := FALSE;
  BEGIN
    INSERT INTO public.medication_logs (
      medication_id, patient_id, event_date, status, created_by, updated_by
    ) VALUES (
      v_med_id, v_patient_id, CURRENT_DATE, 'administered', v_member_uid, v_admin_uid
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE E: ADMIN conseguiu inserir medication_logs com created_by de terceiro!';
  END IF;

  v_blocked := FALSE;
  BEGIN
    UPDATE public.meal_logs
    SET description = 'Falsificado', updated_by = v_member_uid
    WHERE id = v_meal_log_id;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE E: ADMIN conseguiu atualizar meal_logs com updated_by de terceiro!';
  END IF;

  v_blocked := FALSE;
  BEGIN
    UPDATE public.meal_logs
    SET created_by = v_member_uid, updated_by = v_admin_uid
    WHERE id = v_meal_log_id;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE E: Trigger preserve_log_creator_authorship deveria bloquear troca de created_by!';
  END IF;

  v_blocked := FALSE;
  BEGIN
    UPDATE public.daily_mood_logs
    SET notes = 'Falsificado', updated_by = v_member_uid
    WHERE patient_id = v_patient_id AND date = CURRENT_DATE;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE E: ADMIN conseguiu atualizar daily_mood_logs com updated_by de terceiro!';
  END IF;

  v_blocked := FALSE;
  BEGIN
    INSERT INTO public.daily_closures (family_id, patient_id, date, status, closed_by)
    VALUES (v_family_id, v_patient_id, CURRENT_DATE - 1, 'closed', v_member_uid);
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE E: ADMIN conseguiu encerrar dia com closed_by de terceiro!';
  END IF;

  RESET ROLE;

  -- =========================================================================
  -- TESTE A — ALTERAÇÃO DIRETA DE PAPEL & LEITURA/ESCRITA DE MEMBER
  -- =========================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member_uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_count FROM public.meal_logs WHERE patient_id = v_patient_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALHA TESTE F: MEMBER deveria conseguir ler meal_logs (count=%).', v_count;
  END IF;

  v_blocked := FALSE;
  BEGIN
    UPDATE public.family_members SET role = 'ADMIN'
    WHERE family_id = v_family_id AND user_id = v_member_uid;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count = 0 THEN
      v_blocked := TRUE;
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE A: MEMBER alterou próprio papel diretamente!';
  END IF;

  v_blocked := FALSE;
  BEGIN
    UPDATE public.family_members SET role = 'MEMBER'
    WHERE family_id = v_family_id AND user_id = v_admin_uid;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count = 0 THEN
      v_blocked := TRUE;
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE A: MEMBER alterou papel do admin diretamente!';
  END IF;

  v_blocked := FALSE;
  BEGIN
    INSERT INTO public.family_members (family_id, user_id, role)
    VALUES (v_family_id, v_outsider_uid, 'ADMIN');
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE A: MEMBER inseriu vínculo direto em family_members!';
  END IF;

  v_blocked := FALSE;
  BEGIN
    DELETE FROM public.family_members
    WHERE family_id = v_family_id AND user_id = v_admin_uid;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count = 0 THEN
      v_blocked := TRUE;
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE A: MEMBER excluiu vínculo em family_members!';
  END IF;

  v_blocked := FALSE;
  BEGIN
    INSERT INTO public.medication_logs (medication_id, patient_id, event_date, status, created_by, updated_by)
    VALUES (v_med_id, v_patient_id, CURRENT_DATE, 'administered', v_member_uid, v_member_uid);
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE A: MEMBER conseguiu inserir em medication_logs!';
  END IF;

  v_blocked := FALSE;
  BEGIN
    INSERT INTO public.daily_closures (family_id, patient_id, date, status, closed_by)
    VALUES (v_family_id, v_patient_id, CURRENT_DATE, 'closed', v_member_uid);
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE A: MEMBER conseguiu encerrar o dia!';
  END IF;

  SELECT role INTO v_role FROM public.family_members
  WHERE family_id = v_family_id AND user_id = v_member_uid;
  IF v_role <> 'MEMBER' THEN
    RAISE EXCEPTION 'FALHA TESTE A: Papel inesperado após ataques (%).', v_role;
  END IF;

  -- =========================================================================
  -- TESTE B (PARTE 1): MEMBER tentando executar RPCs administrativas
  -- =========================================================================
  v_blocked := FALSE;
  BEGIN
    PERFORM public.update_family_member_role(v_member_uid, v_family_id, 'ADMIN');
  EXCEPTION WHEN raise_exception THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE B: MEMBER executou update_family_member_role!';
  END IF;

  v_blocked := FALSE;
  BEGIN
    PERFORM public.remove_family_member(v_admin_uid, v_family_id);
  EXCEPTION WHEN raise_exception THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE B: MEMBER executou remove_family_member!';
  END;

  v_blocked := FALSE;
  BEGIN
    PERFORM public.create_family_invite();
  EXCEPTION WHEN raise_exception THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE B: MEMBER executou create_family_invite!';
  END IF;

  v_blocked := FALSE;
  BEGIN
    PERFORM public.revoke_family_invite(gen_random_uuid());
  EXCEPTION WHEN raise_exception THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE B: MEMBER executou revoke_family_invite!';
  END IF;

  -- =========================================================================
  -- TESTE C (PARTE 1): Troca de família como MEMBER
  -- =========================================================================
  v_blocked := FALSE;
  BEGIN
    UPDATE public.profiles SET family_id = v_other_family_id WHERE id = v_member_uid;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE C: MEMBER alterou profiles.family_id diretamente para família externa!';
  END IF;

  v_blocked := FALSE;
  BEGIN
    PERFORM public.set_active_family(v_other_family_id);
  EXCEPTION WHEN raise_exception THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE C: MEMBER executou set_active_family para família externa!';
  END IF;

  PERFORM public.set_active_family(v_second_family_id);
  IF public.get_current_family_id() <> v_second_family_id THEN
    RAISE EXCEPTION 'FALHA TESTE C: set_active_family não alterou contexto para segunda família válida!';
  END IF;
  PERFORM public.set_active_family(v_family_id);

  RESET ROLE;

  -- =========================================================================
  -- TESTE B (PARTE 2): RPCs administrativas como ADMIN & fluxo pgcrypto de convites
  -- =========================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT public.create_family_invite() INTO v_invite_json;
  v_token := v_invite_json->>'token';
  IF v_token IS NULL OR length(v_token) < 32 THEN
    RAISE EXCEPTION 'FALHA TESTE B: create_family_invite não retornou token válido!';
  END IF;

  SELECT public.create_family_invite() INTO v_invite2_json;
  v_invite2_id := (v_invite2_json->>'invite_id')::UUID;
  PERFORM public.revoke_family_invite(v_invite2_id);

  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_invitee_uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT public.accept_family_invite(v_token) INTO v_accept_json;
  IF (v_accept_json->>'success')::BOOLEAN IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'FALHA TESTE B: accept_family_invite falhou!';
  END IF;

  RESET ROLE;

  SELECT role INTO v_role FROM public.family_members
  WHERE family_id = v_family_id AND user_id = v_invitee_uid;
  IF v_role <> 'MEMBER' THEN
    RAISE EXCEPTION 'FALHA TESTE B: Convidado deveria entrar como MEMBER (recebeu %).', v_role;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  PERFORM public.update_family_member_role(v_member_uid, v_family_id, 'ADMIN');
  PERFORM public.update_family_member_role(v_member_uid, v_family_id, 'MEMBER');

  v_blocked := FALSE;
  BEGIN
    PERFORM public.update_family_member_role(v_admin_uid, v_family_id, 'MEMBER');
  EXCEPTION WHEN raise_exception THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE B: Último ADMIN foi rebaixado!';
  END IF;

  v_blocked := FALSE;
  BEGIN
    PERFORM public.remove_family_member(v_admin_uid, v_family_id);
  EXCEPTION WHEN raise_exception THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE B: Último ADMIN foi removido!';
  END IF;

  -- =========================================================================
  -- TESTE D — STORAGE RLS REAL (storage.objects: ADMIN, MEMBER, OUTSIDER, REMOVIDO)
  -- =========================================================================
  SELECT count(*) INTO v_count FROM storage.objects
  WHERE bucket_id IN ('patient-profile', 'meal-records')
    AND name IN (
      v_patient_id::text || '/seeded-patient.jpg',
      v_patient_id::text || '/seeded-meal.jpg',
      'avatars/' || v_admin_uid::text || '/seeded-admin.jpg',
      'avatars/' || v_member_uid::text || '/seeded-member.jpg'
    );
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'FALHA TESTE D (ADMIN SELECT): esperava 4 objetos, obteve %.', v_count;
  END IF;

  INSERT INTO storage.objects (bucket_id, name)
  VALUES ('meal-records', v_patient_id::text || '/admin-upload.jpg');
  UPDATE storage.objects SET name = v_patient_id::text || '/admin-upload-v2.jpg'
  WHERE bucket_id = 'meal-records' AND name = v_patient_id::text || '/admin-upload.jpg';
  DELETE FROM storage.objects
  WHERE bucket_id = 'meal-records' AND name = v_patient_id::text || '/admin-upload-v2.jpg';

  INSERT INTO storage.objects (bucket_id, name)
  VALUES ('patient-profile', v_patient_id::text || '/admin-patient-photo.jpg');
  DELETE FROM storage.objects
  WHERE bucket_id = 'patient-profile' AND name = v_patient_id::text || '/admin-patient-photo.jpg';

  v_blocked := FALSE;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('patient-profile', 'avatars/' || v_member_uid::text || '/spoof.jpg');
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE D: ADMIN gravou no avatar de outro usuário!';
  END IF;

  RESET ROLE;

  -- 2. MEMBER na família
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member_uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_count FROM storage.objects
  WHERE bucket_id IN ('patient-profile', 'meal-records')
    AND name IN (
      v_patient_id::text || '/seeded-patient.jpg',
      v_patient_id::text || '/seeded-meal.jpg',
      'avatars/' || v_admin_uid::text || '/seeded-admin.jpg',
      'avatars/' || v_member_uid::text || '/seeded-member.jpg'
    );
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'FALHA TESTE D (MEMBER SELECT): esperava 4 objetos, obteve %.', v_count;
  END IF;

  v_blocked := FALSE;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('meal-records', v_patient_id::text || '/member-hack.jpg');
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE D: MEMBER inseriu em meal-records!';
  END IF;

  v_blocked := FALSE;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('patient-profile', v_patient_id::text || '/member-hack.jpg');
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE D: MEMBER inseriu foto do paciente em patient-profile!';
  END IF;

  UPDATE storage.objects SET name = v_patient_id::text || '/hacked.jpg'
  WHERE bucket_id = 'meal-records' AND name = v_patient_id::text || '/seeded-meal.jpg';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'FALHA TESTE D: MEMBER atualizou objeto em meal-records!';
  END IF;

  DELETE FROM storage.objects
  WHERE bucket_id = 'patient-profile' AND name = v_patient_id::text || '/seeded-patient.jpg';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'FALHA TESTE D: MEMBER deletou foto do paciente!';
  END IF;

  INSERT INTO storage.objects (bucket_id, name)
  VALUES ('patient-profile', 'avatars/' || v_member_uid::text || '/member-self.jpg');
  UPDATE storage.objects SET name = 'avatars/' || v_member_uid::text || '/member-self-2.jpg'
  WHERE bucket_id = 'patient-profile' AND name = 'avatars/' || v_member_uid::text || '/member-self.jpg';
  DELETE FROM storage.objects
  WHERE bucket_id = 'patient-profile' AND name = 'avatars/' || v_member_uid::text || '/member-self-2.jpg';

  RESET ROLE;

  -- 3. Usuário de OUTRA família
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_outsider_uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_count FROM storage.objects
  WHERE bucket_id IN ('patient-profile', 'meal-records')
    AND name IN (
      v_patient_id::text || '/seeded-patient.jpg',
      v_patient_id::text || '/seeded-meal.jpg',
      'avatars/' || v_admin_uid::text || '/seeded-admin.jpg',
      'avatars/' || v_member_uid::text || '/seeded-member.jpg'
    );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA TESTE D (OUTSIDER SELECT): vazamento de % objetos!', v_count;
  END IF;

  v_blocked := FALSE;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('meal-records', v_patient_id::text || '/outsider-hack.jpg');
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FALHA TESTE D: Externo inseriu em meal-records!';
  END;

  RESET ROLE;

  -- =========================================================================
  -- TESTE C + D (USUÁRIO REMOVIDO): Remover membro mantendo profiles.family_id!
  -- =========================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  PERFORM public.remove_family_member(v_member_uid, v_family_id);
  PERFORM public.remove_family_member(v_invitee_uid, v_family_id);

  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member_uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT public.user_in_family(v_family_id) INTO v_bool;
  IF v_bool THEN
    RAISE EXCEPTION 'FALHA TESTE C: Usuário removido retornou TRUE em user_in_family!';
  END IF;

  IF public.get_current_family_id() = v_family_id THEN
    RAISE EXCEPTION 'FALHA TESTE C: get_current_family_id retornou família da qual usuário foi removido!';
  END IF;

  SELECT count(*) INTO v_count FROM public.patients WHERE id = v_patient_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA TESTE C: Usuário removido ainda visualiza paciente (count=%)!', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.meal_logs WHERE patient_id = v_patient_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA TESTE C: Usuário removido ainda visualiza meal_logs!';
  END IF;

  SELECT count(*) INTO v_count FROM storage.objects
  WHERE bucket_id IN ('patient-profile', 'meal-records')
    AND name IN (
      v_patient_id::text || '/seeded-patient.jpg',
      v_patient_id::text || '/seeded-meal.jpg',
      'avatars/' || v_admin_uid::text || '/seeded-admin.jpg'
    );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA TESTE D (REMOVIDO): Usuário removido ainda visualizou % objetos da família!', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM storage.objects
  WHERE bucket_id = 'patient-profile'
    AND name = 'avatars/' || v_member_uid::text || '/seeded-member.jpg';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALHA TESTE D (REMOVIDO): Usuário removido perdeu acesso ao próprio avatar!';
  END IF;

  RESET ROLE;
  RAISE NOTICE 'SUCESSO ETAPA 03.1: Todos os testes A, B, C, D, E e F passaram com 100%% de conformidade!';
END;
$$;

ROLLBACK;
