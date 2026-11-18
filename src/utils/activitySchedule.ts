import { getWeekdayName, formatTime } from './date';
import {
  ALL_WEEKDAY_KEYS,
  WEEKDAY_OPTIONS,
  getWeekdayOption,
  isValidWeekdayKey,
  sortWeekdays,
  type WeekdayKey,
} from './medicationSchedule';
import type { ActivityCategory, ActivityScheduleType } from '../types/database.types';

export interface ActivityScheduleLike {
  id?: string;
  title?: string;
  category?: ActivityCategory | string | null;
  schedule_type?: ActivityScheduleType | string | null;
  scheduled_date?: string | null;
  weekdays?: string[] | null;
  scheduled_time?: string | null;
  notes?: string | null;
  active?: boolean | null;
}

function parseCalendarDateUtcNoon(dateStr?: string | null): number {
  if (!dateStr) return NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return NaN;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ts = Date.UTC(year, month - 1, day, 12, 0, 0);
  if (!Number.isFinite(ts)) return NaN;
  const check = new Date(ts);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return NaN;
  }
  return ts;
}

/**
 * Computes exact whole calendar days between two YYYY-MM-DD strings (to - from).
 */
export function diffDaysBetweenDates(fromDateStr: string, toDateStr: string): number {
  const fromTs = parseCalendarDateUtcNoon(fromDateStr);
  const toTs = parseCalendarDateUtcNoon(toDateStr);
  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs)) return NaN;
  return Math.round((toTs - fromTs) / 86_400_000);
}

export function getActivityWeekdays(activity: ActivityScheduleLike): WeekdayKey[] {
  if (Array.isArray(activity.weekdays) && activity.weekdays.length > 0) {
    return sortWeekdays(activity.weekdays);
  }
  return [];
}

/**
 * Checks if an active activity should appear on the timeline for a YYYY-MM-DD calendar date.
 */
export function isActivityScheduledForDate(
  activity: ActivityScheduleLike,
  dateStr: string
): boolean {
  if (activity.active === false) return false;
  if (activity.schedule_type === 'one_time') {
    return Boolean(activity.scheduled_date && activity.scheduled_date === dateStr);
  }
  if (activity.schedule_type === 'weekly') {
    const day = getWeekdayName(dateStr);
    if (!isValidWeekdayKey(day)) return false;
    return getActivityWeekdays(activity).includes(day);
  }
  return false;
}

/**
 * Returns true if a one-time activity's scheduled_date is already in the past (< todayDateStr).
 */
export function isExpiredOneTimeActivity(
  activity: ActivityScheduleLike,
  todayDateStr: string
): boolean {
  if (activity.schedule_type !== 'one_time' || !activity.scheduled_date) return false;
  return activity.scheduled_date < todayDateStr;
}

export interface UpcomingActivityItem<T extends ActivityScheduleLike = ActivityScheduleLike> {
  activity: T;
  daysUntil: number;
}

/**
 * Returns active one-time activities scheduled within [minDaysAhead, maxDaysAhead] calendar days
 * from todayDateStr (default 1 to 7 days ahead so advance warnings remain visible until appointment day).
 */
export function getUpcomingScheduledActivities<T extends ActivityScheduleLike>(
  activities: T[],
  todayDateStr: string,
  minDaysAhead = 1,
  maxDaysAhead = 7
): UpcomingActivityItem<T>[] {
  const items: UpcomingActivityItem<T>[] = [];
  for (const activity of activities) {
    if (activity.active === false) continue;
    if (activity.schedule_type !== 'one_time' || !activity.scheduled_date) continue;
    const daysUntil = diffDaysBetweenDates(todayDateStr, activity.scheduled_date);
    if (Number.isFinite(daysUntil) && daysUntil >= minDaysAhead && daysUntil <= maxDaysAhead) {
      items.push({ activity, daysUntil });
    }
  }

  items.sort((a, b) => {
    if (a.daysUntil !== b.daysUntil) return a.daysUntil - b.daysUntil;
    return String(a.activity.scheduled_time || '').localeCompare(
      String(b.activity.scheduled_time || '')
    );
  });

  return items;
}

export function formatShortDateBR(dateStr?: string | null): string {
  if (!dateStr) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return dateStr;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatDaysUntilLabel(daysUntil: number): string {
  if (!Number.isFinite(daysUntil)) return '';
  if (daysUntil < 0) return 'Data anterior';
  if (daysUntil === 0) return 'Hoje';
  if (daysUntil === 1) return 'Amanhã';
  if (daysUntil < 30) return `Em ${daysUntil} dias`;
  const months = Math.max(1, Math.round(daysUntil / 30));
  return months === 1 ? 'Em 1 mês' : `Em ${months} meses`;
}

export function formatActivityDaysSummary(activity: ActivityScheduleLike): string {
  if (activity.schedule_type === 'one_time') {
    return activity.scheduled_date ? formatShortDateBR(activity.scheduled_date) : 'Data a definir';
  }
  const days = getActivityWeekdays(activity);
  if (days.length === 0) return 'Sem dias definidos';
  if (days.length === ALL_WEEKDAY_KEYS.length) return 'Todos os dias';
  if (days.length === 1) {
    const opt = getWeekdayOption(days[0]);
    return opt ? `Toda ${opt.fullShort}` : days[0];
  }
  return days.map((d) => getWeekdayOption(d)?.abbr || d).join(', ');
}

export function formatActivityScheduleSummary(
  activity: ActivityScheduleLike,
  todayDateStr?: string
): string {
  const daysSummary = formatActivityDaysSummary(activity);
  const timePart = activity.scheduled_time ? formatTime(activity.scheduled_time) : '';
  if (activity.schedule_type === 'one_time' && todayDateStr && activity.scheduled_date) {
    const diff = diffDaysBetweenDates(todayDateStr, activity.scheduled_date);
    const rel = Number.isFinite(diff) && diff >= 0 ? formatDaysUntilLabel(diff) : '';
    const base = timePart ? `${daysSummary} • ${timePart}` : daysSummary;
    return rel ? `${rel} (${base})` : base;
  }
  return timePart ? `${daysSummary} • ${timePart}` : daysSummary;
}

export function getActivityCategoryLabel(category?: string | null): string {
  return category === 'medical' ? 'Consulta / Saúde' : 'Física / Lazer';
}

export { WEEKDAY_OPTIONS, sortWeekdays };
export type { WeekdayKey };
