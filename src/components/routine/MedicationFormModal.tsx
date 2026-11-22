import React, { useState, useEffect } from 'react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { formatTime } from '../../utils/date';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';
import { createMedication, updateMedication } from '../../services/api';
import { cn } from '../../utils/cn';
import { dismissMobileKeyboard, handleEnterKeySubmit } from '../../utils/keyboardSubmit';
import {
  ALL_WEEKDAY_KEYS,
  WEEKDAY_OPTIONS,
  getMedicationWeekdays,
  hasCustomDailyDosages,
  normalizeDailyDosages,
  sortWeekdays,
  formatMedicationDaysSummary,
  type WeekdayKey,
} from '../../utils/medicationSchedule';

interface MedicationFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  medication: any | null; // if editing
  periods: any[];
  defaultPeriodId?: string;
  onSuccess: () => void;
}

export function MedicationFormModal({
  isOpen,
  onClose,
  patientId,
  medication,
  periods,
  defaultPeriodId,
  onSuccess,
}: MedicationFormModalProps) {
  const [name, setName] = useState('');
  const [dosage, setDosage] = useState('');
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily');
  const [selectedWeekdays, setSelectedWeekdays] = useState<WeekdayKey[]>(['Monday', 'Wednesday', 'Friday']);
  const [variesByDay, setVariesByDay] = useState(false);
  const [dailyDosageDrafts, setDailyDosageDrafts] = useState<Record<string, string>>({});
  const [periodId, setPeriodId] = useState('');
  const [active, setActive] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    if (medication) {
      setName(medication.name || '');
      setDosage(medication.dosage || '');
      const isDaily = medication.frequency === 'daily';
      setFrequency(isDaily ? 'daily' : 'weekly');

      const resolvedDays = getMedicationWeekdays(medication);
      setSelectedWeekdays(resolvedDays.length > 0 && !isDaily ? resolvedDays : ['Monday']);

      const hasCustom = hasCustomDailyDosages(medication);
      setVariesByDay(hasCustom);
      const drafts: Record<string, string> = {};
      if (medication.daily_dosages && typeof medication.daily_dosages === 'object') {
        for (const day of ALL_WEEKDAY_KEYS) {
          const val = medication.daily_dosages[day];
          if (typeof val === 'string' && val.trim()) {
            drafts[day] = val.trim();
          }
        }
      }
      setDailyDosageDrafts(drafts);
      setPeriodId(medication.medication_period_id || periods[0]?.id || '');
      setActive(medication.active ?? true);
    } else {
      setName('');
      setDosage('');
      setFrequency('daily');
      setSelectedWeekdays(['Monday', 'Wednesday', 'Friday']);
      setVariesByDay(false);
      setDailyDosageDrafts({});
      setPeriodId(defaultPeriodId || periods[0]?.id || '');
      setActive(true);
    }
    setError('');
  }, [isOpen, medication, defaultPeriodId, periods]);

  const activeDaysForSchedule: WeekdayKey[] =
    frequency === 'daily' ? ALL_WEEKDAY_KEYS : sortWeekdays(selectedWeekdays);

  const handleToggleWeekday = (day: WeekdayKey) => {
    setError('');
    setSelectedWeekdays((prev) => {
      if (prev.includes(day)) {
        return prev.filter((d) => d !== day);
      }
      return sortWeekdays([...prev, day]);
    });
  };

  const handleFrequencyChange = (nextFreq: 'daily' | 'weekly') => {
    setError('');
    setFrequency(nextFreq);
    if (nextFreq === 'weekly' && selectedWeekdays.length === 0) {
      setSelectedWeekdays(['Monday', 'Wednesday', 'Friday']);
    }
  };

  const handleDailyDosageChange = (day: WeekdayKey, value: string) => {
    setDailyDosageDrafts((prev) => ({
      ...prev,
      [day]: value,
    }));
  };

  const handleToggleVariesByDay = () => {
    const next = !variesByDay;
    setVariesByDay(next);
    if (next && dosage.trim()) {
      setDailyDosageDrafts((prev) => {
        const updated = { ...prev };
        for (const day of activeDaysForSchedule) {
          if (!updated[day]?.trim()) {
            updated[day] = dosage.trim();
          }
        }
        return updated;
      });
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return setError('Nome do medicamento é obrigatório.');
    if (!dosage.trim()) return setError('Dose padrão é obrigatória.');
    if (!periodId) return setError('Período é obrigatório.');
    if (frequency === 'weekly' && selectedWeekdays.length === 0) {
      return setError('Selecione pelo menos um dia da semana.');
    }

    setLoading(true);
    setError('');

    const normalizedSelectedDays = sortWeekdays(selectedWeekdays);
    const allSevenSelected =
      frequency === 'daily' || normalizedSelectedDays.length === ALL_WEEKDAY_KEYS.length;

    const effectiveFrequency: 'daily' | 'weekly' = allSevenSelected ? 'daily' : 'weekly';
    const effectiveDays: WeekdayKey[] = allSevenSelected
      ? ALL_WEEKDAY_KEYS
      : normalizedSelectedDays;

    const normalizedDailyDosages = variesByDay
      ? normalizeDailyDosages(dosage.trim(), effectiveDays, dailyDosageDrafts)
      : null;

    const medData: any = {
      patient_id: patientId,
      medication_period_id: periodId,
      name: name.trim(),
      dosage: dosage.trim(),
      frequency: effectiveFrequency,
      weekday: effectiveFrequency === 'weekly' ? effectiveDays[0] : null,
      weekdays: effectiveFrequency === 'weekly' ? effectiveDays : null,
      daily_dosages: normalizedDailyDosages,
      active,
    };

    try {
      if (medication) {
        await updateMedication(medication.id, medData);
      } else {
        await createMedication(medData);
      }
      onSuccess();
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Erro ao salvar o medicamento.');
    } finally {
      setLoading(false);
    }
  };

  const previewScheduleLabel = formatMedicationDaysSummary({
    frequency:
      frequency === 'daily' || activeDaysForSchedule.length === ALL_WEEKDAY_KEYS.length
        ? 'daily'
        : 'weekly',
    weekdays: activeDaysForSchedule,
    weekday: activeDaysForSchedule[0] || null,
  });

  const previewDosagesMap = variesByDay
    ? normalizeDailyDosages(dosage.trim(), activeDaysForSchedule, dailyDosageDrafts)
    : null;

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={medication ? 'Editar Medicamento' : 'Novo Medicamento'}
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
          <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Nome</label>
          <Input
            enterKeyHint="done"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => handleEnterKeySubmit(e, handleSave)}
            placeholder="Ex: Losartana"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
            Dose padrão
          </label>
          <Input
            enterKeyHint="done"
            value={dosage}
            onChange={(e) => setDosage(e.target.value)}
            onKeyDown={(e) => handleEnterKeySubmit(e, handleSave)}
            placeholder="Ex: 1 comprimido 50mg"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Período</label>
          <select
            className="flex h-12 w-full rounded-xl border border-gray-200 dark:border-white/[0.1] bg-white dark:bg-[#1c1c22] text-gray-900 dark:text-zinc-100 px-4 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 dark:focus-visible:ring-zinc-400"
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
          >
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({formatTime(p.scheduled_time)})
              </option>
            ))}
          </select>
        </div>

        {/* Frequência: controle segmentado com apenas 2 opções claras */}
        <div className="space-y-2.5">
          <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
            Dias na rotina
          </label>
          <div
            role="radiogroup"
            aria-label="Dias na rotina"
            className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-gray-100 dark:bg-[#16161b] border border-gray-200/70 dark:border-white/[0.08]"
          >
            <button
              type="button"
              role="radio"
              aria-checked={frequency === 'daily'}
              onClick={() => handleFrequencyChange('daily')}
              className={cn(
                'min-h-[44px] px-3 rounded-lg text-sm font-semibold transition-all whitespace-nowrap',
                frequency === 'daily'
                  ? 'bg-white dark:bg-[#24242d] text-gray-900 dark:text-zinc-100 shadow-sm'
                  : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
              )}
            >
              Todos os dias
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={frequency === 'weekly'}
              onClick={() => handleFrequencyChange('weekly')}
              className={cn(
                'min-h-[44px] px-3 rounded-lg text-sm font-semibold transition-all whitespace-nowrap',
                frequency === 'weekly'
                  ? 'bg-white dark:bg-[#24242d] text-gray-900 dark:text-zinc-100 shadow-sm'
                  : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
              )}
            >
              Dias da semana
            </button>
          </div>

          {frequency === 'weekly' && (
            <div className="pt-1.5 space-y-2">
              <div className="grid grid-cols-7 gap-1.5">
                {WEEKDAY_OPTIONS.map((day) => {
                  const isSelected = selectedWeekdays.includes(day.key);
                  return (
                    <button
                      key={day.key}
                      type="button"
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
                  ? 'Toque nos dias em que este medicamento deve ser tomado.'
                  : `Selecionado: ${previewScheduleLabel}`}
              </p>
            </div>
          )}
        </div>

        {/* Variação opcional de dose por dia */}
        <div className="rounded-2xl border border-gray-100 dark:border-white/[0.08] bg-gray-50/80 dark:bg-[#16161b] p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                Dose muda conforme o dia?
              </h4>
              <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
                Ative só se a quantidade mudar entre os dias
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={variesByDay}
              aria-label="Dose muda conforme o dia"
              onClick={handleToggleVariesByDay}
              className={cn(
                'w-12 h-7 rounded-full transition-colors relative shrink-0',
                variesByDay ? 'bg-indigo-600 dark:bg-indigo-500' : 'bg-gray-300 dark:bg-zinc-700'
              )}
            >
              <div
                className={cn(
                  'absolute top-1 left-1 bg-white w-5 h-5 rounded-full transition-transform shadow-sm',
                  variesByDay ? 'translate-x-5' : 'translate-x-0'
                )}
              />
            </button>
          </div>

          {variesByDay && (
            <div className="pt-2 border-t border-gray-200/70 dark:border-white/[0.08] space-y-2">
              {activeDaysForSchedule.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-zinc-400">
                  Selecione ao menos um dia da semana acima para definir as doses.
                </p>
              ) : (
                activeDaysForSchedule.map((dayKey) => {
                  const option = WEEKDAY_OPTIONS.find((w) => w.key === dayKey)!;
                  return (
                    <div key={dayKey} className="flex items-center gap-3">
                      <span className="w-20 text-xs font-semibold text-gray-700 dark:text-zinc-300 shrink-0">
                        {option.fullShort}
                      </span>
                      <Input
                        enterKeyHint="done"
                        value={dailyDosageDrafts[dayKey] ?? ''}
                        onChange={(e) => handleDailyDosageChange(dayKey, e.target.value)}
                        onKeyDown={(e) => handleEnterKeySubmit(e, handleSave)}
                        placeholder={dosage.trim() || 'Ex: 1 comprimido'}
                        aria-label={`Dose de ${option.fullLabel}`}
                        className="h-11 text-sm"
                      />
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Resumo humano antes de salvar */}
        <div className="rounded-2xl border border-indigo-100/90 dark:border-indigo-900/40 bg-indigo-50/50 dark:bg-indigo-950/20 px-4 py-3 space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
            Resumo na rotina
          </p>
          <p className="text-xs text-gray-700 dark:text-zinc-300 leading-relaxed">
            <span className="font-semibold">Dias:</span> {previewScheduleLabel}
          </p>
          <p className="text-xs text-gray-700 dark:text-zinc-300 leading-relaxed">
            <span className="font-semibold">Dose:</span>{' '}
            {previewDosagesMap
              ? activeDaysForSchedule
                  .map((dayKey) => {
                    const option = WEEKDAY_OPTIONS.find((w) => w.key === dayKey)!;
                    const d = previewDosagesMap[dayKey] || dosage.trim() || '—';
                    return `${option.abbr}: ${d}`;
                  })
                  .join(' · ')
              : dosage.trim() || 'Informe a dose padrão'}
          </p>
        </div>

        <div className="flex items-center justify-between p-4 rounded-xl border border-gray-100 dark:border-white/[0.08] bg-gray-50 dark:bg-[#1c1c22]">
          <div>
            <h4 className="font-medium text-gray-900 dark:text-zinc-100">Status</h4>
            <p className="text-sm text-gray-500 dark:text-zinc-400">
              {active ? 'Ativo' : 'Inativo'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActive(!active)}
            className={`w-12 h-6 rounded-full transition-colors relative ${
              active ? 'bg-green-500 dark:bg-emerald-500' : 'bg-gray-300 dark:bg-zinc-700'
            }`}
          >
            <div
              className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${
                active ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div className="pt-2">
          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={loading || !name.trim() || !dosage.trim()}
          >
            {loading ? <Spinner className="text-white dark:text-zinc-950" /> : 'Salvar Medicamento'}
          </Button>
        </div>
      </form>
    </BottomSheet>
  );
}
