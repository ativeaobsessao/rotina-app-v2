-- MIGRATION 0011: ADMIN-ONLY MOOD/PAIN WRITE PERMISSIONS & ROLE UPDATE RPC

-- 1. Restringir escrita em daily_mood_logs apenas para contas ADMIN (Cuidadora / Responsável)
-- Contas MEMBER (Familiares que acompanham) mantêm acesso completo de leitura (SELECT).
DROP POLICY IF EXISTS "Membros da família podem visualizar o estado de espírito" ON public.daily_mood_logs;
DROP POLICY IF EXISTS "Membros da família podem registrar ou atualizar o estado de espírito" ON public.daily_mood_logs;
DROP POLICY IF EXISTS "Apenas administradores podem inserir o estado de espírito" ON public.daily_mood_logs;
DROP POLICY IF EXISTS "Apenas administradores podem atualizar o estado de espírito" ON public.daily_mood_logs;
DROP POLICY IF EXISTS "Apenas administradores podem remover o estado de espírito" ON public.daily_mood_logs;

CREATE POLICY "Membros da família podem visualizar o estado de espírito"
  ON public.daily_mood_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.family_members
      WHERE family_members.family_id = daily_mood_logs.family_id
        AND family_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Apenas administradores podem inserir o estado de espírito"
  ON public.daily_mood_logs
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.family_members
      WHERE family_members.family_id = daily_mood_logs.family_id
        AND family_members.user_id = auth.uid()
        AND family_members.role = 'ADMIN'
    )
  );

CREATE POLICY "Apenas administradores podem atualizar o estado de espírito"
  ON public.daily_mood_logs
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.family_members
      WHERE family_members.family_id = daily_mood_logs.family_id
        AND family_members.user_id = auth.uid()
        AND family_members.role = 'ADMIN'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.family_members
      WHERE family_members.family_id = daily_mood_logs.family_id
        AND family_members.user_id = auth.uid()
        AND family_members.role = 'ADMIN'
    )
  );

CREATE POLICY "Apenas administradores podem remover o estado de espírito"
  ON public.daily_mood_logs
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.family_members
      WHERE family_members.family_id = daily_mood_logs.family_id
        AND family_members.user_id = auth.uid()
        AND family_members.role = 'ADMIN'
    )
  );

-- 2. RPC Segura para Administrador promover/alterar papel de membro (ex: promover cuidadora para ADMIN)
CREATE OR REPLACE FUNCTION public.update_family_member_role(
  p_user_id UUID,
  p_family_id UUID,
  p_new_role TEXT
)
RETURNS json AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_current_role TEXT;
  v_admin_count INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  IF p_new_role NOT IN ('ADMIN', 'MEMBER') THEN
    RAISE EXCEPTION 'Papel inválido. Use ADMIN ou MEMBER.';
  END IF;

  -- Lock da família para evitar race condition
  PERFORM 1 FROM public.families WHERE id = p_family_id FOR UPDATE;

  -- Verifica se quem está chamando é ADMIN desta família
  SELECT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = p_family_id AND user_id = auth.uid() AND role = 'ADMIN'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Apenas administradores podem alterar permissões de membros.';
  END IF;

  -- Verifica o papel atual do alvo
  SELECT role INTO v_current_role
  FROM public.family_members
  WHERE family_id = p_family_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membro não encontrado nesta família.';
  END IF;

  -- Impede rebaixar o último ADMIN da família
  IF v_current_role = 'ADMIN' AND p_new_role = 'MEMBER' THEN
    SELECT count(*) INTO v_admin_count
    FROM public.family_members
    WHERE family_id = p_family_id AND role = 'ADMIN';

    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'A família precisa ter pelo menos um Administrador ativo.';
    END IF;
  END IF;

  UPDATE public.family_members
  SET role = p_new_role
  WHERE family_id = p_family_id AND user_id = p_user_id;

  RETURN json_build_object(
    'success', true,
    'user_id', p_user_id,
    'role', p_new_role
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
