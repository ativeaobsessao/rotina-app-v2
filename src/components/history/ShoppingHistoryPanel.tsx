import React from 'react';
import {
  ChevronDown,
  ChevronUp,
  FileDown,
  Search,
  ShoppingBag,
  X,
} from 'lucide-react';
import { getLocalDateString, shiftDateString } from '../../utils/date';
import {
  formatPriceBRL,
  getMonthKeyFromDate,
  getMonthStartDate,
  getPreviousMonthRange,
  type ShoppingExpensesSummary,
} from '../../utils/shopping';

interface ShoppingHistoryPanelProps {
  expanded: boolean;
  onToggleExpanded: () => void;
  summary: ShoppingExpensesSummary;
  searchQuery: string;
  onSearchQueryChange: (val: string) => void;
  startDate: string;
  endDate: string;
  onDateRangeChange: (start: string, end: string) => void;
  urgentOnly: boolean;
  onUrgentOnlyChange: (val: boolean) => void;
  onOpenPdfModal: () => void;
}

export function ShoppingHistoryPanel({
  expanded,
  onToggleExpanded,
  summary,
  searchQuery,
  onSearchQueryChange,
  startDate,
  endDate,
  onDateRangeChange,
  urgentOnly,
  onUrgentOnlyChange,
  onOpenPdfModal,
}: ShoppingHistoryPanelProps) {
  const todayStr = getLocalDateString();
  const currentMonthStart = getMonthStartDate(todayStr);
  const prevMonthRange = getPreviousMonthRange(todayStr);
  const threeMonthsStart = shiftDateString(todayStr, -90);
  const sixMonthsStart = shiftDateString(todayStr, -180);

  const hasActiveQuery = Boolean(
    searchQuery.trim() || startDate || endDate || urgentOnly
  );

  return (
    <div className="mx-6 mt-2 mb-1 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-800/45 overflow-hidden">
      <div className="p-3.5 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onToggleExpanded}
          className="flex-1 min-w-0 flex items-center gap-2.5 text-left focus:outline-none"
        >
          <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
            <ShoppingBag className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-gray-900 dark:text-zinc-100">
                Compras e Gastos
              </span>
              {expanded ? (
                <ChevronUp className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-300 shrink-0" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-300 shrink-0" />
              )}
            </div>
            <p className="text-[11px] text-gray-600 dark:text-zinc-300 tabular-nums truncate mt-0.5">
              Mês: <strong className="text-gray-900 dark:text-zinc-100">{formatPriceBRL(summary.currentMonthCents)}</strong>
              {' · '}
              6 meses: <strong className="text-gray-900 dark:text-zinc-100">{formatPriceBRL(summary.semesterCents)}</strong>
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={onOpenPdfModal}
          className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white dark:bg-[#1c1c22] border border-emerald-200 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 transition-colors"
        >
          <FileDown className="w-3.5 h-3.5" />
          <span>PDF Compras</span>
        </button>
      </div>

      {expanded && (
        <div className="px-3.5 pb-3.5 pt-1 border-t border-emerald-200/60 dark:border-emerald-800/40 space-y-3">
          {/* Busca própria da Lista de Compras */}
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 dark:text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              enterKeyHint="search"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder="Pesquisar item, marca, quem pediu ou comprou..."
              className="w-full h-11 pl-9 pr-9 rounded-xl bg-white dark:bg-[#1c1c22] border border-gray-200 dark:border-white/[0.1] text-sm text-gray-900 dark:text-zinc-100 placeholder:text-gray-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchQueryChange('')}
                aria-label="Limpar busca de compras"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-gray-400 hover:text-gray-600 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Atalhos de consulta mensal / semestral */}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onDateRangeChange(currentMonthStart, todayStr)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                startDate === currentMonthStart && endDate === todayStr
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white dark:bg-[#1c1c22] text-gray-700 dark:text-zinc-300 border border-gray-200/80 dark:border-white/[0.08]'
              }`}
            >
              Este mês
            </button>
            <button
              type="button"
              onClick={() => onDateRangeChange(prevMonthRange.startDate, prevMonthRange.endDate)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                startDate === prevMonthRange.startDate && endDate === prevMonthRange.endDate
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white dark:bg-[#1c1c22] text-gray-700 dark:text-zinc-300 border border-gray-200/80 dark:border-white/[0.08]'
              }`}
            >
              Mês passado
            </button>
            <button
              type="button"
              onClick={() => onDateRangeChange(threeMonthsStart, todayStr)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                startDate === threeMonthsStart && endDate === todayStr
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white dark:bg-[#1c1c22] text-gray-700 dark:text-zinc-300 border border-gray-200/80 dark:border-white/[0.08]'
              }`}
            >
              3 meses
            </button>
            <button
              type="button"
              onClick={() => onDateRangeChange(sixMonthsStart, todayStr)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                startDate === sixMonthsStart && endDate === todayStr
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white dark:bg-[#1c1c22] text-gray-700 dark:text-zinc-300 border border-gray-200/80 dark:border-white/[0.08]'
              }`}
            >
              6 meses
            </button>
            <button
              type="button"
              onClick={() => onUrgentOnlyChange(!urgentOnly)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                urgentOnly
                  ? 'bg-rose-600 text-white'
                  : 'bg-white dark:bg-[#1c1c22] text-gray-700 dark:text-zinc-300 border border-gray-200/80 dark:border-white/[0.08]'
              }`}
            >
              Só urgentes
            </button>
          </div>

          {/* Intervalo personalizado */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => onDateRangeChange(e.target.value, endDate)}
              className="flex-1 min-w-0 bg-white dark:bg-[#1c1c22] border border-gray-200 dark:border-white/[0.1] text-gray-700 dark:text-zinc-200 text-xs rounded-xl px-2.5 py-2 outline-none"
              title="Data inicial da consulta de compras"
            />
            <span className="text-xs text-gray-400 dark:text-zinc-500">até</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => onDateRangeChange(startDate, e.target.value)}
              className="flex-1 min-w-0 bg-white dark:bg-[#1c1c22] border border-gray-200 dark:border-white/[0.1] text-gray-700 dark:text-zinc-200 text-xs rounded-xl px-2.5 py-2 outline-none"
              title="Data final da consulta de compras"
            />
            {hasActiveQuery && (
              <button
                type="button"
                onClick={() => {
                  onSearchQueryChange('');
                  onDateRangeChange('', '');
                  onUrgentOnlyChange(false);
                }}
                className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 px-2 py-2 shrink-0"
              >
                Limpar
              </button>
            )}
          </div>

          {/* Resumo financeiro do filtro + comparativo mês a mês */}
          <div className="rounded-xl bg-white dark:bg-[#121216] border border-emerald-100 dark:border-white/[0.08] p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500 dark:text-zinc-400">
                Resultado da consulta ({summary.itemCount}{' '}
                {summary.itemCount === 1 ? 'item' : 'itens'})
              </span>
              <span className="font-bold text-sm text-emerald-700 dark:text-emerald-400 tabular-nums">
                {formatPriceBRL(summary.totalCents)}
              </span>
            </div>

            {summary.unpricedCount > 0 && (
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                {summary.unpricedCount}{' '}
                {summary.unpricedCount === 1 ? 'item ainda está sem valor' : 'itens ainda estão sem valor'} — toque no item para preencher.
              </p>
            )}

            {summary.monthlyBreakdown.length > 0 && (
              <div className="pt-2 border-t border-gray-100 dark:border-white/[0.06] flex flex-wrap gap-x-3 gap-y-1">
                {summary.monthlyBreakdown.slice(0, 6).map((m) => {
                  const mStart = `${m.monthKey}-01`;
                  const [yStr, mStr] = m.monthKey.split('-');
                  const lastDay = new Date(Date.UTC(Number(yStr), Number(mStr), 0)).getUTCDate();
                  const mEnd =
                    m.monthKey === getMonthKeyFromDate(todayStr)
                      ? todayStr
                      : `${m.monthKey}-${String(lastDay).padStart(2, '0')}`;

                  return (
                    <button
                      key={m.monthKey}
                      type="button"
                      onClick={() => onDateRangeChange(mStart, mEnd)}
                      className="text-[11px] text-gray-600 dark:text-zinc-300 hover:text-emerald-700 dark:hover:text-emerald-300 tabular-nums underline-offset-2 hover:underline"
                    >
                      {m.label}: <strong>{formatPriceBRL(m.totalCents)}</strong> ({m.itemCount})
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <p className="text-[11px] text-gray-500 dark:text-zinc-400 leading-snug">
            Compras concluídas são mantidas por 6 meses para controle de gastos e apagadas automaticamente depois desse prazo.
          </p>
        </div>
      )}
    </div>
  );
}
