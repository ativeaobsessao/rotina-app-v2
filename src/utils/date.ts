import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

export function getLocalDateString(
  timezone: string = DEFAULT_TIMEZONE,
  now: Date = new Date()
): string {
  try {
    const options: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    };

    const formatter = new Intl.DateTimeFormat('en-US', options);
    if (typeof formatter.formatToParts === 'function') {
      const parts = formatter.formatToParts(now);
      const year = parts.find(p => p.type === 'year')?.value;
      const month = parts.find(p => p.type === 'month')?.value;
      const day = parts.find(p => p.type === 'day')?.value;

      if (year && month && day) {
        return `${year}-${month}-${day}`;
      }
    }

    const fallback = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    if (!isNaN(fallback.getTime())) {
      const y = fallback.getFullYear();
      const m = String(fallback.getMonth() + 1).padStart(2, '0');
      const d = String(fallback.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  } catch (e) {
    console.error('Intl error in getLocalDateString:', e);
  }

  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getCurrentLocalTime(
  timezone: string = DEFAULT_TIMEZONE,
  now: Date = new Date()
): string {
  try {
    const options: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    };

    const formatter = new Intl.DateTimeFormat('en-US', options);
    if (typeof formatter.formatToParts === 'function') {
      const parts = formatter.formatToParts(now);
      const hour = parts.find(p => p.type === 'hour')?.value || '00';
      const minute = parts.find(p => p.type === 'minute')?.value || '00';
      const second = parts.find(p => p.type === 'second')?.value || '00';

      const h = hour === '24' ? '00' : hour;
      return `${h.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`;
    }

    const fallback = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    if (!isNaN(fallback.getTime())) {
      const h = String(fallback.getHours()).padStart(2, '0');
      const m = String(fallback.getMinutes()).padStart(2, '0');
      const s = String(fallback.getSeconds()).padStart(2, '0');
      return `${h}:${m}:${s}`;
    }
  } catch (e) {
    console.error('Intl error in getCurrentLocalTime:', e);
  }

  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Checks whether the current local time in the target timezone (default: America/Sao_Paulo)
 * is at or after the nightly closure reminder hour (default: 21:00).
 */
export function isAfterClosureReminderTime(
  now: Date = new Date(),
  timezone: string = DEFAULT_TIMEZONE,
  reminderHour: number = 21
): boolean {
  const localTime = getCurrentLocalTime(timezone, now);
  const hour = Number(localTime.slice(0, 2));
  if (!Number.isFinite(hour)) return false;
  return hour >= reminderHour;
}

/**
 * Calculates milliseconds until the next local time boundary:
 * - Before reminderHour (e.g. 21:00): ms until reminderHour:00:00 today
 * - At/after reminderHour: ms until 00:00:00 midnight rollover
 */
export function getMsUntilNextClosureBoundary(
  now: Date = new Date(),
  timezone: string = DEFAULT_TIMEZONE,
  reminderHour: number = 21
): number {
  const localTime = getCurrentLocalTime(timezone, now);
  const parts = localTime.split(':').map((n) => Number(n));
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) {
    return 60_000;
  }

  const [hh, mm, ss] = parts;
  const currentSec = hh * 3600 + mm * 60 + ss;
  const targetSec = hh < reminderHour ? reminderHour * 3600 : 24 * 3600;
  const remainingSec = Math.max(1, targetSec - currentSec);
  const remainingMs = remainingSec * 1000 - now.getMilliseconds() + 50;
  return Math.max(100, remainingMs);
}

/**
 * Pure calendar arithmetic for YYYY-MM-DD strings (immune to browser timezone / midnight shifts).
 */
export function shiftDateString(dateStr: string, deltaDays: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return dateStr;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day + deltaDays, 12, 0, 0));
  if (isNaN(utc.getTime())) return dateStr;
  return utc.toISOString().slice(0, 10);
}

function safeParseDate(dateStr: string): Date {
  if (!dateStr) return new Date(NaN);
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    // Use local noon (12:00:00) so DST transitions around midnight never shift calendar day
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);
  }
  return new Date(dateStr);
}

export function formatFriendlyDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = safeParseDate(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  try {
    const friendly = format(d, "EEEE, d 'de' MMMM", { locale: ptBR });
    return friendly.charAt(0).toUpperCase() + friendly.slice(1);
  } catch {
    return dateStr;
  }
}

export function getWeekdayName(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    // Pure calendar weekday lookup in English (matches DB 'Monday'..'Sunday')
    const utc = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0));
    if (!isNaN(utc.getTime())) {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return days[utc.getUTCDay()];
    }
  }
  const d = safeParseDate(dateStr);
  if (isNaN(d.getTime())) return '';
  try {
    return format(d, 'EEEE');
  } catch {
    return '';
  }
}

export function formatTime(timeString: string): string {
  if (!timeString) return '';
  const parts = timeString.split(':');
  if (parts.length >= 2) {
    return `${parts[0]}h:${parts[1]}min`;
  }
  return timeString;
}

export function formatDateToTime(
  dateVal: Date | string | null | undefined,
  timezone: string = DEFAULT_TIMEZONE
): string {
  if (!dateVal) return '';
  try {
    const d = typeof dateVal === 'string' ? new Date(dateVal) : dateVal;
    if (isNaN(d.getTime())) return '';

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(d);
    const hourRaw = parts.find(p => p.type === 'hour')?.value;
    const minRaw = parts.find(p => p.type === 'minute')?.value;
    if (hourRaw && minRaw) {
      const h = (hourRaw === '24' ? '00' : hourRaw).padStart(2, '0');
      return `${h}h:${minRaw.padStart(2, '0')}min`;
    }

    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}h:${m}min`;
  } catch {
    return '';
  }
}
