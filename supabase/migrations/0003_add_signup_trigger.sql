-- Trigger to automatically create a family and profile when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  new_family_id UUID;
BEGIN
  -- Create a new family for the user
  INSERT INTO public.families (name)
  VALUES (COALESCE(new.raw_user_meta_data->>'full_name', 'Minha Família'))
  RETURNING id INTO new_family_id;

  -- Create the profile
  INSERT INTO public.profiles (id, family_id, name, email)
  VALUES (
    new.id,
    new_family_id,
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email
  );
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
