import React from 'react';
import { Home, Clock, Settings } from 'lucide-react';
import { cn } from '../utils/cn';

interface MainLayoutProps {
  children: React.ReactNode;
  activeTab?: 'today' | 'history' | 'routine';
  onTabChange?: (tab: 'today' | 'history' | 'routine') => void;
}

export function MainLayout({ children, activeTab = 'today', onTabChange }: MainLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50 pb-safe-bottom">
      <main className="flex-1 pb-20">
        {children}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-100 pb-safe">
        <div className="flex justify-around items-center h-16 max-w-md mx-auto px-6">
          <button 
            onClick={() => onTabChange && onTabChange('today')}
            className={cn("flex flex-col items-center justify-center w-full h-full space-y-1 text-xs font-medium transition-colors", activeTab === 'today' ? "text-gray-900" : "text-gray-400 hover:text-gray-600")}
          >
            <Home className="w-6 h-6" />
            <span>Hoje</span>
          </button>
          <button 
            onClick={() => onTabChange && onTabChange('history')}
            className={cn("flex flex-col items-center justify-center w-full h-full space-y-1 text-xs font-medium transition-colors", activeTab === 'history' ? "text-gray-900" : "text-gray-400 hover:text-gray-600")}
          >
            <Clock className="w-6 h-6" />
            <span>Histórico</span>
          </button>
          <button 
            onClick={() => onTabChange && onTabChange('routine')}
            className={cn("flex flex-col items-center justify-center w-full h-full space-y-1 text-xs font-medium transition-colors", activeTab === 'routine' ? "text-gray-900" : "text-gray-400 hover:text-gray-600")}
          >
            <Settings className="w-6 h-6" />
            <span>Rotina</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
