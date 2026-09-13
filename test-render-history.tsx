import React from 'react';
import { renderToString } from 'react-dom/server';
import { HistoryScreen } from './src/pages/History';

try {
  const html = renderToString(<HistoryScreen />);
  console.log('Successfully rendered', html.slice(0, 50));
} catch (e) {
  console.error('Render failed:', e);
}
