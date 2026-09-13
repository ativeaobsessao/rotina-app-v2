// @ts-nocheck
import { supabase } from './src/services/supabase';
import { getHistoricalMealLogs } from './src/services/api';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
  const { data: profile } = await supabase.from('profiles').select('*').limit(1).single();
  const { data: patient } = await supabase.from('patients').select('*').eq('family_id', profile.family_id).limit(1).single();
  
  console.log("Patient:", patient.id);
  const data = await getHistoricalMealLogs(patient.id, '2026-08-14');
  console.log("Data length:", data.length);
  console.log("Data dates:", data.map(d => d.event_date));
}
run();
