-- Fix the tables if they were created with the wrong schema

-- Drop the wrong tables (since the user has no data yet anyway because patients failed to save)
DROP TABLE IF EXISTS medication_logs CASCADE;
DROP TABLE IF EXISTS meal_logs CASCADE;

-- Recreate meal_logs correctly
CREATE TABLE meal_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meal_config_id UUID NOT NULL REFERENCES meal_configs(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  event_date DATE NOT NULL,
  consumption_status TEXT NOT NULL CHECK (consumption_status IN ('normal', 'partial', 'none')),
  description TEXT,
  notes TEXT,
  photo_url TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID NOT NULL REFERENCES profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (meal_config_id, event_date)
);

-- Recreate medication_logs correctly
CREATE TABLE medication_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  medication_id UUID NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  event_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('administered', 'not_administered')),
  reason TEXT,
  notes TEXT,
  administered_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID NOT NULL REFERENCES profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (medication_id, event_date)
);

-- Re-apply triggers and RLS for logs
CREATE TRIGGER update_meal_logs_modtime BEFORE UPDATE ON meal_logs FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
CREATE TRIGGER update_medication_logs_modtime BEFORE UPDATE ON medication_logs FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

ALTER TABLE meal_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view meal logs of their family's patients" ON meal_logs
  FOR SELECT USING (patient_id IN (SELECT id FROM patients WHERE family_id = get_current_family_id()));
CREATE POLICY "Users can insert meal logs for their family's patients" ON meal_logs
  FOR INSERT WITH CHECK (patient_id IN (SELECT id FROM patients WHERE family_id = get_current_family_id()));
CREATE POLICY "Users can update meal logs for their family's patients" ON meal_logs
  FOR UPDATE USING (patient_id IN (SELECT id FROM patients WHERE family_id = get_current_family_id()));

CREATE POLICY "Users can view med logs of their family's patients" ON medication_logs
  FOR SELECT USING (patient_id IN (SELECT id FROM patients WHERE family_id = get_current_family_id()));
CREATE POLICY "Users can insert med logs for their family's patients" ON medication_logs
  FOR INSERT WITH CHECK (patient_id IN (SELECT id FROM patients WHERE family_id = get_current_family_id()));
CREATE POLICY "Users can update med logs for their family's patients" ON medication_logs
  FOR UPDATE USING (patient_id IN (SELECT id FROM patients WHERE family_id = get_current_family_id()));

NOTIFY pgrst, 'reload schema';
