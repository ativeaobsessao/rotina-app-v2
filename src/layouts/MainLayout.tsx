import React from 'react';
import { WifiOff, CloudCog, AlertTriangle, RefreshCw, X, Home, Clock, Settings } from 'lucide-react';
import { useNetwork } from '../contexts/NetworkContext';
import { cn } from '../utils/cn';
import { PWAInstallBanner } from '../components/pwa/PWAInstallBanner';

interface MainLayoutProps {
  children: React.ReactNode;
  activeTab?: 'today' | 'history' | 'routine';
  onTabChange?: (tab: 'today' | 'history' | 'routine') => void;
}

export function MainLayout({ children, activeTab = 'today', onTabChange }: MainLayoutProps) {
  const {
    isOnline,
    isSyncing,
    pendingSyncCount,
    failedSyncCount,
    lastSyncError,
    triggerSync,
    dismissFailed,
  } = useNetwork();

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-[#09090b] pb-safe-bottom transition-colors">
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white text-xs font-medium py-1.5 px-4 flex flex-col items-center justify-center text-center shadow-md">
          <div className="flex items-center font-bold mb-0.5">
            <WifiOff className="w-3.5 h-3.5 mr-1.5" />
            Você está Offline
            {pendingSyncCount > 0 && ` • ${pendingSyncCount} ${pendingSyncCount === 1 ? 'registro no dispositivo' : 'registros no dispositivo'}`}
          </div>
          <span className="text-[10px] opacity-90 leading-tight">
            Os registros serão sincronizados automaticamente ao reconectar.
          </span>
        </div>
      )}

      {isOnline && failedSyncCount > 0 && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-rose-600 text-white text-xs py-2 px-4 flex items-center justify-between gap-2 shadow-md">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-bold truncate">
                Falha ao sincronizar {failedSyncCount} {failedSyncCount === 1 ? 'registro' : 'registros'}
              </p>
              {lastSyncError && (
                <p className="text-[10px] opacity-90 truncate">{lastSyncError}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => triggerSync(true)}
              className="px-2.5 py-1 rounded-lg bg-white/20 hover:bg-white/30 font-semibold text-[11px] flex items-center gap-1 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Tentar
            </button>
            <button
              type="button"
              onClick={dismissFailed}
              className="p-1 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              title="Descartar aviso"
              aria-label="Descartar aviso"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {isOnline && failedSyncCount === 0 && isSyncing && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-indigo-600 text-white text-xs font-bold py-1.5 px-4 flex items-center justify-center shadow-sm">
          <CloudCog className="w-3.5 h-3.5 mr-2 animate-pulse" />
          Sincronizando {pendingSyncCount > 0 ? `(${pendingSyncCount})` : '...'}
        </div>
      )}

      {isOnline && failedSyncCount === 0 && !isSyncing && pendingSyncCount > 0 && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-600 text-white text-xs font-medium py-1.5 px-4 flex items-center justify-center gap-3 shadow-sm">
          <span>
            {pendingSyncCount} {pendingSyncCount === 1 ? 'alteração aguardando envio' : 'alterações aguardando envio'}
          </span>
          <button
            type="button"
            onClick={() => triggerSync(false)}
            className="px-2 py-0.5 rounded-md bg-white/20 hover:bg-white/30 font-bold text-[11px] transition-colors"
          >
            Sincronizar agora
          </button>
        </div>
      )}

      <main className="flex-1 pb-20">{children}</main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-[#111115]/95 dark:backdrop-blur-xl border-t border-gray-100 dark:border-white/[0.08] transition-colors pb-safe">
        <div className="flex justify-around items-center h-16 max-w-md mx-auto px-6">
          <button
            onClick={() => onTabChange && onTabChange('today')}
            className={cn(
              'flex flex-col items-center justify-center w-full h-full space-y-1 text-xs font-medium transition-colors',
              activeTab === 'today'
                ? 'text-gray-900 dark:text-zinc-100'
                : 'text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300'
            )}
          >
            <Home className="w-6 h-6" />
            <span>Hoje</span>
          </button>
          <button
            onClick={() => onTabChange && onTabChange('history')}
            className={cn(
              'flex flex-col items-center justify-center w-full h-full space-y-1 text-xs font-medium transition-colors',
              activeTab === 'history'
                ? 'text-gray-900 dark:text-zinc-100'
                : 'text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300'
            )}
          >
            <Clock className="w-6 h-6" />
            <span>Histórico</span>
          </button>
          <button
            onClick={() => onTabChange && onTabChange('routine')}
            className={cn(
              'flex flex-col items-center justify-center w-full h-full space-y-1 text-xs font-medium transition-colors',
              activeTab === 'routine'
                ? 'text-gray-900 dark:text-zinc-100'
                : 'text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300'
            )}
          >
            <Settings className="w-6 h-6" />
            <span>Rotina</span>
          </button>
        </div>
      </nav>

      <PWAInstallBanner />
    </div>
  );
}
