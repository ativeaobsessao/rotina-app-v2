import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function check() {
  const { data: m1, error: e1 } = await supabase.from('meal_logs').select('*, creator:profiles!meal_logs_created_by_fkey(name), updater:profiles!meal_logs_updated_by_fkey(name)').limit(1);
  console.log('meal_logs error:', e1?.message);
  
  const { data: m2, error: e2 } = await supabase.from('medication_logs').select('*, creator:profiles!medication_logs_created_by_fkey(name), updater:profiles!medication_logs_updated_by_fkey(name)').limit(1);
  console.log('medication_logs error:', e2?.message);
}

check();
