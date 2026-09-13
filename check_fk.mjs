import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function run() {
  const { data, error } = await supabase
    .from('medication_logs')
    .select('*, creator:profiles!medication_logs_created_by_fkey(name)')
    .limit(1);

  if (error) {
    console.error("Error with FK:", error);
  } else {
    console.log("Success with FK!", data);
  }
}
run();
