-- FASE 3: BACKEND SUPPORT FOR CONTEXT & MEMBERSHIP MANAGEMENT

-- 1. RPC: Set Active Family (Context Switch)
CREATE OR REPLACE FUNCTION public.set_active_family(p_family_id UUID)
RETURNS void AS $$
DECLARE
  v_is_member BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  -- Validate membership
  SELECT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = p_family_id AND user_id = auth.uid()
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'Acesso negado. Você não pertence a esta família.';
  END IF;

  -- Update active context
  UPDATE public.profiles
  SET family_id = p_family_id, updated_at = now()
  WHERE id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. RPC: Remove Family Member
CREATE OR REPLACE FUNCTION public.remove_family_member(p_user_id UUID, p_family_id UUID)
RETURNS void AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_admin_count INT;
  v_target_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  -- Check if caller is ADMIN
  SELECT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = p_family_id AND user_id = auth.uid() AND role = 'ADMIN'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Apenas administradores podem remover membros.';
  END IF;

  -- Check target's role
  SELECT role INTO v_target_role
  FROM public.family_members
  WHERE family_id = p_family_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membro não encontrado nesta família.';
  END IF;

  -- If target is ADMIN, ensure they are not the last one
  IF v_target_role = 'ADMIN' THEN
    SELECT count(*) INTO v_admin_count
    FROM public.family_members
    WHERE family_id = p_family_id AND role = 'ADMIN';

    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'Este usuário é o único administrador da família e não pode ser removido.';
    END IF;
  END IF;

  -- Remove membership
  DELETE FROM public.family_members
  WHERE family_id = p_family_id AND user_id = p_user_id;

  -- NOTE: We do NOT remove the profile, history, or anything else.
  -- RLS will handle revoking access to family resources automatically.
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
