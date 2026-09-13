import { JSDOM } from 'jsdom';
import esbuild from 'esbuild';
import fs from 'fs';

async function run() {
  await esbuild.build({
    entryPoints: ['src/App.tsx'],
    bundle: true,
    outfile: 'dist/app.js',
    format: 'cjs',
    external: ['react', 'react-dom', 'lucide-react', '@supabase/supabase-js'],
    loader: { '.tsx': 'tsx', '.ts': 'ts' }
  });
  console.log("Esbuild finished");
}
run();
