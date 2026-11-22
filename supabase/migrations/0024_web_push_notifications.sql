-- MIGRATION 0024: SERVIÇO DE WEB PUSH NOTIFICATIONS + AVISOS DE ATIVIDADES (7, 3 E 1 DIA)
-- Segura, idempotente e não destrutiva: mantém dados e travas existentes intactos.
-- Pré-requisito: migration 0014 e 0021 aplicadas (public.user_in_family, public.activities).

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

  IF to_regclass('public.activities') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.activities não existe (migration 0021).';
  END IF;

  IF to_regprocedure('public.user_in_family(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.user_in_family(uuid) não encontrada.';
  END IF;
END;
$$;

-- ============================================================================
-- 1. TABELA DE INSCRIÇÕES WEB PUSH POR USUÁRIO E APARELHO
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  notify_medications BOOLEAN NOT NULL DEFAULT true,
  notify_meals BOOLEAN NOT NULL DEFAULT true,
  notify_activities BOOLEAN NOT NULL DEFAULT true,
  lead_minutes SMALLINT NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  user_agent TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT push_subscriptions_endpoint_not_empty CHECK (btrim(endpoint) <> ''),
  CONSTRAINT push_subscriptions_p256dh_not_empty CHECK (btrim(keys_p256dh) <> ''),
  CONSTRAINT push_subscriptions_auth_not_empty CHECK (btrim(keys_auth) <> ''),
  CONSTRAINT push_subscriptions_lead_minutes_check CHECK (lead_minutes IN (0, 5, 10, 15, 30)),
  CONSTRAINT push_subscriptions_failure_count_check CHECK (failure_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_enabled_family
  ON public.push_subscriptions(family_id, enabled)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON public.push_subscriptions(user_id, enabled);

CREATE OR REPLACE FUNCTION public.touch_push_subscription_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_subscriptions_updated_at ON public.push_subscriptions;
CREATE TRIGGER trg_push_subscriptions_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_push_subscription_updated_at();

-- ============================================================================
-- 2. HISTÓRICO / IDEMPOTÊNCIA DE DISPAROS (EVITA DUPLICIDADE DE NOTIFICAÇÕES)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notification_dispatch_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  event_date DATE NOT NULL,
  milestone_days INTEGER,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT notification_dispatch_logs_type_check CHECK (
    notification_type IN (
      'medication',
      'meal',
      'activity_7d',
      'activity_3d',
      'activity_1d',
      'activity_today'
    )
  ),
  CONSTRAINT notification_dispatch_logs_milestone_check CHECK (
    milestone_days IS NULL OR milestone_days IN (0, 1, 3, 7)
  ),
  CONSTRAINT notification_dispatch_logs_unique_delivery UNIQUE (
    user_id,
    patient_id,
    notification_type,
    source_id,
    event_date
  )
);

CREATE INDEX IF NOT EXISTS idx_notification_dispatch_logs_sent_at
  ON public.notification_dispatch_logs(sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_dispatch_logs_user_date
  ON public.notification_dispatch_logs(user_id, event_date DESC);

-- Limpeza automática de logs com mais de 45 dias para manter o banco enxuto
CREATE OR REPLACE FUNCTION public.cleanup_old_notification_dispatch_logs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER := 0;
BEGIN
  DELETE FROM public.notification_dispatch_logs
  WHERE sent_at < timezone('utc'::text, now()) - INTERVAL '45 days';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_notification_dispatch_logs() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 3. RPC SEGURA PARA REGISTRAR / ATUALIZAR INSCRIÇÃO DO APARELHO ATUAL
-- ============================================================================

CREATE OR REPLACE FUNCTION public.upsert_my_push_subscription(
  p_family_id UUID,
  p_patient_id UUID,
  p_endpoint TEXT,
  p_keys_p256dh TEXT,
  p_keys_auth TEXT,
  p_enabled BOOLEAN DEFAULT true,
  p_notify_medications BOOLEAN DEFAULT true,
  p_notify_meals BOOLEAN DEFAULT true,
  p_notify_activities BOOLEAN DEFAULT true,
  p_lead_minutes SMALLINT DEFAULT 0,
  p_timezone TEXT DEFAULT 'America/Sao_Paulo',
  p_user_agent TEXT DEFAULT NULL
)
RETURNS public.push_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.push_subscriptions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.' USING ERRCODE = '42501';
  END IF;

  IF p_family_id IS NULL OR NOT public.user_in_family(p_family_id) THEN
    RAISE EXCEPTION 'Sua conta não possui vínculo ativo com esta família.' USING ERRCODE = '42501';
  END IF;

  IF p_patient_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.patients p
    WHERE p.id = p_patient_id
      AND p.family_id = p_family_id
  ) THEN
    RAISE EXCEPTION 'Familiar informado não pertence à família selecionada.' USING ERRCODE = '22023';
  END IF;

  IF btrim(COALESCE(p_endpoint, '')) = '' OR btrim(COALESCE(p_keys_p256dh, '')) = '' OR btrim(COALESCE(p_keys_auth, '')) = '' THEN
    RAISE EXCEPTION 'Dados da inscrição Web Push incompletos.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.push_subscriptions (
    user_id,
    family_id,
    patient_id,
    endpoint,
    keys_p256dh,
    keys_auth,
    enabled,
    notify_medications,
    notify_meals,
    notify_activities,
    lead_minutes,
    timezone,
    user_agent,
    failure_count,
    last_error
  )
  VALUES (
    v_uid,
    p_family_id,
    p_patient_id,
    btrim(p_endpoint),
    btrim(p_keys_p256dh),
    btrim(p_keys_auth),
    COALESCE(p_enabled, true),
    COALESCE(p_notify_medications, true),
    COALESCE(p_notify_meals, true),
    COALESCE(p_notify_activities, true),
    CASE WHEN p_lead_minutes IN (0, 5, 10, 15, 30) THEN p_lead_minutes ELSE 0 END,
    COALESCE(NULLIF(btrim(p_timezone), ''), 'America/Sao_Paulo'),
    p_user_agent,
    0,
    NULL
  )
  ON CONFLICT (endpoint) DO UPDATE SET
    user_id = v_uid,
    family_id = EXCLUDED.family_id,
    patient_id = EXCLUDED.patient_id,
    keys_p256dh = EXCLUDED.keys_p256dh,
    keys_auth = EXCLUDED.keys_auth,
    enabled = EXCLUDED.enabled,
    notify_medications = EXCLUDED.notify_medications,
    notify_meals = EXCLUDED.notify_meals,
    notify_activities = EXCLUDED.notify_activities,
    lead_minutes = EXCLUDED.lead_minutes,
    timezone = EXCLUDED.timezone,
    user_agent = COALESCE(EXCLUDED.user_agent, push_subscriptions.user_agent),
    failure_count = 0,
    last_error = NULL,
    updated_at = timezone('utc'::text, now())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_my_push_subscription(
  UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, SMALLINT, TEXT, TEXT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.upsert_my_push_subscription(
  UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, SMALLINT, TEXT, TEXT
) TO authenticated;

-- ============================================================================
-- 4. RLS ESTRITA (CADA USUÁRIO GERENCIA APENAS SUAS PRÓPRIAS INSCRIÇÕES)
-- ============================================================================

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Users can insert their own push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Users can update their own push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Users can delete their own push subscriptions" ON public.push_subscriptions;

CREATE POLICY "Users can view their own push subscriptions"
  ON public.push_subscriptions
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND public.user_in_family(family_id)
  );

