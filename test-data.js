import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function run() {
  const email = 'gustavo.hvps@gmail.com';
  
  // get user profile
  const { data: profiles, error } = await supabase.from('profiles').select('*').eq('email', email);
  console.log('Profile:', profiles);
  
  if (profiles && profiles.length > 0) {
    const profile = profiles[0];
    const { data: patient } = await supabase.from('patients').select('*').eq('family_id', profile.family_id).single();
    console.log('Patient:', patient);
    
    if (patient) {
      const date = new Date().toISOString().split('T')[0];
      const { data: events, error: evtErr } = await supabase.from('daily_timeline').select('*').eq('patient_id', patient.id).eq('date', date);
      console.log('Events:', events?.length, evtErr);
      
      const { data: logs } = await supabase.from('medication_logs').select('*').eq('patient_id', patient.id);
      console.log('Med logs:', logs?.length);
    }
  }
}

run();
