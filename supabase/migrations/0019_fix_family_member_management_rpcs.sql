-- MIGRATION 0019: RECRIAÇÃO E ENDURECIMENTO DAS RPCs DE GERENCIAMENTO DE MEMBROS DA FAMÍLIA
-- Objetivo:
--   1. Garantir a existência e paridade das funções SECURITY DEFINER:
--        - public.update_family_member_role(p_user_id UUID, p_family_id UUID, p_new_role TEXT)
--        - public.remove_family_member(p_user_id UUID, p_family_id UUID)
--      em bancos que não executaram as migrations legadas 0008/0009/0011 ou perderam o cache PostgREST.
--   2. Restaurar automaticamente profiles.family_id do membro removido para outra família ativa válida
--      (ex.: sua família pessoal criada no cadastro) caso ele estivesse com a família removida ativa,
--      respeitando integralmente o trigger protect_profile_family_switch e a constraint NOT NULL.
--   3. Preservar member_type ('FAMILY' | 'CAREGIVER'), trava de concorrência (FOR UPDATE), proteção
--      contra remoção/rebaixamento do último ADMIN, privilégios EXECUTE e reload imediato do PostgREST.
-- Segura, idempotente e não destrutiva.

-- ============================================================================
-- 0. VALIDAÇÃO DE PRÉ-REQUISITOS
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.families') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.families não existe.';
  END IF;

  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.profiles não existe.';
  END IF;

  IF to_regclass('public.family_members') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.family_members não existe.';
  END IF;
END;
$$;

-- ============================================================================
-- 1. RPC: ATUALIZAR PAPEL DO MEMBRO (ELEGER ADM OU TORNAR ACOMPANHANTE)
-- ============================================================================

