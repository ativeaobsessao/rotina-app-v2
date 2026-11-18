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
    <div className="pt-2.5 border-t border-gray-100 dark:border-white/[0.08]">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {isComplete ? (
            <Sparkles className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
          )}
          <span className="text-xs font-semibold tracking-tight text-gray-700 dark:text-zinc-300 truncate">
            {isComplete ? 'Tudo concluído hoje!' : 'Progresso diário'}
          </span>
        </div>
        <div className="flex items-baseline gap-1 shrink-0">
          <span className="text-xs font-bold tracking-tight text-gray-900 dark:text-white tabular-nums">
            {percentage}%
          </span>
          <span className="text-[11px] font-medium text-gray-400 dark:text-zinc-500 tabular-nums">
            ({completed}/{total})
          </span>
        </div>
      </div>

      {/* Progress Track */}
      <div className="relative h-2 w-full bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${
            isComplete
              ? 'bg-gradient-to-r from-emerald-500 to-teal-400 shadow-sm shadow-emerald-500/30'
              : 'bg-gradient-to-r from-indigo-500 via-indigo-600 to-violet-500 shadow-sm shadow-indigo-500/20'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Pending / Encouragement microcopy */}
      <p className="mt-1 text-[11px] text-gray-500 dark:text-zinc-400 leading-tight truncate">
        {isComplete
          ? 'Todos os cuidados de hoje foram registrados com carinho ✨'
          : completed === 0
          ? 'Inicie os registros do dia'
          : total - completed === 1
          ? 'Falta 1 item na rotina'
          : `Faltam ${total - completed} itens na rotina`}
      </p>
    </div>
  );
}
