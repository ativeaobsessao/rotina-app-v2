import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function run() {
  const { data, error } = await supabase
    .from('daily_closures')
    .select('*, closed_by_profile:profiles!daily_closures_closed_by_fkey(name)')
    .limit(1);
    
  if (error) {
    console.error("Error 1:", error.message);
    
    // Try without explicit fkey
    const { data: d2, error: e2 } = await supabase
      .from('daily_closures')
      .select('*, profiles(name)')
      .limit(1);
    console.log("Error 2:", e2?.message, "Data 2:", d2);
  } else {
    console.log("Success:", data);
  }
}
run();