DROP FUNCTION IF EXISTS public.update_family_member_role(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.update_family_member_role(
  p_user_id UUID,
  p_family_id UUID,
  p_new_role TEXT
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID;
  v_family_exists BOOLEAN := FALSE;
  v_is_admin BOOLEAN := FALSE;
  v_normalized_role TEXT;
  v_current_role TEXT;
  v_member_type TEXT;
  v_admin_count INT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  IF p_user_id IS NULL OR p_family_id IS NULL THEN
    RAISE EXCEPTION 'Parâmetros inválidos para atualização de permissão.';
  END IF;

  v_normalized_role := UPPER(btrim(COALESCE(p_new_role, '')));
  IF v_normalized_role NOT IN ('ADMIN', 'MEMBER') THEN
    RAISE EXCEPTION 'Papel inválido. Use ADMIN ou MEMBER.';
  END IF;

  -- Trava transacional na família para serializar alterações simultâneas de ADM
  SELECT TRUE
  INTO v_family_exists
  FROM public.families
  WHERE id = p_family_id
  FOR UPDATE;

  IF NOT COALESCE(v_family_exists, FALSE) THEN
    RAISE EXCEPTION 'Família não encontrada.';
  END IF;

  -- Autorização estrita: apenas ADMIN ativo desta família pode alterar papéis
  SELECT EXISTS (
    SELECT 1
    FROM public.family_members
    WHERE family_id = p_family_id
      AND user_id = v_caller_id
      AND role = 'ADMIN'
  ) INTO v_is_admin;

  IF NOT COALESCE(v_is_admin, FALSE) THEN
    RAISE EXCEPTION 'Apenas administradores podem alterar permissões de membros.';
  END IF;

  -- Localiza vínculo alvo e seu tipo organizacional atual
  SELECT role, COALESCE(member_type, 'FAMILY')
  INTO v_current_role, v_member_type
  FROM public.family_members
  WHERE family_id = p_family_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membro não encontrado nesta família.';
  END IF;

  -- Garante que a família jamais fique sem ao menos 1 Administrador ativo
  IF v_current_role = 'ADMIN' AND v_normalized_role = 'MEMBER' THEN
    SELECT count(*)
    INTO v_admin_count
    FROM public.family_members
    WHERE family_id = p_family_id
      AND role = 'ADMIN';

    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'A família precisa ter pelo menos um Administrador ativo.';
    END IF;
  END IF;

  UPDATE public.family_members
  SET role = v_normalized_role
  WHERE family_id = p_family_id
    AND user_id = p_user_id;

  RETURN json_build_object(
    'success', true,
    'family_id', p_family_id,
    'user_id', p_user_id,
    'role', v_normalized_role,
    'member_type', v_member_type
  );
END;
$$;

-- ============================================================================
-- 2. RPC: REMOVER MEMBRO DA FAMÍLIA (COM RECUPERAÇÃO SEGURA DE CONTEXTO ATIVO)
-- ============================================================================

DROP FUNCTION IF EXISTS public.remove_family_member(UUID, UUID);

CREATE OR REPLACE FUNCTION public.remove_family_member(
  p_user_id UUID,
  p_family_id UUID
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID;
  v_family_exists BOOLEAN := FALSE;
  v_is_admin BOOLEAN := FALSE;
  v_target_role TEXT;
  v_admin_count INT;
  v_fallback_family_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  IF p_user_id IS NULL OR p_family_id IS NULL THEN
    RAISE EXCEPTION 'Parâmetros inválidos para remoção de membro.';
  END IF;

  -- Trava transacional na família para impedir remoção concorrente do último ADM
  SELECT TRUE
  INTO v_family_exists
  FROM public.families
  WHERE id = p_family_id
  FOR UPDATE;

  IF NOT COALESCE(v_family_exists, FALSE) THEN
    RAISE EXCEPTION 'Família não encontrada.';
  END IF;

  -- Autorização estrita: apenas ADMIN ativo desta família pode remover vínculos
  SELECT EXISTS (
    SELECT 1
    FROM public.family_members
    WHERE family_id = p_family_id
      AND user_id = v_caller_id
      AND role = 'ADMIN'
  ) INTO v_is_admin;

  IF NOT COALESCE(v_is_admin, FALSE) THEN
    RAISE EXCEPTION 'Apenas administradores podem remover membros.';
  END IF;

  SELECT role
  INTO v_target_role
  FROM public.family_members
  WHERE family_id = p_family_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membro não encontrado nesta família.';
  END IF;

  IF v_target_role = 'ADMIN' THEN
    SELECT count(*)
    INTO v_admin_count
    FROM public.family_members
    WHERE family_id = p_family_id
      AND role = 'ADMIN';

    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'Este usuário é o único administrador da família e não pode ser removido.';
    END IF;
  END IF;

  DELETE FROM public.family_members
  WHERE family_id = p_family_id
    AND user_id = p_user_id;

  -- Se o usuário removido estava com esta família selecionada em profiles.family_id,
  -- alterna automaticamente para outra família ativa em que ele possua vínculo (preferindo ADMIN).
  -- Como v_fallback_family_id vem de public.family_members, o trigger protect_profile_family_switch valida com sucesso.
  SELECT fm.family_id
  INTO v_fallback_family_id
  FROM public.family_members fm
  WHERE fm.user_id = p_user_id
  ORDER BY (CASE WHEN fm.role = 'ADMIN' THEN 0 ELSE 1 END), fm.created_at ASC
  LIMIT 1;

  IF v_fallback_family_id IS NOT NULL THEN
    UPDATE public.profiles
    SET family_id = v_fallback_family_id,
        updated_at = now()
    WHERE id = p_user_id
      AND family_id = p_family_id;
  END IF;

  RETURN json_build_object(
    'success', true,
    'family_id', p_family_id,
    'removed_user_id', p_user_id,
    'fallback_family_id', v_fallback_family_id
  );
END;
$$;

-- ============================================================================
-- 3. PRIVILÉGIOS DE EXECUÇÃO E RELOAD DO CACHE POSTGREST
-- ============================================================================

REVOKE INSERT, UPDATE, DELETE ON public.family_members FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.update_family_member_role(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_family_member_role(UUID, UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.remove_family_member(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_family_member(UUID, UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
