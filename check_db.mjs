import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function run() {
  const { data: mLogs } = await supabase.from('meal_logs').select('*');
  console.log("Meal Logs:");
  console.log(mLogs);
  const { data: medLogs } = await supabase.from('medication_logs').select('*');
  console.log("Med Logs:");
  console.log(medLogs);
}
run();
