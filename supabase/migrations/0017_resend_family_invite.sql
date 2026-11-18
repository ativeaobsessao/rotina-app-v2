-- MIGRATION 0017: REENVIO MANUAL DE CONVITE PELO ADM (ROTAÇÃO DE TOKEN + RENOVAÇÃO DE 24H)
-- Segura, idempotente e alinhada ao fluxo de token_hash SHA-256 + RBAC estrito.
-- Não armazena token em texto plano no banco: gera um novo token, invalida o link anterior
-- e renova expires_at para +24 horas no mesmo registro de convite.

-- ============================================================================
-- 0. VALIDAÇÃO DE PRÉ-REQUISITOS
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.family_invites') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.family_invites não existe.';
  END IF;

  IF to_regclass('public.family_members') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.family_members não existe.';
  END IF;
END;
$$;

-- ============================================================================
-- 1. RPC: resend_family_invite(p_invite_id UUID)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resend_family_invite(p_invite_id UUID)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invite RECORD;
  v_raw_token TEXT;
  v_hashed_token TEXT;
  v_expires_at TIMESTAMPTZ;
  v_member_type TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  IF p_invite_id IS NULL THEN
    RAISE EXCEPTION 'Convite não encontrado.';
  END IF;

  SELECT *
  INTO v_invite
  FROM public.family_invites
  WHERE id = p_invite_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite não encontrado.';
  END IF;

  IF NOT COALESCE(public.user_is_family_admin(v_invite.family_id), FALSE) THEN
    RAISE EXCEPTION 'Apenas administradores podem reenviar convites desta família.';
  END IF;

  IF v_invite.status = 'accepted' THEN
    RAISE EXCEPTION 'Este convite já foi aceito e não pode ser reenviado.';
  END IF;

  IF v_invite.status = 'revoked' THEN
    RAISE EXCEPTION 'Este convite foi revogado. Crie um novo convite se precisar convidar novamente.';
  END IF;

  IF v_invite.status NOT IN ('pending', 'expired') THEN
    RAISE EXCEPTION 'Este convite não está disponível para reenvio.';
  END IF;

  v_raw_token := encode(gen_random_bytes(32), 'hex');
  v_hashed_token := encode(digest(v_raw_token, 'sha256'), 'hex');
  v_expires_at := now() + interval '24 hours';
  v_member_type := CASE
    WHEN v_invite.member_type IN ('FAMILY', 'CAREGIVER') THEN v_invite.member_type
    ELSE 'FAMILY'
  END;

  UPDATE public.family_invites
  SET
    token_hash = v_hashed_token,
    status = 'pending',
    expires_at = v_expires_at
  WHERE id = v_invite.id;

  RETURN json_build_object(
    'invite_id', v_invite.id,
    'token', v_raw_token,
    'expires_at', v_expires_at,
    'invited_name', v_invite.invited_name,
    'member_type', v_member_type
  );
END;
$$;

-- ============================================================================
-- 2. SEGURANÇA: search_path COMPATÍVEL COM pgcrypto + REVOKE/GRANT
-- ============================================================================

REVOKE INSERT, UPDATE, DELETE ON public.family_invites FROM anon, authenticated;

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
    RAISE EXCEPTION 'Extensão pgcrypto não encontrada para o reenvio de convite familiar.';
  END IF;

  IF v_pgcrypto_schema = 'public' THEN
    v_invite_search_path := 'public';
  ELSE
    v_invite_search_path := format('public, %I', v_pgcrypto_schema);
  END IF;

  EXECUTE format('ALTER FUNCTION public.resend_family_invite(uuid) SET search_path = %s', v_invite_search_path);
  REVOKE ALL ON FUNCTION public.resend_family_invite(uuid) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.resend_family_invite(uuid) TO authenticated, service_role;
END;
$$;

NOTIFY pgrst, 'reload schema';
