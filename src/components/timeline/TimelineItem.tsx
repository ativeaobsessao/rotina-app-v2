import React from 'react';
import { Coffee, Pill } from 'lucide-react';
import { cn } from '../../utils/cn';
import { formatTime, formatDateToTime } from '../../utils/date';
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
  const Icon = isMeal ? Coffee : Pill;

  let badgeLabel = 'Aguardando';
  if (event.status === 'pending') badgeLabel = 'Pendente';
  if (event.status === 'confirmed') badgeLabel = 'Confirmado';
  if (event.status === 'attention') badgeLabel = 'Atenção';

  // For medications, let's refine the label if it's confirmed or attention
  let subLabel = '';
  if (event.type === 'medication_period') {
    const total = event.medications.length;
    const administered = event.logs.filter(l => l.status === 'administered').length;
    if (event.status === 'attention') {
      badgeLabel = 'Não administrado';
      subLabel = 'Verifique os detalhes';
    } else if (event.status === 'confirmed') {
      badgeLabel = `${administered} de ${total} confirmados`;
    } else if (event.status === 'pending') {
      badgeLabel = 'Pendente';
      subLabel = `${total} medicamentos`;
    } else {
       subLabel = `${total} medicamentos`;
    }
  } else if (event.type === 'meal') {
    if (event.status === 'confirmed' && event.log) {
      if (event.log.consumption_status === 'normal') subLabel = 'Comeu normalmente';
      if (event.log.consumption_status === 'partial') subLabel = 'Comeu parcialmente';
      if (event.log.consumption_status === 'none') {
        badgeLabel = 'Não comeu';
        subLabel = 'Registrado';
      }
    }
  }

  return (
    <div className="relative flex items-center justify-between group is-active">
      {/* Icon node */}
      <div className={cn(
        "flex items-center justify-center w-10 h-10 rounded-full border-4 border-gray-50 dark:border-[#09090b] bg-white dark:bg-[#18181e] shadow-sm shrink-0 z-10",
        {
          'text-gray-400 dark:text-zinc-500': event.status === 'waiting',
          'text-yellow-500 dark:text-amber-400': event.status === 'pending',
          'text-green-500 dark:text-emerald-400': event.status === 'confirmed',
          'text-red-500 dark:text-rose-400': event.status === 'attention' || (event.type === 'meal' && event.log?.consumption_status === 'none'),
        }
      )}>
        <Icon className="w-4 h-4" />
      </div>

      {/* Card */}
      <button 
        onClick={onClick}
        className={cn(
          "w-[calc(100%-3rem)] rounded-2xl border text-left transition-all active:scale-[0.98] overflow-hidden",
          {
            'bg-white dark:bg-[#121216] border-gray-100 dark:border-white/[0.08] hover:border-gray-200 dark:hover:border-white/[0.15] shadow-sm': event.status === 'waiting',
            'bg-yellow-50/50 dark:bg-amber-950/25 border-yellow-100 dark:border-amber-900/40 hover:border-yellow-200 dark:hover:border-amber-800/60': event.status === 'pending',
            'bg-green-50/30 dark:bg-emerald-950/25 border-green-100 dark:border-emerald-900/40 hover:border-green-200 dark:hover:border-emerald-800/60': event.status === 'confirmed',
            'bg-red-50/30 dark:bg-rose-950/25 border-red-100 dark:border-rose-900/40 hover:border-red-200 dark:hover:border-rose-800/60': event.status === 'attention',
          }
        )}
      >
        {event.type === 'meal' && event.photoSignedUrl && (
          <div className="w-full aspect-[4/3] bg-gray-100 dark:bg-[#1c1c22] relative">
            <img src={event.photoSignedUrl} alt={event.title} className="w-full h-full object-cover" />
          </div>
        )}
        <div className="p-4">
          <div className="flex justify-between items-start mb-2">
            <div>
              {event.type === 'meal' && event.status === 'confirmed' && event.log ? (
                <span className="text-xs font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-1 block">
                  {event.log.meal_time ? `${formatTime(event.log.meal_time)} Refeição realizada` : 'Horário não informado'}
                </span>
              ) : (
                <span className="text-xs font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-1 block">
                  {formatTime(event.time)}
                </span>
              )}
              <h4 className="font-semibold text-gray-900 dark:text-zinc-100">{event.title}</h4>
            </div>
            <Badge variant={
              event.status === 'confirmed' ? 'confirmed' : 
              event.status === 'pending' ? 'pending' : 
              event.status === 'attention' ? 'attention' : 
              (event.type === 'meal' && event.log?.consumption_status === 'none' ? 'attention' : 'waiting')
            }>
              {badgeLabel}
            </Badge>
          </div>
          
          {subLabel && (
            <p className="text-sm text-gray-600 dark:text-zinc-300 mt-1">{subLabel}</p>
          )}
          
          {event.type === 'meal' && (event.log?.description || event.log?.drink_description) && (
            <div className="mt-2 space-y-0.5">
              {event.log?.description && (
                <p className="text-sm text-gray-500 dark:text-zinc-400 truncate">🍽️ "{event.log.description}"</p>
              )}
              {event.log?.drink_description && (
                <p className="text-xs text-sky-700/80 dark:text-sky-300/90 truncate">🥤 Bebeu: {event.log.drink_description}</p>
              )}
            </div>
          )}
          
          {(event.status === 'confirmed' || event.status === 'attention') && (() => {
            const logCreatorId = event.type === 'meal' ? event.log?.created_by : event.logs?.[0]?.created_by;
            const logCreatorName = event.type === 'meal' ? (event.log?.creator?.name || 'Familiar') : (event.logs?.[0]?.creator?.name || 'Familiar');
            const logCreatedAt = event.type === 'meal' ? event.log?.created_at : event.logs?.[0]?.created_at;
            
            // Do not show if the current user is the one who created it
            if (profileId && logCreatorId === profileId) return null;

            return (
              <div className="mt-4 pt-3 border-t border-gray-900/5 dark:border-white/[0.07] flex flex-col space-y-0.5">
                <div className="flex items-center text-xs text-gray-500 dark:text-zinc-400">
                  <span className="mr-1.5 opacity-70">👤</span>
                  <span className="font-medium text-gray-700 dark:text-zinc-300">Registrado por {logCreatorName}</span>
                </div>
                <div className="text-[11px] text-gray-400 dark:text-zinc-500 pl-5">
                  Registrado às {logCreatedAt ? formatDateToTime(new Date(logCreatedAt)) : ''}
                </div>
              </div>
            );
          })()}
        </div>
      </button>
    </div>
  );
}
