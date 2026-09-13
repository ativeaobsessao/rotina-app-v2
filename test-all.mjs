import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function run() {
  const { data: profs } = await supabase.from('profiles').select('*');
  console.log("Profiles:", profs);
  const { data: meals } = await supabase.from('meal_logs').select('id, event_date, patient_id');
  console.log("Meals:", meals);
}
run();
