const fs = require('fs');
let code = fs.readFileSync('src/services/api.ts', 'utf8');

code = code.replace(
  `export async function getFamilyMembers(familyId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('family_members')
    .select('*, profile:profiles!family_members_user_id_fkey(name, email, avatar_url)')
    .eq('family_id', familyId);
  if (error) throw error;
  return data || [];
}`,
  `export async function getFamilyMembers(familyId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('family_members')
    .select('*')
    .eq('family_id', familyId);
  if (error) throw error;

  if (data && data.length > 0) {
    const userIds = data.map(m => m.user_id);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, name, email, avatar_url')
      .in('id', userIds);
      
    if (profiles) {
      return data.map(m => ({
        ...m,
        profile: profiles.find(p => p.id === m.user_id)
      }));
    }
  }

  return data || [];
}`
);

code = code.replace(
  `export async function getFamilyInvites(familyId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('family_invites')
    .select('*, creator:profiles!family_invites_created_by_fkey(name)')
    .eq('family_id', familyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}`,
  `export async function getFamilyInvites(familyId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('family_invites')
    .select('*')
    .eq('family_id', familyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}`
);

fs.writeFileSync('src/services/api.ts', code);
