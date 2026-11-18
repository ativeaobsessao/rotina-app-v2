export const UPCOMING_ACTIVITY_DISMISS_PREFIX = 'duca_upcoming_activity_banner_dismissed';

type MinimalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

function resolveStorage(
  customStorage?: Pick<Storage, 'getItem'> | null
): Pick<Storage, 'getItem'> | null {
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

export function getUpcomingActivityDismissKey(
  userId: string,
  patientId: string,
  localDate: string
): string {
  return `${UPCOMING_ACTIVITY_DISMISS_PREFIX}:${userId}:${patientId}:${localDate}`;
}

export function buildUpcomingActivitySignature(
  activities: Array<{ id?: string; scheduled_date?: string | null }>
): string {
  if (!activities || activities.length === 0) return '';
  return activities
    .map((a) => `${a.id || 'unknown'}@${a.scheduled_date || ''}`)
    .sort()
    .join('|');
}

export function isUpcomingActivityBannerDismissed(
  userId?: string | null,
  patientId?: string | null,
  localDate?: string | null,
  activities: Array<{ id?: string; scheduled_date?: string | null }> = [],
  customStorage?: Pick<Storage, 'getItem'> | null
): boolean {
  if (activities.length === 0) return true;
  if (!userId || !patientId || !localDate) return false;

  const storage = resolveStorage(customStorage);
  if (!storage) return false;

  try {
    const key = getUpcomingActivityDismissKey(userId, patientId, localDate);
    const saved = storage.getItem(key);
    if (!saved) return false;
    return saved === buildUpcomingActivitySignature(activities);
  } catch {
    return false;
  }
}

export function dismissUpcomingActivityBanner(
  userId?: string | null,
  patientId?: string | null,
  localDate?: string | null,
  activities: Array<{ id?: string; scheduled_date?: string | null }> = [],
  customStorage?: MinimalStorage | null
): boolean {
  if (!userId || !patientId || !localDate) return false;
  const storage = resolveStorage(customStorage) as MinimalStorage | null;
  if (!storage || typeof storage.setItem !== 'function') return false;

  try {
    const currentKey = getUpcomingActivityDismissKey(userId, patientId, localDate);
    const signature = buildUpcomingActivitySignature(activities) || '1';
    storage.setItem(currentKey, signature);

    // Prune stale daily dismissal keys for the same user+patient from previous days
    const scopePrefix = `${UPCOMING_ACTIVITY_DISMISS_PREFIX}:${userId}:${patientId}:`;
    if (
      typeof storage.length === 'number' &&
      typeof storage.key === 'function' &&
      typeof storage.removeItem === 'function'
    ) {
      const staleKeys: string[] = [];
      for (let i = 0; i < storage.length; i += 1) {
        const k = storage.key(i);
        if (k && k.startsWith(scopePrefix) && k !== currentKey) {
          staleKeys.push(k);
        }
      }
      staleKeys.forEach((k) => storage.removeItem(k));
    }

    return true;
  } catch {
    return false;
  }
}

export interface UpcomingActivityBannerVisibilityParams {
  isViewingToday: boolean;
  isDayClosed: boolean;
  upcomingCount: number;
  isDismissed: boolean;
}

export function shouldShowUpcomingActivityBanner({
  isViewingToday,
  isDayClosed,
  upcomingCount,
  isDismissed,
}: UpcomingActivityBannerVisibilityParams): boolean {
  return Boolean(isViewingToday && !isDayClosed && upcomingCount > 0 && !isDismissed);
}
