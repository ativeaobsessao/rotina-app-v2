import React from 'react';
import { CheckCircle2, Sparkles } from 'lucide-react';

interface DailyProgressBarProps {
  total: number;
  completed: number;
}

export function DailyProgressBar({ total, completed }: DailyProgressBarProps) {
  if (total === 0) return null;

  const percentage = Math.min(100, Math.round((completed / total) * 100));
  const isComplete = percentage === 100;

  return (
    <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-800/80">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-1.5">
          {isComplete ? (
            <Sparkles className="w-4 h-4 text-emerald-500 animate-bounce" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          )}
          <span className="text-xs font-semibold tracking-tight text-gray-700 dark:text-gray-300">
            {isComplete ? 'Tudo concluído hoje!' : 'Progresso diário'}
          </span>
        </div>
        <div className="flex items-baseline space-x-1">
          <span className="text-sm font-bold tracking-tight text-gray-900 dark:text-white tabular-nums">
            {percentage}%
          </span>
          <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500">
            ({completed}/{total})
          </span>
        </div>
      </div>

      {/* Progress Track */}
      <div className="relative h-2 w-full bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${
            isComplete
              ? 'bg-gradient-to-r from-emerald-500 to-teal-400 shadow-sm shadow-emerald-500/30'
              : 'bg-gradient-to-r from-indigo-500 via-indigo-600 to-violet-500 shadow-sm shadow-indigo-500/20'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Encouragement microcopy */}
      <div className="mt-1.5 flex justify-between items-center text-[11px] text-gray-400 dark:text-gray-500">
        <span>
          {isComplete
            ? 'Todos os cuidados de hoje foram registrados com carinho ✨'
            : completed === 0
            ? 'Inicie os registros do dia'
            : `Faltam ${total - completed} ${total - completed === 1 ? 'item' : 'itens'} na rotina`}
        </span>
      </div>
    </div>
  );
}
