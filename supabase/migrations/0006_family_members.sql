-- FASE 1: FAMILY MEMBERS MIGRATION (REVISION 2)

-- 1. Create table
CREATE TABLE IF NOT EXISTS public.family_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('ADMIN', 'MEMBER')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(family_id, user_id)
);

-- Enable RLS
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;

-- 2. Migrate existing users (Since every user currently is alone in their family, they are the ADMINs)
INSERT INTO public.family_members (family_id, user_id, role)
SELECT family_id, id, 'ADMIN'
FROM public.profiles
WHERE family_id IS NOT NULL
ON CONFLICT (family_id, user_id) DO NOTHING;

-- 3. Break recursion with a SECURITY DEFINER helper for membership checks
CREATE OR REPLACE FUNCTION user_in_family(f_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.family_members 
    WHERE family_id = f_id AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- 4. RLS for family_members
CREATE POLICY "Users can view members of their families" 
  ON public.family_members
  FOR SELECT USING ( user_in_family(family_id) );

-- 5. Rewrite get_current_family_id() using profiles.family_id as the ACTIVE WORKSPACE
-- This solves the multiple memberships ambiguity and protects against malicious profile updates.
CREATE OR REPLACE FUNCTION get_current_family_id()
RETURNS UUID AS $$
  SELECT m.family_id 
  FROM public.profiles p
  JOIN public.family_members m ON p.family_id = m.family_id AND m.user_id = p.id
  WHERE p.id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

-- 6. Rewrite Storage function to check membership directly
CREATE OR REPLACE FUNCTION user_can_access_storage_path(object_name text)
RETURNS BOOLEAN AS $$
DECLARE
  extracted_patient_id UUID;
  patient_family_id UUID;
BEGIN
  BEGIN
    extracted_patient_id := split_part(object_name, '/', 1)::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN FALSE;
  END;
  
  SELECT family_id INTO patient_family_id FROM public.patients WHERE id = extracted_patient_id LIMIT 1;
  
  RETURN user_in_family(patient_family_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Fix daily_closures policies
DROP POLICY IF EXISTS "Users can view daily closures of their family" ON public.daily_closures;
DROP POLICY IF EXISTS "Users can insert daily closures for their family" ON public.daily_closures;

CREATE POLICY "Users can view daily closures of their family"
    ON public.daily_closures
    FOR SELECT
    USING (user_in_family(family_id));

CREATE POLICY "Users can insert daily closures for their family"
    ON public.daily_closures
    FOR INSERT
    WITH CHECK (user_in_family(family_id) AND closed_by = auth.uid());

-- 8. Fix signup trigger to insert new users as ADMIN of their personal family
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  new_family_id UUID;
BEGIN
  -- Create a new personal family for the user
  INSERT INTO public.families (name)
  VALUES (COALESCE(new.raw_user_meta_data->>'full_name', 'Minha Família'))
  RETURNING id INTO new_family_id;

  -- Create the profile with the personal family as active
  INSERT INTO public.profiles (id, family_id, name, email)
  VALUES (
    new.id,
    new_family_id,
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email
  );

  -- Create the family membership
  INSERT INTO public.family_members (family_id, user_id, role)
  VALUES (
    new_family_id,
    new.id,
    'ADMIN'
  );

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

