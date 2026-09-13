import { WifiOff, CloudCog } from 'lucide-react';
import { useNetwork } from '../contexts/NetworkContext';
import React from 'react';
import { Home, Clock, Settings } from 'lucide-react';
import { cn } from '../utils/cn';

interface MainLayoutProps {
  children: React.ReactNode;
  activeTab?: 'today' | 'history' | 'routine';
  onTabChange?: (tab: 'today' | 'history' | 'routine') => void;
}

export function MainLayout({ children, activeTab = 'today', onTabChange }: MainLayoutProps) {
  const { isOnline, pendingSyncCount } = useNetwork();
  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-gray-950 pb-safe-bottom transition-colors">
      
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white text-xs font-bold py-1 px-4 flex items-center justify-center">
          <WifiOff className="w-3 h-3 mr-2" />
          Modo Offline
        </div>
      )}
      {isOnline && pendingSyncCount > 0 && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-indigo-500 text-white text-xs font-bold py-1 px-4 flex items-center justify-center">
          <CloudCog className="w-3 h-3 mr-2 animate-pulse" />
          Sincronizando...
        </div>
      )}

      <main className="flex-1 pb-20">
        {children}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 transition-colors pb-safe">
        <div className="flex justify-around items-center h-16 max-w-md mx-auto px-6">
          <button 
            onClick={() => onTabChange && onTabChange('today')}
            className={cn("flex flex-col items-center justify-center w-full h-full space-y-1 text-xs font-medium transition-colors", activeTab === 'today' ? "text-gray-900 dark:text-gray-100" : "text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300")}
          >
            <Home className="w-6 h-6" />
            <span>Hoje</span>
          </button>
          <button 
            onClick={() => onTabChange && onTabChange('history')}
            className={cn("flex flex-col items-center justify-center w-full h-full space-y-1 text-xs font-medium transition-colors", activeTab === 'history' ? "text-gray-900 dark:text-gray-100" : "text-gray-400 hover:text-gray-600")}
          >
            <Clock className="w-6 h-6" />
            <span>Histórico</span>
          </button>
          <button 
            onClick={() => onTabChange && onTabChange('routine')}
            className={cn("flex flex-col items-center justify-center w-full h-full space-y-1 text-xs font-medium transition-colors", activeTab === 'routine' ? "text-gray-900 dark:text-gray-100" : "text-gray-400 hover:text-gray-600")}
          >
            <Settings className="w-6 h-6" />
            <span>Rotina</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
