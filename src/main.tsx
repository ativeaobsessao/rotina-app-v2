import { NetworkProvider } from './contexts/NetworkContext.tsx';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ThemeProvider } from './contexts/ThemeContext.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider><NetworkProvider><App /></NetworkProvider></ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
