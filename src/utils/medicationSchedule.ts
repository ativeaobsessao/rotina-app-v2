import { getWeekdayName } from './date';
import type { TimelineEvent } from '../types/timeline';

export type WeekdayKey =
  | 'Monday'
  | 'Tuesday'
  | 'Wednesday'
  | 'Thursday'
  | 'Friday'
  | 'Saturday'
  | 'Sunday';

export interface WeekdayOption {
  key: WeekdayKey;
  shortLabel: string;
  abbr: string;
  fullLabel: string;
  fullShort: string;
}

export const WEEKDAY_OPTIONS: WeekdayOption[] = [
  { key: 'Monday', shortLabel: 'S', abbr: 'Seg', fullLabel: 'Segunda-feira', fullShort: 'Segunda' },
  { key: 'Tuesday', shortLabel: 'T', abbr: 'Ter', fullLabel: 'Terça-feira', fullShort: 'Terça' },
  { key: 'Wednesday', shortLabel: 'Q', abbr: 'Qua', fullLabel: 'Quarta-feira', fullShort: 'Quarta' },
  { key: 'Thursday', shortLabel: 'Q', abbr: 'Qui', fullLabel: 'Quinta-feira', fullShort: 'Quinta' },
  { key: 'Friday', shortLabel: 'S', abbr: 'Sex', fullLabel: 'Sexta-feira', fullShort: 'Sexta' },
  { key: 'Saturday', shortLabel: 'S', abbr: 'Sáb', fullLabel: 'Sábado', fullShort: 'Sábado' },
  { key: 'Sunday', shortLabel: 'D', abbr: 'Dom', fullLabel: 'Domingo', fullShort: 'Domingo' },
];

export const ALL_WEEKDAY_KEYS: WeekdayKey[] = WEEKDAY_OPTIONS.map((w) => w.key);

const VALID_WEEKDAY_SET = new Set<string>(ALL_WEEKDAY_KEYS);

export interface MedicationScheduleLike {
  frequency?: string | null;
  weekday?: string | null;
  weekdays?: string[] | null;
  dosage?: string | null;
  daily_dosages?: Record<string, string | null | undefined> | null;
}

export function isValidWeekdayKey(value: unknown): value is WeekdayKey {
  return typeof value === 'string' && VALID_WEEKDAY_SET.has(value);
}

/**
 * Normalizes and orders weekday keys Monday -> Sunday.
 */
export function sortWeekdays(days: string[]): WeekdayKey[] {
  const unique = new Set(days.filter(isValidWeekdayKey));
  return ALL_WEEKDAY_KEYS.filter((day) => unique.has(day));
}

/**
 * Resolves the effective weekdays a medication runs on.
 */
export function getMedicationWeekdays(med: MedicationScheduleLike): WeekdayKey[] {
  if (med.frequency === 'daily') {
    return [...ALL_WEEKDAY_KEYS];
  }
  if (Array.isArray(med.weekdays) && med.weekdays.length > 0) {
    const valid = sortWeekdays(med.weekdays);
    if (valid.length > 0) return valid;
  }
  if (isValidWeekdayKey(med.weekday)) {
    return [med.weekday];
  }
  return [];
}

/**
 * Checks if a medication is scheduled for a specific YYYY-MM-DD calendar date.
 */
export function isMedicationScheduledForDate(
  med: MedicationScheduleLike,
  dateStr: string
): boolean {
  if (med.frequency === 'daily') return true;
  if (med.frequency === 'weekly') {
    const day = getWeekdayName(dateStr);
    if (!isValidWeekdayKey(day)) return false;
    return getMedicationWeekdays(med).includes(day);
  }
  return false;
}

/**
 * Resolves the dosage string for a specific YYYY-MM-DD calendar date.
 * Falls back cleanly to the default `med.dosage`.
 */
export function getMedicationDosageForDate(
  med: MedicationScheduleLike,
  dateStr?: string | null
): string {
  const fallback = String(med.dosage || '').trim();
  if (!dateStr || !med.daily_dosages || typeof med.daily_dosages !== 'object') {
    return fallback;
  }
  const day = getWeekdayName(dateStr);
  if (!isValidWeekdayKey(day)) return fallback;
  const custom = med.daily_dosages[day];
  if (typeof custom === 'string' && custom.trim()) {
    return custom.trim();
  }
  return fallback;
}

