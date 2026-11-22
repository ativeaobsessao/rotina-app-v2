import React, { useEffect, useState } from 'react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';
import { cn } from '../../utils/cn';
import { dismissMobileKeyboard, handleEnterKeySubmit } from '../../utils/keyboardSubmit';
import { createActivity, updateActivity } from '../../services/api';
import { DEFAULT_TIMEZONE, getLocalDateString, shiftDateString } from '../../utils/date';
import {
  WEEKDAY_OPTIONS,
  diffDaysBetweenDates,
  formatActivityDaysSummary,
  formatDaysUntilLabel,
  getActivityWeekdays,
  sortWeekdays,
  type WeekdayKey,
} from '../../utils/activitySchedule';
import type { ActivityCategory, ActivityScheduleType } from '../../types/database.types';

interface ActivityFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  profileId: string;
  activity?: any | null;
  defaultScheduleType?: ActivityScheduleType;
  defaultDate?: string;
  onSuccess: () => void;
}

export function ActivityFormModal({
  isOpen,
  onClose,
  patientId,
  profileId,
  activity,
  defaultScheduleType = 'one_time',
  defaultDate,
  onSuccess,
}: ActivityFormModalProps) {
  const todayStr = getLocalDateString(DEFAULT_TIMEZONE);
  const tomorrowStr = shiftDateString(todayStr, 1);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<ActivityCategory>('medical');
  const [scheduleType, setScheduleType] = useState<ActivityScheduleType>('one_time');
  const [scheduledDate, setScheduledDate] = useState(defaultDate || todayStr);
  const [selectedWeekdays, setSelectedWeekdays] = useState<WeekdayKey[]>(['Monday', 'Wednesday']);
  const [scheduledTime, setScheduledTime] = useState('09:00');
  const [notes, setNotes] = useState('');
  const [active, setActive] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    const currentToday = getLocalDateString(DEFAULT_TIMEZONE);
    if (activity) {
      setTitle(activity.title || '');
      setCategory(activity.category === 'wellness' ? 'wellness' : 'medical');
      const isWeekly = activity.schedule_type === 'weekly';
      setScheduleType(isWeekly ? 'weekly' : 'one_time');
      setScheduledDate(activity.scheduled_date || defaultDate || currentToday);
      const resolvedDays = getActivityWeekdays(activity);
      setSelectedWeekdays(resolvedDays.length > 0 ? resolvedDays : ['Monday', 'Wednesday']);
      setScheduledTime((activity.scheduled_time || '09:00').slice(0, 5));
      setNotes(activity.notes || '');
      setActive(activity.active ?? true);
    } else {
      setTitle('');
      setCategory('medical');
      setScheduleType(defaultScheduleType);
      setScheduledDate(defaultDate || currentToday);
      setSelectedWeekdays(['Monday', 'Wednesday']);
      setScheduledTime('09:00');
      setNotes('');
      setActive(true);
    }
    setError('');
  }, [isOpen, activity, defaultScheduleType, defaultDate]);

  const handleToggleWeekday = (day: WeekdayKey) => {
    setError('');
    setSelectedWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : sortWeekdays([...prev, day])
    );
  };

  const handleScheduleTypeChange = (next: ActivityScheduleType) => {
    setError('');
    setScheduleType(next);
    if (next === 'weekly' && selectedWeekdays.length === 0) {
      setSelectedWeekdays(['Monday', 'Wednesday']);
    }
    if (next === 'one_time' && !scheduledDate) {
      setScheduledDate(defaultDate || todayStr);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      return setError('Informe o nome da atividade.');
    }
    if (!scheduledTime) {
      return setError('Informe o horário da atividade.');
    }
    if (scheduleType === 'one_time' && !scheduledDate) {
      return setError('Escolha a data da atividade.');
    }
    if (scheduleType === 'weekly' && selectedWeekdays.length === 0) {
      return setError('Selecione pelo menos um dia da semana.');
    }

    setLoading(true);
    setError('');

    const normalizedDays = sortWeekdays(selectedWeekdays);
    const normalizedTime = scheduledTime.length === 5 ? `${scheduledTime}:00` : scheduledTime;

    try {
      if (activity) {
        await updateActivity(activity.id, {
          title: title.trim(),
          category,
          schedule_type: scheduleType,
          scheduled_date: scheduleType === 'one_time' ? scheduledDate : null,
          weekdays: scheduleType === 'weekly' ? normalizedDays : null,
          scheduled_time: normalizedTime,
          notes: notes.trim() || null,
          active,
          updated_by: profileId,
          updated_at: new Date().toISOString(),
        });
      } else {
        await createActivity({
          patient_id: patientId,
          title: title.trim(),
          category,
          schedule_type: scheduleType,
          scheduled_date: scheduleType === 'one_time' ? scheduledDate : null,
          weekdays: scheduleType === 'weekly' ? normalizedDays : null,
          scheduled_time: normalizedTime,
          notes: notes.trim() || null,
          active: true,
          created_by: profileId,
          updated_by: profileId,
        });
      }
      onSuccess();
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Não foi possível salvar a atividade.');
    } finally {
      setLoading(false);
    }
  };

  const daysUntil =
    scheduleType === 'one_time' && scheduledDate
      ? diffDaysBetweenDates(todayStr, scheduledDate)
      : NaN;

  const previewDaysLabel = formatActivityDaysSummary({
    schedule_type: scheduleType,
    scheduled_date: scheduledDate,
    weekdays: selectedWeekdays,
  });

  const dateHintText = (() => {
    if (scheduleType !== 'one_time' || !Number.isFinite(daysUntil)) return '';
    if (daysUntil === 0) {
      return 'Entra hoje na linha do tempo de Hoje para acompanhamento.';
    }
    if (daysUntil >= 1 && daysUntil <= 7) {
      return `${formatDaysUntilLabel(daysUntil)} — um aviso aparecerá no topo de Hoje até o dia.`;
    }
    if (daysUntil > 7) {
      return `${formatDaysUntilLabel(daysUntil)} — aparecerá em Hoje só nessa data, com aviso prévio nos 7 dias anteriores.`;
    }
    return 'Data anterior a hoje.';
  })();

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={() => {
        if (!loading) onClose();
      }}
      title={activity ? 'Editar Atividade' : 'Nova Atividade'}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          dismissMobileKeyboard();
          void handleSave();
        }}
        className="space-y-5"
      >
        {error && (
          <div className="p-3 bg-red-50 dark:bg-rose-950/40 dark:border dark:border-rose-800/50 text-red-700 dark:text-rose-300 rounded-xl text-sm">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
            Nome da atividade
          </label>
          <Input
            enterKeyHint="done"
            disabled={loading}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => handleEnterKeySubmit(e, handleSave)}
            placeholder="Ex: Consulta médica, Fisioterapia, Yoga"
          />
        </div>

        {/* Categoria: apenas 2 opções claras */}
        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
            Tipo de atividade
          </label>
          <div
            role="radiogroup"
            aria-label="Tipo de atividade"
            className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-gray-100 dark:bg-[#16161b] border border-gray-200/70 dark:border-white/[0.08]"
          >
            <button
              type="button"
              role="radio"
              aria-checked={category === 'medical'}
              disabled={loading}
              onClick={() => setCategory('medical')}
              className={cn(
                'min-h-[44px] px-3 rounded-lg text-sm font-semibold transition-all whitespace-nowrap',
                category === 'medical'
                  ? 'bg-white dark:bg-[#24242d] text-gray-900 dark:text-zinc-100 shadow-sm'
                  : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
              )}
            >
              Consulta / Saúde
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={category === 'wellness'}
              disabled={loading}
              onClick={() => setCategory('wellness')}
              className={cn(
                'min-h-[44px] px-3 rounded-lg text-sm font-semibold transition-all whitespace-nowrap',
                category === 'wellness'
                  ? 'bg-white dark:bg-[#24242d] text-gray-900 dark:text-zinc-100 shadow-sm'
                  : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
              )}
            >
              Física / Lazer
            </button>
          </div>
        </div>

        {/* Ritmo: Data específica vs Dias da semana */}
        <div className="space-y-2.5">
          <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
            Quando acontece
          </label>
          <div
            role="radiogroup"
            aria-label="Quando acontece"
            className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-gray-100 dark:bg-[#16161b] border border-gray-200/70 dark:border-white/[0.08]"
          >
            <button
              type="button"
              role="radio"
              aria-checked={scheduleType === 'one_time'}
              disabled={loading}
              onClick={() => handleScheduleTypeChange('one_time')}
              className={cn(
                'min-h-[44px] px-3 rounded-lg text-sm font-semibold transition-all whitespace-nowrap',
                scheduleType === 'one_time'
                  ? 'bg-white dark:bg-[#24242d] text-gray-900 dark:text-zinc-100 shadow-sm'
                  : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
              )}
            >
              Data específica
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={scheduleType === 'weekly'}
              disabled={loading}
              onClick={() => handleScheduleTypeChange('weekly')}
              className={cn(
                'min-h-[44px] px-3 rounded-lg text-sm font-semibold transition-all whitespace-nowrap',
                scheduleType === 'weekly'
                  ? 'bg-white dark:bg-[#24242d] text-gray-900 dark:text-zinc-100 shadow-sm'
                  : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
              )}
            >
              Dias da semana
            </button>
          </div>

          {scheduleType === 'one_time' ? (
            <div className="pt-1 space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setScheduledDate(todayStr)}
                  className={cn(
                    'min-h-[44px] px-3 rounded-xl text-xs font-semibold border transition-all whitespace-nowrap',
                    scheduledDate === todayStr
                      ? 'bg-gray-900 text-white border-gray-900 dark:bg-indigo-600 dark:border-indigo-500'
                      : 'bg-white dark:bg-[#1c1c22] text-gray-700 dark:text-zinc-300 border-gray-200 dark:border-white/[0.1]'
                  )}
                >
                  Hoje
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setScheduledDate(tomorrowStr)}
                  className={cn(
                    'min-h-[44px] px-3 rounded-xl text-xs font-semibold border transition-all whitespace-nowrap',
                    scheduledDate === tomorrowStr
                      ? 'bg-gray-900 text-white border-gray-900 dark:bg-indigo-600 dark:border-indigo-500'
                      : 'bg-white dark:bg-[#1c1c22] text-gray-700 dark:text-zinc-300 border-gray-200 dark:border-white/[0.1]'
                  )}
                >
                  Amanhã
                </button>
              </div>

              <input
                type="date"
                aria-label="Data da atividade"
                disabled={loading}
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="flex h-12 w-full rounded-xl border border-gray-200 dark:border-white/[0.1] bg-white dark:bg-[#1c1c22] text-gray-900 dark:text-zinc-100 px-4 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 dark:focus-visible:ring-zinc-400"
              />

              {dateHintText && (
                <p className="text-xs text-gray-500 dark:text-zinc-400 px-0.5 leading-relaxed">
                  {dateHintText}
                </p>
              )}
            </div>
          ) : (
            <div className="pt-1.5 space-y-2">
              <div className="grid grid-cols-7 gap-1.5">
                {WEEKDAY_OPTIONS.map((day) => {
                  const isSelected = selectedWeekdays.includes(day.key);
                  return (
                    <button
                      key={day.key}
                      type="button"
                      disabled={loading}
                      aria-label={day.fullLabel}
                      aria-pressed={isSelected}
                      onClick={() => handleToggleWeekday(day.key)}
                      className={cn(
                        'min-h-[44px] w-full rounded-full text-xs font-bold transition-all active:scale-95 flex items-center justify-center',
                        isSelected
                          ? 'bg-gray-900 text-white dark:bg-indigo-600 dark:text-white shadow-sm'
                          : 'bg-gray-100 text-gray-600 dark:bg-[#1c1c22] dark:text-zinc-400 border border-gray-200 dark:border-white/[0.08] hover:border-gray-300 dark:hover:border-white/[0.16]'
                      )}
                    >
                      {day.shortLabel}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-gray-500 dark:text-zinc-400 px-0.5">
                {selectedWeekdays.length === 0
                  ? 'Toque nos dias da semana em que esta atividade acontece.'
                  : `Selecionado: ${previewDaysLabel}`}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Horário</label>
          <input
            type="time"
            aria-label="Horário da atividade"
            disabled={loading}
            value={scheduledTime}
            onChange={(e) => setScheduledTime(e.target.value)}
            className="flex h-12 w-full rounded-xl border border-gray-200 dark:border-white/[0.1] bg-white dark:bg-[#1c1c22] text-gray-900 dark:text-zinc-100 px-4 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 dark:focus-visible:ring-zinc-400"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
            Local ou observação{' '}
            <span className="text-gray-400 dark:text-zinc-500 font-normal">(Opcional)</span>
          </label>
          <Input
            enterKeyHint="done"
            disabled={loading}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onKeyDown={(e) => handleEnterKeySubmit(e, handleSave)}
            placeholder="Ex: Clínica Central, sala 204 ou levar exames"
          />
        </div>

        {/* Resumo humano antes de salvar */}
        <div className="rounded-2xl border border-indigo-100/90 dark:border-indigo-900/40 bg-indigo-50/50 dark:bg-indigo-950/20 px-4 py-3 space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
            Resumo na rotina
          </p>
          <p className="text-xs text-gray-700 dark:text-zinc-300 leading-relaxed">
            <span className="font-semibold">
              {category === 'medical' ? 'Consulta / Saúde' : 'Física / Lazer'}:
            </span>{' '}
            {title.trim() || 'Informe o nome da atividade'}
          </p>
          <p className="text-xs text-gray-700 dark:text-zinc-300 leading-relaxed tabular-nums">
            <span className="font-semibold">Quando:</span> {previewDaysLabel} às{' '}
            {scheduledTime || '--:--'}
          </p>
        </div>

        {activity && (
          <div className="flex items-center justify-between p-4 rounded-xl border border-gray-100 dark:border-white/[0.08] bg-gray-50 dark:bg-[#1c1c22]">
            <div>
              <h4 className="font-medium text-gray-900 dark:text-zinc-100">Status</h4>
              <p className="text-sm text-gray-500 dark:text-zinc-400">
                {active ? 'Ativa' : 'Inativa'}
              </p>
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={() => setActive(!active)}
              className={cn(
                'w-12 h-6 rounded-full transition-colors relative',
                active ? 'bg-green-500 dark:bg-emerald-500' : 'bg-gray-300 dark:bg-zinc-700'
              )}
            >
              <div
                className={cn(
                  'absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform',
                  active ? 'translate-x-6' : 'translate-x-0'
                )}
              />
            </button>
          </div>
        )}

        <div className="pt-2">
          <Button
            type="submit"
            className="w-full min-h-[48px]"
            size="lg"
            disabled={loading || !title.trim()}
          >
            {loading ? <Spinner className="text-white dark:text-zinc-950" /> : 'Salvar Atividade'}
          </Button>
        </div>
      </form>
    </BottomSheet>
  );
}
