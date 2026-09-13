-- DUDE Initial Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. FAMILIES
CREATE TABLE families (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. PROFILES (Users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. PATIENTS (Avó)
CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. MEAL CONFIGS
CREATE TABLE meal_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- e.g., 'breakfast', 'lunch', 'snack', 'dinner'
  scheduled_time TIME NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. MEDICATION PERIODS
CREATE TABLE medication_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scheduled_time TIME NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. MEDICATIONS
CREATE TABLE medications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  medication_period_id UUID NOT NULL REFERENCES medication_periods(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dosage TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly')),
  weekday TEXT, -- Required if frequency is 'weekly', e.g., 'Sunday'
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. MEAL LOGS
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
  UNIQUE (meal_config_id, event_date) -- Prevents duplicate logs for the same meal on the same day
);

-- 8. MEDICATION LOGS
CREATE TABLE medication_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  medication_id UUID NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  event_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('administered', 'not_administered')),
  reason TEXT, -- Used if not_administered
  notes TEXT,
  administered_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID NOT NULL REFERENCES profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (medication_id, event_date)
);

-- UPDATED_AT TRIGGERS
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_families_modtime BEFORE UPDATE ON families FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
CREATE TRIGGER update_profiles_modtime BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
CREATE TRIGGER update_patients_modtime BEFORE UPDATE ON patients FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
CREATE TRIGGER update_meal_configs_modtime BEFORE UPDATE ON meal_configs FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
CREATE TRIGGER update_medication_periods_modtime BEFORE UPDATE ON medication_periods FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
CREATE TRIGGER update_medications_modtime BEFORE UPDATE ON medications FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
CREATE TRIGGER update_meal_logs_modtime BEFORE UPDATE ON meal_logs FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
CREATE TRIGGER update_medication_logs_modtime BEFORE UPDATE ON medication_logs FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

-- ROW LEVEL SECURITY (RLS)

ALTER TABLE families ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_logs ENABLE ROW LEVEL SECURITY;

-- Helper function to get current user's family_id
CREATE OR REPLACE FUNCTION get_current_family_id()
RETURNS UUID AS $$
  SELECT family_id FROM profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

-- Policies for Families (Users can only see their own family)
CREATE POLICY "Users can view their own family" ON families
  FOR SELECT USING (id = get_current_family_id());

-- Policies for Profiles
CREATE POLICY "Users can view profiles in their family" ON profiles
  FOR SELECT USING (family_id = get_current_family_id());
CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (id = auth.uid());

-- Policies for Patients
CREATE POLICY "Users can view patients in their family" ON patients
  FOR SELECT USING (family_id = get_current_family_id());
CREATE POLICY "Users can insert patients in their family" ON patients
  FOR INSERT WITH CHECK (family_id = get_current_family_id());
CREATE POLICY "Users can update patients in their family" ON patients
  FOR UPDATE USING (family_id = get_current_family_id());

-- Policies for Meal Configs
CREATE POLICY "Users can view meal configs of their family's patients" ON meal_configs
  FOR SELECT USING (patient_id IN (SELECT id FROM patients WHERE family_id = get_current_family_id()));
CREATE POLICY "Users can insert meal configs for their family's patients" ON meal_configs
  FOR INSERT WITH CHECK (patient_id IN (SELECT id FROM patients WHERE family_id = get_current_family_id()));
CREATE POLICY "Users can update meal configs for their family's patients" ON meal_configs
  FOR UPDATE USING (patient_id IN (SELECT id FROM patients WHERE family_id = get_current_family_id()));

-- Policies for Medication Periods
CREATE POLICY "Users can view med periods of their family's patients" ON medication_periods
  FOR SELECT USING (patient_id IN (SELECT id FROM patients WHERE family_id = get_current_family_id()));
CREATE POLICY "Users can insert med periods for their family's patients" ON medication_periods
  FOR INSERT WITH CHECK (patient_id IN (SELECT id FROM patients WHERE family_id = get_current_family_id()));
CREATE POLICY "Users can update med periods for their family's patients" ON medication_periods
  FOR UPDATE USING (patient_id IN (SELECT id FROM patients WHERE family_id = get_current_family_id()));

-- Policies for Medications
CREATE POLICY "Users can view meds of their family's patients" ON medications
  FOR SELECT USING (patient_id IN (SELECT id FROM patients WHERE family_id = get_current_family_id()));
CREATE POLICY "Users can insert meds for their family's patients" ON medications
  FOR INSERT WITH CHECK (patient_id IN (SELECT id FROM patients WHERE family_id = get_current_family_id()));
CREATE POLICY "Users can update meds for their family's patients" ON medications
  FOR UPDATE USING (patient_id IN (SELECT id FROM patients WHERE family_id = get_current_family_id()));

-- Policies for Meal Logs
CREATE POLICY "Users can view meal logs of their family's patients" ON meal_logs
  FOR SELECT USING (patient_id IN (SELECT id FROM patients WHERE family_id = get_current_family_id()));
CREATE POLICY "Users can insert meal logs for their family's patients" ON meal_logs
  FOR INSERT WITH CHECK (patient_id IN (SELECT id FROM patients WHERE family_id = get_current_family_id()));
CREATE POLICY "Users can update meal logs for their family's patients" ON meal_logs
  FOR UPDATE USING (patient_id IN (SELECT id FROM patients WHERE family_id = get_current_family_id()));

-- Policies for Medication Logs
CREATE POLICY "Users can view med logs of their family's patients" ON medication_logs
  FOR SELECT USING (patient_id IN (SELECT id FROM patients WHERE family_id = get_current_family_id()));
CREATE POLICY "Users can insert med logs for their family's patients" ON medication_logs
  FOR INSERT WITH CHECK (patient_id IN (SELECT id FROM patients WHERE family_id = get_current_family_id()));
CREATE POLICY "Users can update med logs for their family's patients" ON medication_logs
  FOR UPDATE USING (patient_id IN (SELECT id FROM patients WHERE family_id = get_current_family_id()));


-- STORAGE BUCKETS
INSERT INTO storage.buckets (id, name, public) VALUES ('patient-profile', 'patient-profile', false);
INSERT INTO storage.buckets (id, name, public) VALUES ('meal-records', 'meal-records', false);

-- Storage Policies: Patient Profile (Authenticated users can read/write)
-- In a real production setup, we'd add checks to ensure they only access their family's folder
CREATE POLICY "Authenticated users can view patient profiles" ON storage.objects
  FOR SELECT USING (bucket_id = 'patient-profile' AND auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can upload patient profiles" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'patient-profile' AND auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can update patient profiles" ON storage.objects
  FOR UPDATE USING (bucket_id = 'patient-profile' AND auth.role() = 'authenticated');

-- Storage Policies: Meal Records
CREATE POLICY "Authenticated users can view meal records" ON storage.objects
  FOR SELECT USING (bucket_id = 'meal-records' AND auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can upload meal records" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'meal-records' AND auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can update meal records" ON storage.objects
  FOR UPDATE USING (bucket_id = 'meal-records' AND auth.role() = 'authenticated');
