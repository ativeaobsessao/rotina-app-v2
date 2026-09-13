const { JSDOM } = require('jsdom');
const fs = require('fs');

const dom = new JSDOM(`<!DOCTYPE html><div id="root"></div>`, {
  url: "http://localhost/",
  runScripts: "dangerously"
});

// Mock environment variables on window
dom.window.import = { meta: { env: { VITE_SUPABASE_URL: 'http://localhost', VITE_SUPABASE_ANON_KEY: 'key' } } };
// Mock globalThis
globalThis.import = dom.window.import;
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;

try {
  require('./dist/app.cjs');
  console.log("App required successfully.");
} catch(e) {
  console.error("Error requiring app:", e);
}
