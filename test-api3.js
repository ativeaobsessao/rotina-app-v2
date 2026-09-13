import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function run() {
  const { data: anyLog } = await supabase.from('meal_logs').select('patient_id').not('patient_id', 'is', null).limit(1).single();
  const patientId = anyLog.patient_id;
  
  console.log("Patient:", patientId);
  const { data, error } = await supabase
    .from('meal_logs')
    .select('*, creator:profiles!meal_logs_created_by_fkey(name), meal_config:meal_configs(*)')
    .eq('patient_id', patientId)
    .lt('event_date', '2026-08-14')
    .order('event_date', { ascending: false })
    .order('meal_time', { ascending: false });

  if (error) console.error("Error:", error);
  console.log("Data length:", data?.length);
  console.log("Data:", JSON.stringify(data, null, 2));
}
run();
