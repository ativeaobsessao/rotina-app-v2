import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data: profile } = await supabase.from('profiles').select('*').limit(1).single();
  const { data: patient } = await supabase.from('patients').select('*').eq('family_id', profile.family_id).limit(1).single();
  
  console.log("Patient:", patient.id);
  const { data, error } = await supabase
    .from('meal_logs')
    .select('*, creator:profiles!meal_logs_created_by_fkey(name), meal_config:meal_configs(*)')
    .eq('patient_id', patient.id)
    .lt('event_date', '2026-08-14')
    .order('event_date', { ascending: false })
    .order('meal_time', { ascending: false });

  if (error) console.error("Error:", error);
  console.log("Data length:", data?.length);
  console.log("Data:", JSON.stringify(data, null, 2));
}
run();
