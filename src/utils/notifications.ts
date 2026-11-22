import { formatTime } from './date';
import {
  diffDaysBetweenDates,
  formatShortDateBR,
  getActivityCategoryLabel,
  type ActivityScheduleLike,
} from './activitySchedule';

export const ACTIVITY_NOTIFICATION_MILESTONES = [7, 3, 1] as const;
export type ActivityMilestoneDays = (typeof ACTIVITY_NOTIFICATION_MILESTONES)[number];

export const ACTIVITY_MILESTONE_DISMISS_PREFIX = 'duca_activity_milestone_dismissed';

export type NotificationLeadMinutes = 0 | 5 | 10 | 15 | 30;

export interface PushNotificationPreferences {
  enabled: boolean;
  notify_medications: boolean;
  notify_meals: boolean;
  notify_activities: boolean;
  lead_minutes: NotificationLeadMinutes;
}

export const DEFAULT_PUSH_PREFERENCES: PushNotificationPreferences = {
  enabled: true,
  notify_medications: true,
  notify_meals: true,
  notify_activities: true,
  lead_minutes: 0,
};

export interface ActivityMilestoneAlert {
  id: string;
  activity: ActivityScheduleLike & {
    id: string;
    title: string;
    scheduled_date: string;
    scheduled_time?: string | null;
    category?: string | null;
    notes?: string | null;
  };
  daysUntil: ActivityMilestoneDays;
  notificationType: 'activity_7d' | 'activity_3d' | 'activity_1d';
  badgeLabel: string;
  headline: string;
  detail: string;
  scheduledDate: string;
}

type MinimalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function resolveStorage(customStorage?: MinimalStorage | null): MinimalStorage | null {
  if (customStorage) return customStorage;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof localStorage !== 'undefined') {
      return localStorage;
    }
  } catch {}
  return null;
}

export function isActivityMilestoneDays(days: number): days is ActivityMilestoneDays {
  return days === 7 || days === 3 || days === 1;
}

export function getActivityMilestoneBadge(daysUntil: ActivityMilestoneDays): string {
  if (daysUntil === 1) return 'Falta 1 dia';
  return `Faltam ${daysUntil} dias`;
}

export function getActivityMilestoneType(
  daysUntil: ActivityMilestoneDays
): 'activity_7d' | 'activity_3d' | 'activity_1d' {
  if (daysUntil === 7) return 'activity_7d';
  if (daysUntil === 3) return 'activity_3d';
  return 'activity_1d';
}

/**
 * Extracts exact 7-day, 3-day, and 1-day advance milestone alerts for active scheduled activities.
 */
export function getActivityMilestoneNotifications(
  activities: ActivityScheduleLike[],
  todayDateStr: string
): ActivityMilestoneAlert[] {
  const alerts: ActivityMilestoneAlert[] = [];

  for (const act of activities) {
    if (!act || act.active === false) continue;
    if (act.schedule_type !== 'one_time' || !act.scheduled_date || !act.id) continue;

    const daysUntil = diffDaysBetweenDates(todayDateStr, act.scheduled_date);
    if (!Number.isFinite(daysUntil) || !isActivityMilestoneDays(daysUntil)) continue;

    const timeText = act.scheduled_time ? formatTime(act.scheduled_time) : '09:00';
    const dateBR = formatShortDateBR(act.scheduled_date);
    const categoryLabel = getActivityCategoryLabel(act.category);
    const badgeLabel = getActivityMilestoneBadge(daysUntil);

    alerts.push({
      id: `${act.id}:${daysUntil}d:${act.scheduled_date}`,
      activity: act as ActivityMilestoneAlert['activity'],
      daysUntil,
      notificationType: getActivityMilestoneType(daysUntil),
      badgeLabel,
      headline: `${badgeLabel} · ${act.title || 'Atividade programada'}`,
      detail: `${categoryLabel} em ${dateBR} às ${timeText}`,
      scheduledDate: act.scheduled_date,
    });
  }

  alerts.sort((a, b) => {
    if (a.daysUntil !== b.daysUntil) return a.daysUntil - b.daysUntil;
    return String(a.activity.scheduled_time || '').localeCompare(
      String(b.activity.scheduled_time || '')
    );
  });

  return alerts;
}

export function getActivityMilestoneDismissKey(
  userId: string,
  patientId: string,
  activityId: string,
  daysUntil: ActivityMilestoneDays,
  scheduledDate: string
): string {
  return `${ACTIVITY_MILESTONE_DISMISS_PREFIX}:${userId}:${patientId}:${activityId}:${daysUntil}d:${scheduledDate}`;
}

export function isActivityMilestoneDismissed(
  userId?: string | null,
  patientId?: string | null,
  alert?: Pick<ActivityMilestoneAlert, 'daysUntil' | 'scheduledDate'> & {
    activity: { id: string };
  },
  customStorage?: MinimalStorage | null
): boolean {
  if (!userId || !patientId || !alert?.activity?.id) return false;
  const storage = resolveStorage(customStorage);
  if (!storage) return false;

  try {
    const key = getActivityMilestoneDismissKey(
      userId,
      patientId,
      alert.activity.id,
      alert.daysUntil,
      alert.scheduledDate
    );
    return storage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function dismissActivityMilestone(
  userId?: string | null,
  patientId?: string | null,
  alert?: Pick<ActivityMilestoneAlert, 'daysUntil' | 'scheduledDate'> & {
    activity: { id: string };
  },
  customStorage?: MinimalStorage | null
): boolean {
  if (!userId || !patientId || !alert?.activity?.id) return false;
  const storage = resolveStorage(customStorage);
  if (!storage || typeof storage.setItem !== 'function') return false;

  try {
    const key = getActivityMilestoneDismissKey(
      userId,
      patientId,
      alert.activity.id,
      alert.daysUntil,
      alert.scheduledDate
    );
    storage.setItem(key, '1');
    return true;
  } catch {
    return false;
  }
}

export function filterActiveMilestoneAlerts(
  alerts: ActivityMilestoneAlert[],
  userId?: string | null,
  patientId?: string | null,
  customStorage?: MinimalStorage | null
): ActivityMilestoneAlert[] {
  return alerts.filter(
    (alert) => !isActivityMilestoneDismissed(userId, patientId, alert, customStorage)
  );
}

/**
 * Checks if a HH:MM(:SS) scheduled time falls within [trigger, trigger + windowMinutes],
 * where trigger = scheduledMinutes - leadMinutes.
 */
export function isTimeWithinNotificationWindow(
  scheduledTime: string | null | undefined,
  currentMinutesOfDay: number,
  leadMinutes = 0,
  windowMinutes = 14
): boolean {
  if (!scheduledTime) return false;
  const match = /^(\d{1,2}):(\d{2})/.exec(scheduledTime.trim());
  if (!match) return false;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return false;

  const scheduledMinutes = hh * 60 + mm;
  const triggerMinutes = scheduledMinutes - Math.max(0, leadMinutes);
  return currentMinutesOfDay >= triggerMinutes && currentMinutesOfDay <= triggerMinutes + windowMinutes;
}

/**
 * Converts a URL-safe Base64 VAPID public key into a Uint8Array for PushManager.subscribe().
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const clean = base64String.trim();
  const padding = '='.repeat((4 - (clean.length % 4)) % 4);
  const base64 = (clean + padding).replace(/-/g, '+').replace(/_/g, '/');

  let rawData: string;
  if (typeof atob === 'function') {
    rawData = atob(base64);
  } else {
    rawData = Buffer.from(base64, 'base64').toString('binary');
  }

  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(binary, 'binary').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
