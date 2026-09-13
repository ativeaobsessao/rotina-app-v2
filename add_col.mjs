import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  // Using rpc or maybe we can't alter table via REST?
  // Anon key won't have ALTER TABLE permissions anyway.
  console.log("We can't alter table via anon key.");
}
run();
