-- Storage Policies Fixes
-- Drop old permissive policies
DROP POLICY IF EXISTS "Authenticated users can view patient profiles" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload patient profiles" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update patient profiles" ON storage.objects;

DROP POLICY IF EXISTS "Authenticated users can view meal records" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload meal records" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update meal records" ON storage.objects;

-- Create helper function
CREATE OR REPLACE FUNCTION user_can_access_storage_path(object_name text)
RETURNS BOOLEAN AS $$
DECLARE
  extracted_patient_id UUID;
  user_family_id UUID;
  patient_family_id UUID;
BEGIN
  -- Extract patient_id (assuming it is the first part of the path and is a valid UUID)
  BEGIN
    extracted_patient_id := split_part(object_name, '/', 1)::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN FALSE;
  END;
  
  -- Get user's family_id
  SELECT family_id INTO user_family_id FROM profiles WHERE id = auth.uid() LIMIT 1;
  
  -- Get patient's family_id
  SELECT family_id INTO patient_family_id FROM patients WHERE id = extracted_patient_id LIMIT 1;
  
  -- Return true if they match
  RETURN user_family_id = patient_family_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- New Storage Policies: Patient Profile
CREATE POLICY "Family members can view patient profiles" ON storage.objects
  FOR SELECT USING (bucket_id = 'patient-profile' AND user_can_access_storage_path(name));
CREATE POLICY "Family members can upload patient profiles" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'patient-profile' AND user_can_access_storage_path(name));
CREATE POLICY "Family members can update patient profiles" ON storage.objects
  FOR UPDATE USING (bucket_id = 'patient-profile' AND user_can_access_storage_path(name));

-- New Storage Policies: Meal Records
CREATE POLICY "Family members can view meal records" ON storage.objects
  FOR SELECT USING (bucket_id = 'meal-records' AND user_can_access_storage_path(name));
CREATE POLICY "Family members can upload meal records" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'meal-records' AND user_can_access_storage_path(name));
CREATE POLICY "Family members can update meal records" ON storage.objects
  FOR UPDATE USING (bucket_id = 'meal-records' AND user_can_access_storage_path(name));

