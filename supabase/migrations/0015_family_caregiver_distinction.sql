-- MIGRATION 0015: DISTINÇÃO ENTRE FAMILIAR E CUIDADOR + NOME ORGANIZACIONAL NO CONVITE
-- Segura, idempotente e não destrutiva: preserva todos os membros, convites e regras RBAC/RLS existentes.

-- ============================================================================
-- 0. VALIDAÇÃO DE PRÉ-REQUISITOS
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.family_members') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.family_members não existe.';
  END IF;

  IF to_regclass('public.family_invites') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.family_invites não existe.';
  END IF;
END;
$$;

-- ============================================================================
-- 1. MODELO DE DADOS: member_type EM family_members E family_invites + invited_name
-- ============================================================================

ALTER TABLE public.family_members
  ADD COLUMN IF NOT EXISTS member_type TEXT NOT NULL DEFAULT 'FAMILY';

UPDATE public.family_members
SET member_type = 'FAMILY'
WHERE member_type IS NULL;

ALTER TABLE public.family_members
  DROP CONSTRAINT IF EXISTS family_members_member_type_check;

ALTER TABLE public.family_members
  ADD CONSTRAINT family_members_member_type_check
  CHECK (member_type IN ('FAMILY', 'CAREGIVER'));

ALTER TABLE public.family_invites
  ADD COLUMN IF NOT EXISTS invited_name TEXT;

ALTER TABLE public.family_invites
  ADD COLUMN IF NOT EXISTS member_type TEXT NOT NULL DEFAULT 'FAMILY';

UPDATE public.family_invites
SET member_type = 'FAMILY'
WHERE member_type IS NULL;

ALTER TABLE public.family_invites
  DROP CONSTRAINT IF EXISTS family_invites_member_type_check;

ALTER TABLE public.family_invites
  ADD CONSTRAINT family_invites_member_type_check
  CHECK (member_type IN ('FAMILY', 'CAREGIVER'));

-- ============================================================================
-- 2. RPCs: create_family_invite E accept_family_invite
-- ============================================================================

-- Remove assinatura antiga sem parâmetros para evitar ambiguidade de overload
DROP FUNCTION IF EXISTS public.create_family_invite();
DROP FUNCTION IF EXISTS public.create_family_invite(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_family_invite(
  p_invited_name TEXT DEFAULT NULL,
  p_member_type TEXT DEFAULT 'FAMILY'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_family_id UUID;
  v_is_admin BOOLEAN;
  v_raw_token TEXT;
  v_hashed_token TEXT;
  v_expires_at TIMESTAMPTZ;
  v_invite_id UUID;
  v_invited_name TEXT;
  v_member_type TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  v_family_id := public.get_current_family_id();
  IF v_family_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não possui contexto de família ativo.';
  END IF;

  v_is_admin := public.user_is_family_admin(v_family_id);
  IF NOT COALESCE(v_is_admin, FALSE) THEN
    RAISE EXCEPTION 'Apenas administradores podem criar convites.';
  END IF;

  v_member_type := UPPER(COALESCE(NULLIF(btrim(p_member_type), ''), 'FAMILY'));
  IF v_member_type NOT IN ('FAMILY', 'CAREGIVER') THEN
    RAISE EXCEPTION 'Tipo de convite inválido. Use FAMILY ou CAREGIVER.';
  END IF;

  v_invited_name := NULLIF(btrim(COALESCE(p_invited_name, '')), '');

  v_raw_token := encode(gen_random_bytes(32), 'hex');
  v_hashed_token := encode(digest(v_raw_token, 'sha256'), 'hex');
  v_expires_at := now() + interval '24 hours';

  INSERT INTO public.family_invites (
    family_id,
    created_by,
    token_hash,
    expires_at,
    invited_name,
    member_type
  )
  VALUES (
    v_family_id,
    auth.uid(),
    v_hashed_token,
    v_expires_at,
    v_invited_name,
    v_member_type
  )
  RETURNING id INTO v_invite_id;

  RETURN json_build_object(
    'invite_id', v_invite_id,
    'token', v_raw_token,
    'expires_at', v_expires_at,
    'invited_name', v_invited_name,
    'member_type', v_member_type
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_family_invite(p_token TEXT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hashed_token TEXT;
  v_invite RECORD;
  v_already_member BOOLEAN;
  v_member_type TEXT;
  v_initial_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RAISE EXCEPTION 'Convite inválido ou não encontrado.';
  END IF;

  v_hashed_token := encode(digest(p_token, 'sha256'), 'hex');

  SELECT * INTO v_invite
  FROM public.family_invites
  WHERE token_hash = v_hashed_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite inválido ou não encontrado.';
  END IF;

  IF v_invite.status != 'pending' THEN
    RAISE EXCEPTION 'Convite já foi utilizado, expirado ou revogado.';
  END IF;

  IF v_invite.expires_at < now() THEN
    UPDATE public.family_invites
    SET status = 'expired'
    WHERE id = v_invite.id;
    RAISE EXCEPTION 'Convite expirado.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = v_invite.family_id AND user_id = auth.uid()
  ) INTO v_already_member;

  IF v_already_member THEN
    RAISE EXCEPTION 'Usuário já pertence a esta família. Nenhuma alteração foi feita.';
  END IF;

  v_member_type := CASE
    WHEN v_invite.member_type IN ('FAMILY', 'CAREGIVER') THEN v_invite.member_type
    ELSE 'FAMILY'
  END;

  -- Regra de negócio: cuidador (e familiar convidado) entra inicialmente como MEMBER (acesso de consulta).
  -- O ADM pode promover para ADMIN posteriormente via update_family_member_role.
  v_initial_role := 'MEMBER';

  INSERT INTO public.family_members (family_id, user_id, role, member_type)
  VALUES (v_invite.family_id, auth.uid(), v_initial_role, v_member_type);

  UPDATE public.family_invites
  SET status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  WHERE id = v_invite.id;

  RETURN json_build_object(
    'success', true,
    'family_id', v_invite.family_id,
    'role', v_initial_role,
    'member_type', v_member_type
  );
END;
$$;

-- ============================================================================
-- 3. SEGURANÇA: search_path COMPATÍVEL COM pgcrypto + REVOKE/GRANT + BLOQUEIO DE ESCRITA DIRETA
-- ============================================================================

REVOKE INSERT, UPDATE, DELETE ON public.family_members FROM anon, authenticated;
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
    RAISE EXCEPTION 'Extensão pgcrypto não encontrada para os fluxos de convite familiar.';
  END IF;

  IF v_pgcrypto_schema = 'public' THEN
    v_invite_search_path := 'public';
  ELSE
    v_invite_search_path := format('public, %I', v_pgcrypto_schema);
  END IF;

  EXECUTE format('ALTER FUNCTION public.create_family_invite(text, text) SET search_path = %s', v_invite_search_path);
  REVOKE ALL ON FUNCTION public.create_family_invite(text, text) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.create_family_invite(text, text) TO authenticated, service_role;

  EXECUTE format('ALTER FUNCTION public.accept_family_invite(text) SET search_path = %s', v_invite_search_path);
  REVOKE ALL ON FUNCTION public.accept_family_invite(text) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.accept_family_invite(text) TO authenticated, service_role;
END;
$$;

NOTIFY pgrst, 'reload schema';
