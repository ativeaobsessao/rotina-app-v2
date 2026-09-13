-- FASE 2: MOTOR DE CONVITES (FAMILY INVITES)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Create table
CREATE TABLE IF NOT EXISTS public.family_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')) DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    accepted_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indices for fast lookups
CREATE INDEX IF NOT EXISTS idx_family_invites_token_hash ON public.family_invites(token_hash);
CREATE INDEX IF NOT EXISTS idx_family_invites_family_id ON public.family_invites(family_id);
CREATE INDEX IF NOT EXISTS idx_family_invites_status ON public.family_invites(status);

-- Enable RLS
ALTER TABLE public.family_invites ENABLE ROW LEVEL SECURITY;

-- 2. RLS Policies
-- Only ADMINs can view invites for their active families
CREATE POLICY "Admins can view their family invites"
ON public.family_invites
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = family_invites.family_id 
      AND user_id = auth.uid() 
      AND role = 'ADMIN'
  )
);
-- Notice: NO insert/update/delete policies. Mutations happen strictly via SECURITY DEFINER RPCs.

-- 3. RPC: Create Invite
CREATE OR REPLACE FUNCTION public.create_family_invite()
RETURNS json AS $$
DECLARE
  v_family_id UUID;
  v_is_admin BOOLEAN;
  v_raw_token TEXT;
  v_hashed_token TEXT;
  v_expires_at TIMESTAMPTZ;
  v_invite_id UUID;
BEGIN
  -- Identifica o contexto ativo do usuário
  v_family_id := get_current_family_id();
  IF v_family_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não possui contexto de família ativo.';
  END IF;
  
  -- Valida se é ADMIN daquela família
  SELECT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = v_family_id AND user_id = auth.uid() AND role = 'ADMIN'
  ) INTO v_is_admin;
  
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Apenas administradores podem criar convites.';
  END IF;
  
  -- Gera Token Criptograficamente Seguro (32 bytes = 64 chars hexadecimais)
  v_raw_token := encode(gen_random_bytes(32), 'hex');
  -- Hashea o token com SHA-256 para armazenar com segurança
  v_hashed_token := encode(digest(v_raw_token, 'sha256'), 'hex');
  
  -- Expiração de 24 horas
  v_expires_at := now() + interval '24 hours';
  
  INSERT INTO public.family_invites (family_id, created_by, token_hash, expires_at)
  VALUES (v_family_id, auth.uid(), v_hashed_token, v_expires_at)
  RETURNING id INTO v_invite_id;
  
  -- Retorna APENAS o token puro (para o frontend montar o link) e metadados visuais
  RETURN json_build_object(
    'invite_id', v_invite_id,
    'token', v_raw_token,
    'expires_at', v_expires_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4. RPC: Accept Invite
CREATE OR REPLACE FUNCTION public.accept_family_invite(p_token TEXT)
RETURNS json AS $$
DECLARE
  v_hashed_token TEXT;
  v_invite RECORD;
  v_already_member BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;
  
  -- Reconstroi o hash para busca
  v_hashed_token := encode(digest(p_token, 'sha256'), 'hex');
  
  -- SELECT FOR UPDATE garante ATOMICIDADE, bloqueando a linha para impedir Double Acceptance (Race Conditions)
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
    -- Atualiza dinamicamente para expirado caso o tempo tenha passado
    UPDATE public.family_invites SET status = 'expired' WHERE id = v_invite.id;
    RAISE EXCEPTION 'Convite expirado.';
  END IF;
  
  -- Verifica Duplicidade: Usuário já é membro desta família?
  SELECT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = v_invite.family_id AND user_id = auth.uid()
  ) INTO v_already_member;
  
  IF v_already_member THEN
    RAISE EXCEPTION 'Usuário já pertence a esta família. Nenhuma alteração foi feita.';
  END IF;
  
  -- Efetivação: Insere o membro (MEMBER)
  INSERT INTO public.family_members (family_id, user_id, role)
  VALUES (v_invite.family_id, auth.uid(), 'MEMBER');
  
  -- Consome o convite
  UPDATE public.family_invites
  SET status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  WHERE id = v_invite.id;
  
  RETURN json_build_object(
    'success', true,
    'family_id', v_invite.family_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 5. RPC: Revoke Invite
CREATE OR REPLACE FUNCTION public.revoke_family_invite(p_invite_id UUID)
RETURNS void AS $$
DECLARE
  v_family_id UUID;
  v_is_admin BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  SELECT family_id INTO v_family_id
  FROM public.family_invites
  WHERE id = p_invite_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite não encontrado.';
  END IF;
  
  SELECT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = v_family_id AND user_id = auth.uid() AND role = 'ADMIN'
  ) INTO v_is_admin;
  
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Apenas administradores podem revogar convites desta família.';
  END IF;
  
  UPDATE public.family_invites
  SET status = 'revoked'
  WHERE id = p_invite_id AND status = 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

