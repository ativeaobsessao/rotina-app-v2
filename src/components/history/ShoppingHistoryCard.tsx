import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  ShoppingBag,
  Trash2,
} from 'lucide-react';
import { formatDateToTime, formatFriendlyDate } from '../../utils/date';
import { formatPriceBRL, type ShoppingItemRecord } from '../../utils/shopping';

interface ShoppingHistoryCardProps {
  key?: React.Key;
  dateStr: string;
  items: ShoppingItemRecord[];
  canEdit: boolean;
  defaultExpanded?: boolean;
  onSelectItem: (item: ShoppingItemRecord) => void;
  onRequestRevert: (item: ShoppingItemRecord) => void;
  onRequestDelete: (item: ShoppingItemRecord) => void;
}

export function ShoppingHistoryCard({
  dateStr,
  items,
  canEdit,
  defaultExpanded = false,
  onSelectItem,
  onRequestRevert,
  onRequestDelete,
}: ShoppingHistoryCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [defaultExpanded]);

  const friendly = formatFriendlyDate(dateStr);

  const pricedItems = items.filter((item) => typeof item.price_cents === 'number');
  const totalDayCents = pricedItems.reduce((acc, item) => acc + (item.price_cents || 0), 0);
  const urgentCount = items.filter((item) => item.is_urgent).length;
  const previewNames = items
    .slice(0, 3)
    .map((item) => item.name)
    .join(', ');
  const remainingCount = Math.max(0, items.length - 3);

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex flex-col p-4 bg-emerald-50/55 dark:bg-emerald-950/20 rounded-2xl border border-emerald-200/80 dark:border-emerald-800/45 shadow-sm hover:border-emerald-300 dark:hover:border-emerald-700/60 transition-all active:scale-[0.995]"
      >
        <div className="w-full flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <div className="text-left min-w-0">
              <span className="block font-semibold text-gray-900 dark:text-zinc-100 text-sm truncate">
                Lista de Compras · {friendly}
              </span>
              <span className="block text-[11px] text-emerald-800/80 dark:text-emerald-300/80 tabular-nums mt-0.5">
                {items.length} {items.length === 1 ? 'item comprado' : 'itens comprados'}
                {urgentCount > 0 ? ` · ${urgentCount} urgente${urgentCount > 1 ? 's' : ''}` : ''}
                {pricedItems.length > 0 ? ` · ${formatPriceBRL(totalDayCents)}` : ''}
              </span>
            </div>
          </div>

          {expanded ? (
            <ChevronUp className="w-4 h-4 text-emerald-700/70 dark:text-emerald-300/70 shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-emerald-700/70 dark:text-emerald-300/70 shrink-0" />
          )}
        </div>

        {!expanded && previewNames && (
          <p className="mt-2 pl-[38px] text-left text-xs text-gray-600 dark:text-zinc-300 line-clamp-1">
            {previewNames}
            {remainingCount > 0 ? ` +${remainingCount}` : ''}
          </p>
        )}
      </button>

      {expanded && (
        <div className="mt-2 bg-gray-50/85 dark:bg-[#0e0e12] rounded-2xl border border-emerald-100 dark:border-emerald-900/35 p-3.5 space-y-2.5">
          {items.map((item) => {
            const requesterName = item.requester?.name || 'Familiar';
            const purchaserName = item.purchaser?.name || 'Familiar';

            return (
              <div
                key={item.id}
                className="bg-white dark:bg-[#121216] rounded-2xl border border-gray-100 dark:border-white/[0.08] p-3.5 shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => onSelectItem(item)}
                  className="w-full text-left focus:outline-none"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {item.is_urgent && (
                        <div className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300 mb-0.5">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span>Era urgente</span>
                        </div>
                      )}
                      <h4 className="font-semibold text-sm text-gray-900 dark:text-zinc-100 break-words">
                        {item.name}
                      </h4>
                      {(item.quantity || item.notes) && (
                        <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
                          {[item.quantity, item.notes].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>

                    <span
                      className={`text-sm font-bold tabular-nums shrink-0 ${
                        typeof item.price_cents === 'number'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-gray-400 dark:text-zinc-500 font-medium text-xs'
                      }`}
                    >
                      {formatPriceBRL(item.price_cents)}
                    </span>
                  </div>

                  <p className="text-[11px] text-gray-500 dark:text-zinc-400 mt-2 pt-2 border-t border-gray-50 dark:border-white/[0.06]">
                    Pedido por {requesterName} · Comprado por{' '}
                    <span className="font-medium text-gray-700 dark:text-zinc-300">
                      {purchaserName}
                    </span>
                    {item.purchased_at ? ` às ${formatDateToTime(item.purchased_at)}` : ''}
                  </p>
                </button>

                {canEdit && (
                  <div className="flex items-center gap-2 mt-2.5 pt-2 border-t border-gray-50 dark:border-white/[0.06]">
                    <button
                      type="button"
                      onClick={() => onSelectItem(item)}
                      className="flex-1 min-h-[40px] px-3 rounded-xl bg-gray-100 dark:bg-[#1c1c22] hover:bg-gray-200 dark:hover:bg-[#26262f] text-xs font-semibold text-gray-700 dark:text-zinc-200 transition-colors"
                    >
                      {typeof item.price_cents === 'number' ? 'Editar compra' : 'Informar valor / editar'}
                    </button>

                    <button
                      type="button"
                      onClick={() => onRequestRevert(item)}
                      title="Voltar para a Lista de Compras"
                      aria-label={`Voltar ${item.name} para a Lista de Compras`}
                      className="min-h-[40px] px-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-xs font-semibold text-indigo-700 dark:text-indigo-300 inline-flex items-center gap-1 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Voltar</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onRequestDelete(item)}
                      title="Apagar definitivamente"
                      aria-label={`Apagar ${item.name}`}
                      className="min-w-[40px] min-h-[40px] px-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 inline-flex items-center justify-center transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
