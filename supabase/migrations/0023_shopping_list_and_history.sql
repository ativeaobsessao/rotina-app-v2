-- MIGRATION 0023: LISTA DE COMPRAS + HISTÓRICO DE GASTOS + AUTOEXCLUSÃO EM 6 MESES
-- Segura, idempotente e não destrutiva: mantém dados existentes intactos.
-- Pré-requisito: migration 0014 aplicada (public.user_in_family).

-- ============================================================================
-- 0. VALIDAÇÃO DE PRÉ-REQUISITOS ESTRUTURAIS
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.families') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.families não existe.';
  END IF;

  IF to_regclass('public.patients') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.patients não existe.';
  END IF;

  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.profiles não existe.';
  END IF;

  IF to_regprocedure('public.user_in_family(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.user_in_family(uuid) não encontrada.';
  END IF;
END;
$$;

-- ============================================================================
-- 1. TABELA DE ITENS DA LISTA DE COMPRAS (PENDENTES E COMPRADOS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.shopping_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity TEXT,
  notes TEXT,
  is_urgent BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending',
  price_cents INTEGER,
  requested_by UUID NOT NULL,
  purchased_by UUID,
  purchased_at TIMESTAMPTZ,
  purchased_date DATE,
  updated_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT shopping_items_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.profiles(id),
  CONSTRAINT shopping_items_purchased_by_fkey FOREIGN KEY (purchased_by) REFERENCES public.profiles(id),
  CONSTRAINT shopping_items_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id),
  CONSTRAINT shopping_items_name_not_empty_check CHECK (btrim(name) <> ''),
  CONSTRAINT shopping_items_status_check CHECK (status IN ('pending', 'purchased')),
  CONSTRAINT shopping_items_price_non_negative_check CHECK (price_cents IS NULL OR price_cents >= 0),
  CONSTRAINT shopping_items_purchase_consistency_check CHECK (
    (status = 'pending' AND purchased_at IS NULL AND purchased_date IS NULL)
    OR
    (status = 'purchased' AND purchased_at IS NOT NULL AND purchased_date IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_shopping_items_patient_status
  ON public.shopping_items(patient_id, status, is_urgent DESC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_shopping_items_patient_purchased
  ON public.shopping_items(patient_id, purchased_date DESC, purchased_at DESC)
  WHERE status = 'purchased';

CREATE INDEX IF NOT EXISTS idx_shopping_items_family_purge
  ON public.shopping_items(family_id, purchased_at)
  WHERE status = 'purchased';

-- ============================================================================
-- 2. TRIGGER DE INTEGRIDADE DO SOLICITANTE ORIGINAL
-- ============================================================================

CREATE OR REPLACE FUNCTION public.preserve_shopping_requester()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.requested_by IS DISTINCT FROM OLD.requested_by THEN
    RAISE EXCEPTION 'Não é permitido alterar quem solicitou o item originalmente.'
      USING ERRCODE = '42501';
  END IF;

  NEW.created_at := OLD.created_at;
  NEW.family_id := OLD.family_id;
  NEW.patient_id := OLD.patient_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.preserve_shopping_requester() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS preserve_shopping_item_requester ON public.shopping_items;
CREATE TRIGGER preserve_shopping_item_requester
  BEFORE UPDATE ON public.shopping_items
  FOR EACH ROW
  EXECUTE FUNCTION public.preserve_shopping_requester();

-- ============================================================================
-- 3. AUTOEXCLUSÃO APÓS 6 MESES DA MARCAÇÃO DE COMPRADO
-- ============================================================================
-- Remove apenas itens já comprados cujo purchased_at ultrapassou 6 meses.
-- Itens pendentes na lista nunca são apagados automaticamente.

CREATE OR REPLACE FUNCTION public.purge_expired_shopping_items(p_family_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER := 0;
BEGIN
  IF p_family_id IS NOT NULL THEN
    IF auth.uid() IS NOT NULL AND NOT public.user_in_family(p_family_id) THEN
      RAISE EXCEPTION 'Acesso negado para limpar histórico de outra família.'
        USING ERRCODE = '42501';
    END IF;

    DELETE FROM public.shopping_items
    WHERE family_id = p_family_id
      AND status = 'purchased'
      AND purchased_at < timezone('utc'::text, now()) - INTERVAL '6 months';
  ELSE
    IF auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'Informe a família para limpeza manual ou execute via rotina do servidor.'
        USING ERRCODE = '42501';
    END IF;

    DELETE FROM public.shopping_items
    WHERE status = 'purchased'
      AND purchased_at < timezone('utc'::text, now()) - INTERVAL '6 months';
  END IF;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_shopping_items(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_expired_shopping_items(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.trigger_purge_expired_shopping_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.shopping_items
  WHERE family_id = NEW.family_id
    AND status = 'purchased'
    AND purchased_at < timezone('utc'::text, now()) - INTERVAL '6 months';

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_purge_expired_shopping_items() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_purge_expired_shopping_items ON public.shopping_items;
CREATE TRIGGER trg_purge_expired_shopping_items
  AFTER INSERT OR UPDATE ON public.shopping_items
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_purge_expired_shopping_items();

-- Agenda diária opcional via pg_cron caso a extensão esteja habilitada no projeto
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'duca_purge_expired_shopping_items'
    ) THEN
      PERFORM cron.schedule(
        'duca_purge_expired_shopping_items',
        '30 3 * * *',
        'SELECT public.purge_expired_shopping_items(NULL);'
      );
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

-- ============================================================================
-- 4. RLS: TODAS AS CONTAS ATIVAS DA FAMÍLIA PODEM GERENCIAR A LISTA E HISTÓRICO
-- ============================================================================

ALTER TABLE public.shopping_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Family members can view shopping items" ON public.shopping_items;
DROP POLICY IF EXISTS "Family members can insert shopping items" ON public.shopping_items;
DROP POLICY IF EXISTS "Family members can update shopping items" ON public.shopping_items;
DROP POLICY IF EXISTS "Family members can delete shopping items" ON public.shopping_items;

CREATE POLICY "Family members can view shopping items"
  ON public.shopping_items
  FOR SELECT
  TO authenticated
  USING (
    public.user_in_family(family_id)
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = shopping_items.patient_id
        AND p.family_id = shopping_items.family_id
    )
  );

CREATE POLICY "Family members can insert shopping items"
  ON public.shopping_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND updated_by = auth.uid()
    AND public.user_in_family(family_id)
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = shopping_items.patient_id
        AND p.family_id = shopping_items.family_id
    )
  );

CREATE POLICY "Family members can update shopping items"
  ON public.shopping_items
  FOR UPDATE
  TO authenticated
  USING (
    public.user_in_family(family_id)
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = shopping_items.patient_id
        AND p.family_id = shopping_items.family_id
    )
  )
  WITH CHECK (
    updated_by = auth.uid()
    AND public.user_in_family(family_id)
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = shopping_items.patient_id
        AND p.family_id = shopping_items.family_id
    )
  );

CREATE POLICY "Family members can delete shopping items"
  ON public.shopping_items
  FOR DELETE
  TO authenticated
  USING (
    public.user_in_family(family_id)
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = shopping_items.patient_id
        AND p.family_id = shopping_items.family_id
    )
  );

-- Habilita Realtime com segurança caso a publicação exista
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'shopping_items'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.shopping_items';
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

NOTIFY pgrst, 'reload schema';
