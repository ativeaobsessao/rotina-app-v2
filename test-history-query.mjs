import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function run() {
  const { data: logs } = await supabase.from('meal_logs').select('*');
  console.log("All meal logs:");
  console.log(logs);
}
run();
