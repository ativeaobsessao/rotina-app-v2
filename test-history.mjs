import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function run() {
  const { data: profs } = await supabase.from('profiles').select('family_id, id');
  if (!profs || profs.length === 0) return console.log("No profiles");
  
  const familyId = profs[0].family_id;
  const { data: patients } = await supabase.from('patients').select('id').eq('family_id', familyId);
  if (!patients || patients.length === 0) return console.log("No patients");
  
  const patientId = patients[0].id;
  
  const { data: meals, error } = await supabase
    .from('meal_logs')
    .select('event_date, patient_id')
    .eq('patient_id', patientId)
    .lt('event_date', '2026-08-15');
    
  console.log("Historical Meals:", meals?.length, "error:", error);
  
  const { data: allMeals } = await supabase
    .from('meal_logs')
    .select('event_date, patient_id')
    .eq('patient_id', patientId);
    
  console.log("All Meals:", allMeals);
}
run();
