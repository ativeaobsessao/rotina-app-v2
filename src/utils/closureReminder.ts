export const CLOSURE_REMINDER_DISMISS_PREFIX = 'duca_closure_reminder_dismissed';

type MinimalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

function resolveStorage(customStorage?: Pick<Storage, 'getItem'> | null): Pick<Storage, 'getItem'> | null {
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

export function getClosureReminderDismissKey(
  userId: string,
  patientId: string,
  localDate: string
): string {
  return `${CLOSURE_REMINDER_DISMISS_PREFIX}:${userId}:${patientId}:${localDate}`;
}

export function isClosureReminderDismissed(
  userId?: string | null,
  patientId?: string | null,
  localDate?: string | null,
  customStorage?: Pick<Storage, 'getItem'> | null
): boolean {
  if (!userId || !patientId || !localDate) return false;
  const storage = resolveStorage(customStorage);
  if (!storage) return false;

  try {
    const key = getClosureReminderDismissKey(userId, patientId, localDate);
    return storage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function dismissClosureReminder(
  userId?: string | null,
  patientId?: string | null,
  localDate?: string | null,
  customStorage?: MinimalStorage | null
): boolean {
  if (!userId || !patientId || !localDate) return false;
  const storage = resolveStorage(customStorage) as MinimalStorage | null;
  if (!storage || typeof storage.setItem !== 'function') return false;

  try {
    const currentKey = getClosureReminderDismissKey(userId, patientId, localDate);
    storage.setItem(currentKey, '1');

    // Prune stale daily dismissal keys for the same user+patient from previous days
    const scopePrefix = `${CLOSURE_REMINDER_DISMISS_PREFIX}:${userId}:${patientId}:`;
    if (typeof storage.length === 'number' && typeof storage.key === 'function' && typeof storage.removeItem === 'function') {
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

export interface ClosureReminderVisibilityParams {
  canCloseDay?: boolean;
  isAdmin?: boolean;
  isViewingToday: boolean;
  isDayClosed: boolean;
  isAfterReminderTime: boolean;
  isDismissed: boolean;
}

export function shouldShowClosureReminderBanner({
  canCloseDay,
  isAdmin,
  isViewingToday,
  isDayClosed,
  isAfterReminderTime,
  isDismissed,
}: ClosureReminderVisibilityParams): boolean {
  const hasPermission = canCloseDay ?? Boolean(isAdmin);
  return Boolean(
    hasPermission &&
      isViewingToday &&
      !isDayClosed &&
      isAfterReminderTime &&
      !isDismissed
  );
}
