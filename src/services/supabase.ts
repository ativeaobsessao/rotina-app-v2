import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types';

const metaEnv = (import.meta as any)?.env as Record<string, string | undefined> | undefined;
const procEnv = typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>) : undefined;

const isNodeTestEnv = Boolean(procEnv?.NODE_TEST_CONTEXT || procEnv?.DUCA_TEST === '1');
const supabaseUrl = metaEnv?.VITE_SUPABASE_URL || procEnv?.VITE_SUPABASE_URL || (isNodeTestEnv ? 'https://test.supabase.local' : undefined);
const supabaseKey = metaEnv?.VITE_SUPABASE_ANON_KEY || procEnv?.VITE_SUPABASE_ANON_KEY || (isNodeTestEnv ? 'test-anon-key' : undefined);

if (!supabaseUrl || !supabaseKey) {
  throw new Error('As variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY não foram fornecidas. Configure-as no painel de Environment Variables da Vercel.');
}

// Create a single supabase client for interacting with your database
export const supabase = createClient<Database>(
  supabaseUrl,
  supabaseKey,
  {
    auth: {
      persistSession: true, // This satisfies the persistence requirement
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);
