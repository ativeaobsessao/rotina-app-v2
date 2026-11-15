-- MIGRATION 0012: ADD DRINK DESCRIPTION TO MEAL LOGS + STORAGE BUCKET & POLICIES

ALTER TABLE public.meal_logs
ADD COLUMN IF NOT EXISTS drink_description TEXT;

-- Garante que o bucket privado 'meal-records' exista
INSERT INTO storage.buckets (id, name, public)
VALUES ('meal-records', 'meal-records', false)
ON CONFLICT (id) DO NOTHING;

-- Garante políticas de acesso (SELECT, INSERT, UPDATE, DELETE) para familiares/cuidadores no bucket 'meal-records'
DROP POLICY IF EXISTS "Family members can view meal records" ON storage.objects;
DROP POLICY IF EXISTS "Family members can upload meal records" ON storage.objects;
DROP POLICY IF EXISTS "Family members can update meal records" ON storage.objects;
DROP POLICY IF EXISTS "Family members can delete meal records" ON storage.objects;

CREATE POLICY "Family members can view meal records"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'meal-records' AND user_can_access_storage_path(name));

CREATE POLICY "Family members can upload meal records"
  ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'meal-records' AND user_can_access_storage_path(name));

CREATE POLICY "Family members can update meal records"
  ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'meal-records' AND user_can_access_storage_path(name));

CREATE POLICY "Family members can delete meal records"
  ON storage.objects
  FOR DELETE
  USING (bucket_id = 'meal-records' AND user_can_access_storage_path(name));
