-- 0020: Multi-weekday scheduling and per-day dosage for medications, plus dosage snapshot on logs
-- Safe, idempotent, non-destructive migration.

ALTER TABLE public.medications
  ADD COLUMN IF NOT EXISTS weekdays TEXT[];

ALTER TABLE public.medications
  ADD COLUMN IF NOT EXISTS daily_dosages JSONB;

ALTER TABLE public.medications
  DROP CONSTRAINT IF EXISTS medications_weekdays_valid_check;

ALTER TABLE public.medications
  ADD CONSTRAINT medications_weekdays_valid_check CHECK (
    weekdays IS NULL OR (
      cardinality(weekdays) >= 1 AND
      weekdays <@ ARRAY[
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday'
      ]::TEXT[]
    )
  );

-- Backfill existing single-weekday weekly medications into weekdays[]
UPDATE public.medications
SET weekdays = ARRAY[weekday]
WHERE frequency = 'weekly'
  AND weekday IS NOT NULL
  AND btrim(weekday) <> ''
  AND weekday IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')
  AND weekdays IS NULL;

-- Snapshot of the exact dosage applied on the event day (preserves audit trail if routine changes later)
ALTER TABLE public.medication_logs
  ADD COLUMN IF NOT EXISTS applied_dosage TEXT;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
