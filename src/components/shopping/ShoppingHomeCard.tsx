import React from 'react';
import { ShoppingBag, AlertTriangle, Plus, ChevronRight } from 'lucide-react';
import type { ShoppingItemRecord } from '../../utils/shopping';

interface ShoppingHomeCardProps {
  items: ShoppingItemRecord[];
  canEdit: boolean;
  onOpenList: () => void;
  onQuickAdd: () => void;
}

export function ShoppingHomeCard({
  items,
  canEdit,
  onOpenList,
  onQuickAdd,
}: ShoppingHomeCardProps) {
  const pendingCount = items.length;
  const urgentItems = items.filter((item) => item.is_urgent);
  const urgentCount = urgentItems.length;

  const previewItems = urgentCount > 0 ? urgentItems : items;
  const previewNames = previewItems
    .slice(0, 2)
    .map((item) => (item.quantity ? `${item.name} (${item.quantity})` : item.name))
    .join(' · ');
  const remainingPreviewCount = Math.max(0, previewItems.length - 2);

  return (
    <div
      role="region"
      aria-label="Lista de compras"
      className={`rounded-xl border transition-colors flex items-center gap-2 px-3 py-2 ${
        urgentCount > 0
          ? 'bg-rose-50/90 dark:bg-rose-950/35 border-rose-200/80 dark:border-rose-800/50'
          : 'bg-gray-50/90 dark:bg-white/[0.04] border-gray-200/75 dark:border-white/[0.08]'
      }`}
    >
      <button
        type="button"
        onClick={onOpenList}
        className="flex-1 min-w-0 min-h-[40px] flex items-center gap-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg"
      >
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
            urgentCount > 0
              ? 'bg-rose-100 dark:bg-rose-900/60 text-rose-600 dark:text-rose-300'
              : pendingCount > 0
              ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300'
              : 'bg-white dark:bg-[#1c1c22] text-gray-500 dark:text-zinc-400 border border-gray-200/60 dark:border-white/[0.08]'
          }`}
        >
          {urgentCount > 0 ? (
            <AlertTriangle className="w-4 h-4" />
          ) : (
            <ShoppingBag className="w-4 h-4" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={`text-xs font-bold leading-tight truncate ${
                urgentCount > 0
                  ? 'text-rose-800 dark:text-rose-200'
                  : 'text-gray-900 dark:text-zinc-100'
              }`}
            >
              {urgentCount > 0
                ? urgentCount === 1
                  ? 'Compra urgente'
                  : `${urgentCount} compras urgentes`
                : 'Lista de compras'}
            </span>
            <span className="text-[11px] font-medium text-gray-500 dark:text-zinc-400 tabular-nums shrink-0">
              ·{' '}
              {pendingCount === 0
                ? 'Tudo em dia'
                : `${pendingCount} ${pendingCount === 1 ? 'item' : 'itens'}`}
            </span>
          </div>

          {pendingCount > 0 && (
            <p
              className={`text-[11px] truncate mt-0.5 leading-tight ${
                urgentCount > 0
                  ? 'text-rose-700/90 dark:text-rose-300/90 font-medium'
                  : 'text-gray-500 dark:text-zinc-400'
              }`}
            >
              {previewNames}
              {remainingPreviewCount > 0 ? ` +${remainingPreviewCount}` : ''}
            </p>
          )}
        </div>

        <ChevronRight className="w-4 h-4 text-gray-400 dark:text-zinc-500 shrink-0" />
      </button>

      {canEdit && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onQuickAdd();
          }}
          aria-label="Adicionar item na lista de compras"
          title="Adicionar item"
          className={`min-w-[40px] min-h-[40px] px-2.5 rounded-lg inline-flex items-center justify-center gap-1 text-xs font-semibold transition-all active:scale-95 shrink-0 whitespace-nowrap ${
            urgentCount > 0
              ? 'bg-rose-600 hover:bg-rose-700 text-white'
              : 'bg-white dark:bg-[#1c1c22] hover:bg-gray-100 dark:hover:bg-[#26262f] text-indigo-600 dark:text-indigo-300 border border-gray-200/80 dark:border-white/[0.1]'
          }`}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Item</span>
        </button>
      )}
    </div>
  );
}
