CREATE POLICY "Users can view their own profile" ON profiles FOR SELECT USING (id = auth.uid());
