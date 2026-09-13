import React from 'react';
import { renderToString } from 'react-dom/server';

// Mock import.meta.env BEFORE importing App
(globalThis as any).import = { meta: { env: { VITE_SUPABASE_URL: 'http://localhost', VITE_SUPABASE_ANON_KEY: 'key' } } };

import App from './src/App';

try {
  const html = renderToString(<App />);
  console.log('Successfully rendered', html.slice(0, 50));
} catch (e) {
  console.error('Render failed:', e);
}