CREATE POLICY "Users can insert their own push subscriptions"
  ON public.push_subscriptions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.user_in_family(family_id)
    AND (
      patient_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.patients p
        WHERE p.id = push_subscriptions.patient_id
          AND p.family_id = push_subscriptions.family_id
      )
    )
  );

CREATE POLICY "Users can update their own push subscriptions"
  ON public.push_subscriptions
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND public.user_in_family(family_id)
  )
  WITH CHECK (
    user_id = auth.uid()
    AND public.user_in_family(family_id)
    AND (
      patient_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.patients p
        WHERE p.id = push_subscriptions.patient_id
          AND p.family_id = push_subscriptions.family_id
      )
    )
  );

CREATE POLICY "Users can delete their own push subscriptions"
  ON public.push_subscriptions
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

ALTER TABLE public.notification_dispatch_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own notification dispatch logs" ON public.notification_dispatch_logs;

CREATE POLICY "Users can view their own notification dispatch logs"
  ON public.notification_dispatch_logs
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND public.user_in_family(family_id)
  );

-- ============================================================================
-- 5. AGENDA AUTOMÁTICA OPCIONAL VIA PG_CRON + PG_NET / VAULT
-- ============================================================================
-- Se pg_cron, pg_net e Supabase Vault estiverem habilitados com os segredos
-- 'duca_supabase_url' e 'duca_notification_cron_secret', agenda disparo a cada 5 min.
-- Caso contrário, nenhum erro é lançado e o bloco pode ser ativado posteriormente.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'duca_cleanup_notification_logs'
    ) THEN
      PERFORM cron.schedule(
        'duca_cleanup_notification_logs',
        '15 4 * * *',
        'SELECT public.cleanup_old_notification_dispatch_logs();'
      );
    END IF;

    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
       AND to_regclass('vault.decrypted_secrets') IS NOT NULL
       AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'duca_supabase_url')
       AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'duca_notification_cron_secret')
    THEN
      IF NOT EXISTS (
        SELECT 1 FROM cron.job WHERE jobname = 'duca_dispatch_web_push_notifications'
      ) THEN
        PERFORM cron.schedule(
          'duca_dispatch_web_push_notifications',
          '*/5 * * * *',
          $cron$
          SELECT net.http_post(
            url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'duca_supabase_url' LIMIT 1) || '/functions/v1/dispatch-notifications',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'duca_notification_cron_secret' LIMIT 1)
            ),
            body := jsonb_build_object('source', 'pg_cron')
          );
          $cron$
        );
      END IF;
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

NOTIFY pgrst, 'reload schema';
