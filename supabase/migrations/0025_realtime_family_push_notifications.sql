-- MIGRATION 0025: NOTIFICAÇÕES WEB PUSH EM TEMPO REAL PARA FAMILIARES (REFEIÇÕES E MEDICAMENTOS)
-- Segura, idempotente e não destrutiva: mantém dados e travas existentes intactos.
-- Pré-requisito: migration 0024 aplicada (public.notification_dispatch_logs).

DO $$
BEGIN
  IF to_regclass('public.notification_dispatch_logs') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito ausente: public.notification_dispatch_logs não existe (aplique a migration 0024 primeiro).';
  END IF;
END;
$$;

ALTER TABLE public.notification_dispatch_logs
  DROP CONSTRAINT IF EXISTS notification_dispatch_logs_type_check;

ALTER TABLE public.notification_dispatch_logs
  ADD CONSTRAINT notification_dispatch_logs_type_check CHECK (
    notification_type IN (
      'medication',
      'meal',
      'meal_recorded',
      'medication_recorded',
      'activity_7d',
      'activity_3d',
      'activity_1d',
      'activity_today'
    )
  );

NOTIFY pgrst, 'reload schema';
