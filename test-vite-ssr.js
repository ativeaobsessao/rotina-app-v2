import { createServer } from 'vite';
import { fileURLToPath } from 'url';

async function run() {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
  });
  
  try {
    const { renderToString } = await vite.ssrLoadModule('react-dom/server');
    const React = await vite.ssrLoadModule('react');
    const { HistoryScreen } = await vite.ssrLoadModule('/src/pages/History.tsx');
    const { App } = await vite.ssrLoadModule('/src/App.tsx');
    
    // We can't render App because BrowserRouter needs window, but we can try HistoryScreen
    // Wait, HistoryScreen has useEffect which doesn't run in renderToString.
    
    console.log("Successfully loaded modules");
  } catch (e) {
    console.error(e);
  } finally {
    await vite.close();
  }
}
run();
