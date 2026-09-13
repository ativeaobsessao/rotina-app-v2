DO $$
DECLARE
    v_exists BOOLEAN;
    v_profiles_count INT;
    v_profiles_with_family INT;
    v_members_count INT;
    v_missing_members INT;
    v_record RECORD;
    v_def TEXT;
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE '       AUDITORIA FORENSE - FASE 1       ';
    RAISE NOTICE '========================================';

    -- 1. Verificar public.family_members
    SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'family_members'
    ) INTO v_exists;

    IF v_exists THEN
        RAISE NOTICE '[X] public.family_members EXISTE.';
        
        -- Detalhes das colunas
        RAISE NOTICE '--- Colunas:';
        FOR v_record IN 
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'family_members'
        LOOP
            RAISE NOTICE '    - % (%)', v_record.column_name, v_record.data_type;
        END LOOP;

        -- Contagem de registros
        EXECUTE 'SELECT count(*) FROM public.family_members' INTO v_members_count;
        RAISE NOTICE '--- Registros em family_members: %', v_members_count;

        -- Órfãos
        EXECUTE 'SELECT count(*) FROM public.profiles p WHERE p.family_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = p.id AND fm.family_id = p.family_id)' INTO v_missing_members;
        RAISE NOTICE '--- Profiles com family_id que NÃO possuem membership: %', v_missing_members;

    ELSE
        RAISE NOTICE '[ ] public.family_members NÃO EXISTE.';
    END IF;

    -- Profiles count
    SELECT count(*) INTO v_profiles_count FROM public.profiles;
    SELECT count(*) INTO v_profiles_with_family FROM public.profiles WHERE family_id IS NOT NULL;
    RAISE NOTICE '--- Total de profiles: % (Com family_id: %)', v_profiles_count, v_profiles_with_family;

    -- 2. Verificar public.family_invites
    SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'family_invites'
    ) INTO v_exists;
    IF v_exists THEN
        RAISE NOTICE '[X] public.family_invites EXISTE.';
    ELSE
        RAISE NOTICE '[ ] public.family_invites NÃO EXISTE.';
    END IF;

    -- 3. Verificar Funções
    RAISE NOTICE '========================================';
    RAISE NOTICE '               FUNÇÕES                  ';
    RAISE NOTICE '========================================';
    FOR v_record IN 
        SELECT p.proname
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' 
        AND p.proname IN ('get_current_family_id', 'handle_new_user', 'user_can_access_storage_path', 'create_family_invite', 'accept_family_invite', 'revoke_family_invite', 'set_active_family', 'remove_family_member')
    LOOP
        RAISE NOTICE '[X] Função encontrada: %', v_record.proname;
    END LOOP;

    RAISE NOTICE '========================================';
    RAISE NOTICE '         POLÍTICAS RLS ATUAIS           ';
    RAISE NOTICE '========================================';
    FOR v_record IN
        SELECT tablename, policyname 
        FROM pg_policies 
        WHERE schemaname = 'public' AND tablename IN ('patients', 'meal_logs', 'medication_logs', 'daily_closures', 'family_members', 'family_invites')
    LOOP
        RAISE NOTICE 'Tabela: % | Policy: %', v_record.tablename, v_record.policyname;
    END LOOP;

    RAISE NOTICE '========================================';
    RAISE NOTICE 'AUDITORIA CONCLUÍDA. COPIE ESTE RESULTADO.';
    RAISE NOTICE '========================================';
END;
$$;
