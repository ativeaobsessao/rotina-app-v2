import React from 'react';

interface LaunchIntroProps {
  message?: string;
}

export function LaunchIntro({ message }: LaunchIntroProps) {
  return (
    <div
      role="status"
      aria-label="Iniciando DUCA"
      className="flex min-h-[100dvh] w-full flex-col items-center justify-center bg-gray-50 dark:bg-[#09090b] px-6 transition-colors"
    >
      <div className="flex flex-col items-center gap-3 animate-in fade-in zoom-in-95 duration-150">
        <div className="w-16 h-16 rounded-[1.35rem] bg-white dark:bg-[#141418] border border-gray-200/80 dark:border-white/[0.08] shadow-sm flex items-center justify-center overflow-hidden">
          <img
            src="/web-app-manifest-192x192.png"
            alt="DUCA"
            className="w-11 h-11 rounded-xl object-contain"
          />
        </div>
        <span className="text-xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">
          DUCA
        </span>
        {message && (
          <p className="text-xs font-medium text-gray-500 dark:text-zinc-400">{message}</p>
        )}
      </div>
    </div>
  );
}