/**
 * Normalizes a daily_dosages map: keeps only scheduled days where the dosage differs from baseDosage.
 * Returns null if no day has a custom dose (keeps DB clean and avoids unnecessary JSON payloads).
 */
export function normalizeDailyDosages(
  baseDosage: string,
  scheduledWeekdays: WeekdayKey[],
  draftMap: Record<string, string>
): Record<string, string> | null {
  const trimmedBase = baseDosage.trim();
  const result: Record<string, string> = {};
  let hasVariation = false;

  for (const day of scheduledWeekdays) {
    const val = (draftMap[day] || '').trim();
    if (val && val !== trimmedBase) {
      result[day] = val;
      hasVariation = true;
    }
  }

  return hasVariation ? result : null;
}

/**
 * Checks whether a medication actually varies dosage across its scheduled weekdays.
 */
export function hasCustomDailyDosages(med: MedicationScheduleLike): boolean {
  if (!med.daily_dosages || typeof med.daily_dosages !== 'object') return false;
  const base = String(med.dosage || '').trim();
  const activeDays = getMedicationWeekdays(med);
  return activeDays.some((day) => {
    const val = med.daily_dosages?.[day];
    return typeof val === 'string' && val.trim() !== '' && val.trim() !== base;
  });
}

export function getWeekdayOption(key: string): WeekdayOption | undefined {
  return WEEKDAY_OPTIONS.find((w) => w.key === key);
}

/**
 * Formats the scheduled frequency cleanly in Portuguese (e.g. "Todos os dias", "Toda Segunda", "Seg, Qua, Sex").
 */
export function formatMedicationDaysSummary(med: MedicationScheduleLike): string {
  if (med.frequency === 'daily') return 'Todos os dias';
  const days = getMedicationWeekdays(med);
  if (days.length === 0) return 'Sem dias definidos';
  if (days.length === ALL_WEEKDAY_KEYS.length) return 'Todos os dias';
  if (days.length === 1) {
    const opt = getWeekdayOption(days[0]);
    return opt ? `Toda ${opt.fullShort}` : days[0];
  }
  return days
    .map((d) => getWeekdayOption(d)?.abbr || d)
    .join(', ');
}

/**
 * Formats a concise human-readable dosage + schedule line for Routine lists.
 */
export function formatMedicationScheduleSummary(med: MedicationScheduleLike): string {
  const daysLabel = formatMedicationDaysSummary(med);
  const base = String(med.dosage || '').trim();
  if (!hasCustomDailyDosages(med)) {
    return base ? `${base} • ${daysLabel}` : daysLabel;
  }
  return base ? `${base} (varia por dia) • ${daysLabel}` : `Dose varia por dia • ${daysLabel}`;
}

export interface TimelineProgressMetrics {
  totalItems: number;
  completedItems: number;
  pendingItems: number;
  allCompleted: boolean;
}

/**
 * Computes granular daily progress metrics:
 * - Each configured meal = 1 item (completed when meal has a log)
 * - Each scheduled medication in a period = 1 item (completed when that medication has a log)
 *
 * Ensures confirming even 1 of N medications in a period immediately advances daily progress.
 */
export function getTimelineProgressMetrics(events: TimelineEvent[]): TimelineProgressMetrics {
  let totalItems = 0;
  let completedItems = 0;

  for (const event of events) {
    if (event.type === 'meal') {
      totalItems += 1;
      if (event.log) {
        completedItems += 1;
      }
    } else if (event.type === 'medication_period') {
      const meds = Array.isArray(event.medications) ? event.medications : [];
      const logs = Array.isArray(event.logs) ? event.logs : [];
      const loggedMedIds = new Set(logs.map((l) => l.medication_id));

      totalItems += meds.length;
      for (const med of meds) {
        if (loggedMedIds.has(med.id)) {
          completedItems += 1;
        }
      }
    }
  }

  const pendingItems = Math.max(0, totalItems - completedItems);
  const allCompleted = totalItems > 0 && pendingItems === 0;

  return {
    totalItems,
    completedItems,
    pendingItems,
    allCompleted,
  };
}
