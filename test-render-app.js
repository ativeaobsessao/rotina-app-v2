import { JSDOM } from 'jsdom';
const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="root"></div></body></html>`, { url: 'http://localhost' });
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;

const ViteEnv = { VITE_SUPABASE_URL: 'http://localhost', VITE_SUPABASE_ANON_KEY: 'key' };
global.import = { meta: { env: ViteEnv } };
process.env.VITE_SUPABASE_URL = 'http://localhost';
process.env.VITE_SUPABASE_ANON_KEY = 'key';

import React from 'react';
import { renderToString } from 'react-dom/server';
import App from './src/App.tsx';

try {
  console.log(renderToString(<App />));
} catch(e) {
  console.error(e);
}
