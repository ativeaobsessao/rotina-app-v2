-- MIGRATION 0016: EXCLUSÃO SEGURA DE REGISTROS DE CONVITES PELO ADM (SEM AFETAR VÍNCULOS ATIVOS)
-- Segura, idempotente e não destrutiva para membros: apagar registros de convite não remove familiares nem cuidadores.

DO $$
BEGIN
  IF to_regclass('public.family_invites') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.family_invites não existe.';
  END IF;
END;
$$;

-- 1. RPC para apagar um único registro de convite (pendente, expirado, revogado ou aceito)
CREATE OR REPLACE FUNCTION public.delete_family_invite(p_invite_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  IF p_invite_id IS NULL THEN
    RAISE EXCEPTION 'Convite não encontrado.';
  END IF;

  SELECT family_id
  INTO v_family_id
  FROM public.family_invites
  WHERE id = p_invite_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite não encontrado.';
  END IF;

  IF NOT COALESCE(public.user_is_family_admin(v_family_id), FALSE) THEN
    RAISE EXCEPTION 'Apenas administradores podem apagar registros de convite.';
  END IF;

  -- Remove apenas o registro visual/histórico do convite.
  -- Vínculos já aceitos em public.family_members permanecem intactos.
  DELETE FROM public.family_invites
  WHERE id = p_invite_id;
END;
$$;

-- 2. RPC para limpar em lote o histórico de convites encerrados/expirados da tela
CREATE OR REPLACE FUNCTION public.clear_family_invite_history(p_family_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_count INT := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  IF p_family_id IS NULL THEN
    RAISE EXCEPTION 'Família não informada.';
  END IF;

  IF NOT COALESCE(public.user_is_family_admin(p_family_id), FALSE) THEN
    RAISE EXCEPTION 'Apenas administradores podem limpar o histórico de convites.';
  END IF;

  DELETE FROM public.family_invites
  WHERE family_id = p_family_id
    AND (
      status IN ('accepted', 'revoked', 'expired')
      OR (status = 'pending' AND expires_at < now())
    );

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$$;

-- 3. Proteção RBAC estrita (escrita direta segue bloqueada; execução restrita a authenticated/service_role)
REVOKE INSERT, UPDATE, DELETE ON public.family_invites FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.delete_family_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_family_invite(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.clear_family_invite_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_family_invite_history(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
