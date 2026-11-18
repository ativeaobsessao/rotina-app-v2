import React from 'react';
import { Coffee, Pill, Stethoscope, Activity as ActivityIcon, CloudOff, AlertCircle } from 'lucide-react';
import { cn } from '../../utils/cn';
import { formatTime, formatDateToTime } from '../../utils/date';
import { getActivityCategoryLabel } from '../../utils/activitySchedule';
import { Badge } from '../ui/Badge';
import type { TimelineEvent } from '../../types/timeline';

export interface TimelineItemProps {
  profileId?: string;
  event: TimelineEvent;
  onClick: () => void;
  key?: React.Key;
}

export function TimelineItem({ event, onClick, profileId }: TimelineItemProps) {
  const isMeal = event.type === 'meal';
  const isActivity = event.type === 'activity';
  const Icon = isMeal
    ? Coffee
    : isActivity
    ? event.activity?.category === 'medical'
      ? Stethoscope
      : ActivityIcon
    : Pill;

  let badgeLabel = 'Aguardando';
  let badgeVariant: 'waiting' | 'pending' | 'confirmed' | 'attention' = 'waiting';
  if (event.status === 'pending') {
    badgeLabel = 'Pendente';
    badgeVariant = 'pending';
  }
  if (event.status === 'confirmed') {
    badgeLabel = 'Confirmado';
    badgeVariant = 'confirmed';
  }
  if (event.status === 'attention') {
    badgeLabel = 'Atenção';
    badgeVariant = 'attention';
  }

  let subLabel = '';
  if (event.type === 'medication_period') {
    const total = event.medications.length;
    const loggedMedIds = new Set(event.logs.map((l) => l.medication_id));
    const loggedCount = loggedMedIds.size;
    const administered = event.logs.filter((l) => l.status === 'administered').length;
    const notAdministered = event.logs.filter((l) => l.status === 'not_administered').length;
    const remaining = Math.max(0, total - loggedCount);

    if (event.status === 'attention') {
      if (remaining === 0) {
        badgeLabel = 'Não administrado';
        badgeVariant = 'attention';
        subLabel = 'Verifique os detalhes';
      } else {
        badgeLabel = `${loggedCount} de ${total} registrados`;
        badgeVariant = 'attention';
        subLabel = remaining === 1 ? 'Falta 1 medicamento' : `Faltam ${remaining} medicamentos`;
      }
    } else if (event.status === 'confirmed') {
      badgeLabel = `${administered} de ${total} confirmados`;
      badgeVariant = 'confirmed';
    } else if (loggedCount > 0 && remaining > 0) {
      if (notAdministered > 0) {
        badgeLabel = `${loggedCount} de ${total} registrados`;
        badgeVariant = 'attention';
      } else {
        badgeLabel = `${administered} de ${total} confirmados`;
        badgeVariant = 'pending';
      }
      subLabel = remaining === 1 ? 'Falta 1 medicamento' : `Faltam ${remaining} medicamentos`;
    } else if (event.status === 'pending') {
      badgeLabel = 'Pendente';
      badgeVariant = 'pending';
      subLabel = total === 1 ? '1 medicamento' : `${total} medicamentos`;
    } else {
      badgeLabel = 'Aguardando';
      badgeVariant = 'waiting';
      subLabel = total === 1 ? '1 medicamento' : `${total} medicamentos`;
    }
  } else if (event.type === 'meal') {
    if (event.status === 'confirmed' && event.log) {
      if (event.log.consumption_status === 'normal') subLabel = 'Comeu normalmente';
      if (event.log.consumption_status === 'partial') subLabel = 'Comeu parcialmente';
      if (event.log.consumption_status === 'none') {
        badgeLabel = 'Não comeu';
        badgeVariant = 'attention';
        subLabel = 'Registrado';
      }
    }
  } else if (event.type === 'activity') {
    const categoryText = getActivityCategoryLabel(event.activity?.category);
    const notesText = event.activity?.notes?.trim();
    subLabel = notesText ? `${categoryText} · ${notesText}` : categoryText;

    if (event.log?.status === 'completed') {
      badgeLabel = 'Realizada';
      badgeVariant = 'confirmed';
    } else if (event.log?.status === 'not_completed') {
      badgeLabel = 'Não realizada';
      badgeVariant = 'attention';
      if (event.log.reason) {
        subLabel = `Motivo: ${event.log.reason}`;
      }
    }
  }

  const isPendingSync =
    event._syncStatus === 'pending' ||
    (event.type === 'meal' && Boolean(event.log?._syncPending)) ||
    (event.type === 'activity' && Boolean(event.log?._syncPending)) ||
    (event.type === 'medication_period' && event.logs.some((l) => Boolean(l?._syncPending)));

  const isFailedSync = event._syncStatus === 'failed';

  const hasMedicationLogs = event.type === 'medication_period' && event.logs.length > 0;
  const hasPartialMedicationLogs =
    event.type === 'medication_period' &&
    event.logs.length > 0 &&
    event.logs.length < event.medications.length;

  return (
    <div className="relative flex items-center justify-between group is-active">
      {/* Icon node */}
      <div
        className={cn(
          'flex items-center justify-center w-10 h-10 rounded-full border-4 border-gray-50 dark:border-[#09090b] bg-white dark:bg-[#18181e] shadow-sm shrink-0 z-10',
          {
            'text-gray-400 dark:text-zinc-500': event.status === 'waiting' && !hasPartialMedicationLogs,
            'text-yellow-500 dark:text-amber-400':
              event.status === 'pending' || (hasPartialMedicationLogs && event.status !== 'attention'),
            'text-green-500 dark:text-emerald-400': event.status === 'confirmed',
            'text-red-500 dark:text-rose-400':
              event.status === 'attention' ||
              (event.type === 'meal' && event.log?.consumption_status === 'none'),
          }
        )}
      >
        <Icon className="w-4 h-4" />
      </div>

      {/* Card */}
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'w-[calc(100%-2.75rem)] rounded-2xl border text-left transition-all active:scale-[0.98] overflow-hidden',
          {
            'bg-white dark:bg-[#121216] border-gray-100 dark:border-white/[0.08] hover:border-gray-200 dark:hover:border-white/[0.15] shadow-sm':
              event.status === 'waiting' && !hasPartialMedicationLogs,
            'bg-yellow-50/50 dark:bg-amber-950/25 border-yellow-100 dark:border-amber-900/40 hover:border-yellow-200 dark:hover:border-amber-800/60':
              event.status === 'pending' || (hasPartialMedicationLogs && event.status !== 'attention'),
            'bg-green-50/30 dark:bg-emerald-950/25 border-green-100 dark:border-emerald-900/40 hover:border-green-200 dark:hover:border-emerald-800/60':
              event.status === 'confirmed',
            'bg-red-50/30 dark:bg-rose-950/25 border-red-100 dark:border-rose-900/40 hover:border-red-200 dark:hover:border-rose-800/60':
              event.status === 'attention',
          }
        )}
      >
        {event.type === 'meal' && event.photoSignedUrl && (
          <div className="w-full aspect-[4/3] bg-gray-100 dark:bg-[#1c1c22] relative">
            <img src={event.photoSignedUrl} alt={event.title} className="w-full h-full object-cover" />
          </div>
        )}
        <div className="p-3.5">
          <div className="flex justify-between items-start gap-2 mb-1">
            <div className="min-w-0">
              {event.type === 'meal' && event.status === 'confirmed' && event.log ? (
                <span className="text-xs font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-1 block">
                  {event.log.meal_time
                    ? `${formatTime(event.log.meal_time)} Refeição realizada`
                    : 'Horário não informado'}
                </span>
              ) : (
                <span className="text-xs font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-1 block">
                  {formatTime(event.time)}
                </span>
              )}
              <h4 className="font-semibold text-gray-900 dark:text-zinc-100">{event.title}</h4>
            </div>
            <Badge variant={badgeVariant} className="whitespace-nowrap shrink-0">
              {badgeLabel}
            </Badge>
          </div>

          {subLabel && <p className="text-sm text-gray-600 dark:text-zinc-300 mt-1">{subLabel}</p>}

          {event.type === 'activity' && event.log?.notes && (
            <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1.5 truncate">
              📝 {event.log.notes}
            </p>
          )}

          {event.type === 'meal' && (event.log?.description || event.log?.drink_description) && (
            <div className="mt-2 space-y-0.5">
              {event.log?.description && (
                <p className="text-sm text-gray-500 dark:text-zinc-400 truncate">
                  🍽️ "{event.log.description}"
                </p>
              )}
              {event.log?.drink_description && (
                <p className="text-xs text-sky-700/80 dark:text-sky-300/90 truncate">
                  🥤 Bebeu: {event.log.drink_description}
                </p>
              )}
            </div>
          )}

          {isFailedSync && (
            <div className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/50 text-[11px] font-medium text-rose-700 dark:text-rose-300">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Falha ao sincronizar{event._syncError ? `: ${event._syncError}` : ''}</span>
            </div>
          )}

          {!isFailedSync && isPendingSync && (
            <div className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200/70 dark:border-amber-800/50 text-[11px] font-medium text-amber-700 dark:text-amber-300">
              <CloudOff className="w-3.5 h-3.5 shrink-0" />
              <span>Salvo no aparelho • Aguardando envio</span>
            </div>
          )}

          {((event.type === 'meal' && Boolean(event.log)) ||
            (event.type === 'activity' && Boolean(event.log)) ||
            hasMedicationLogs) &&
            (() => {
              const latestMedLog =
                event.type === 'medication_period'
                  ? [...event.logs].sort((a, b) =>
                      String(b?.created_at || '').localeCompare(String(a?.created_at || ''))
                    )[0]
                  : null;
              const logCreatorId =
                event.type === 'meal'
                  ? event.log?.created_by
                  : event.type === 'activity'
                  ? event.log?.created_by
                  : latestMedLog?.created_by;
              const logCreatorName =
                event.type === 'meal'
                  ? event.log?.creator?.name || 'Familiar'
                  : event.type === 'activity'
                  ? event.log?.creator?.name || 'Familiar'
                  : latestMedLog?.creator?.name || 'Familiar';
              const logCreatedAt =
                event.type === 'meal'
                  ? event.log?.created_at
                  : event.type === 'activity'
                  ? event.log?.created_at
                  : latestMedLog?.created_at;

              const hasOtherCreators =
                event.type === 'medication_period' &&
                profileId &&
                event.logs.some((l) => l?.created_by && l.created_by !== profileId);

              if (profileId && logCreatorId === profileId && !hasOtherCreators) return null;
              const formattedCreatedTime = logCreatedAt ? formatDateToTime(logCreatedAt) : '';

              return (
                <div className="mt-2.5 pt-2 border-t border-gray-900/5 dark:border-white/[0.07] flex flex-col space-y-0.5">
                  <div className="flex items-center text-xs text-gray-500 dark:text-zinc-400">
                    <span className="mr-1.5 opacity-70">👤</span>
                    <span className="font-medium text-gray-700 dark:text-zinc-300">
                      Registrado por {logCreatorName}
                    </span>
                  </div>
                  {formattedCreatedTime && (
                    <div className="text-[11px] text-gray-400 dark:text-zinc-500 pl-5">
                      Registrado às {formattedCreatedTime}
                    </div>
                  )}
                </div>
              );
            })()}
        </div>
      </button>
    </div>
  );
}
