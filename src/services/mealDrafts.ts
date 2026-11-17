import { get, set, del, keys } from 'idb-keyval';

export const MEAL_DRAFT_KEY_PREFIX = 'meal_draft:';
export const LEGACY_MEAL_DRAFT_KEY = 'duca_meal_draft';
export const ACTIVE_MEAL_RECOVERY_KEY = 'duca_active_meal_recovery';
export const ACTIVE_FLOW_UNTIL_KEY = 'duca_active_flow_until';
export const CAMERA_INTENT_PENDING_KEY = 'duca_native_camera_pending';
export const PREFER_INAPP_CAMERA_KEY = 'duca_prefer_inapp_camera';

export const MEAL_DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const ACTIVE_RECOVERY_TTL_MS = 60 * 60 * 1000; // 1 hour
export const CAMERA_INTENT_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface MealDraftScope {
  userId: string;
  patientId: string;
  mealId: string;
  eventDate: string;
}

export interface MealDraftRecord extends MealDraftScope {
  version: 1;
  key: string;
  tab: 'today' | 'history';
  editingDateStr: string | null;
  consumption: 'normal' | 'partial' | 'none';
  description: string;
  drinkDescription: string;
  notes: string;
  mealTime: string;
  photoBlob: Blob | null;
  photoName: string | null;
  photoType: string | null;
  photoRemoved: boolean;
  uploadedPhotoPath: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface SaveMealDraftInput extends MealDraftScope {
  tab?: 'today' | 'history';
  editingDateStr?: string | null;
  consumption: 'normal' | 'partial' | 'none';
  description: string;
  drinkDescription: string;
  notes: string;
  mealTime: string;
  photoBlob: Blob | null;
  photoName?: string | null;
  photoType?: string | null;
  photoRemoved: boolean;
  uploadedPhotoPath?: string | null;
  markActiveRecovery?: boolean;
}

export interface ActiveMealRecoveryPointer extends MealDraftScope {
  tab: 'today' | 'history';
  editingDateStr: string | null;
  ts: number;
  expiresAt: number;
}

export interface MealDraftStorageAdapter {
  get: <T = any>(key: string) => Promise<T | undefined>;
  set: (key: string, value: any) => Promise<void>;
  del: (key: string) => Promise<void>;
  keys: () => Promise<IDBValidKey[]>;
}

const defaultStorageAdapter: MealDraftStorageAdapter = {
  get: async (key) => get(key),
  set: async (key, value) => set(key, value),
  del: async (key) => del(key),
  keys: async () => keys(),
};

function hasIndexedDbAvailable(adapter: MealDraftStorageAdapter): boolean {
  if (adapter !== defaultStorageAdapter) return true;
  return typeof indexedDB !== 'undefined';
}

export function buildMealDraftKey(scope: MealDraftScope): string {
  return `${MEAL_DRAFT_KEY_PREFIX}${scope.userId}:${scope.patientId}:${scope.mealId}:${scope.eventDate}`;
}

function isValidScope(scope: Partial<MealDraftScope> | null | undefined): scope is MealDraftScope {
  return Boolean(
    scope &&
      typeof scope.userId === 'string' &&
      scope.userId.trim() &&
      typeof scope.patientId === 'string' &&
      scope.patientId.trim() &&
      typeof scope.mealId === 'string' &&
      scope.mealId.trim() &&
      typeof scope.eventDate === 'string' &&
      scope.eventDate.trim()
  );
}

function isUsableBlob(val: unknown): val is Blob {
  return (
    typeof Blob !== 'undefined' &&
    val instanceof Blob &&
    typeof val.size === 'number' &&
    val.size > 0
  );
}

export function setActiveMealRecovery(
  scope: MealDraftScope & { tab?: 'today' | 'history'; editingDateStr?: string | null },
  now = Date.now()
): void {
  if (!isValidScope(scope)) return;
  const pointer: ActiveMealRecoveryPointer = {
    userId: scope.userId,
    patientId: scope.patientId,
    mealId: scope.mealId,
    eventDate: scope.eventDate,
    tab: scope.tab === 'history' ? 'history' : 'today',
    editingDateStr: scope.editingDateStr ?? null,
    ts: now,
    expiresAt: now + ACTIVE_RECOVERY_TTL_MS,
  };

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ACTIVE_MEAL_RECOVERY_KEY, JSON.stringify(pointer));
      localStorage.setItem(ACTIVE_FLOW_UNTIL_KEY, String(now + ACTIVE_RECOVERY_TTL_MS));
    }
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('duca_context_selected', '1');
    }
  } catch {}
}

export function readActiveMealRecovery(
  expectedUserId?: string | null,
  now = Date.now()
): ActiveMealRecoveryPointer | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(ACTIVE_MEAL_RECOVERY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveMealRecoveryPointer>;
    if (!isValidScope(parsed)) {
      localStorage.removeItem(ACTIVE_MEAL_RECOVERY_KEY);
      return null;
    }
    const pointer = parsed as Partial<ActiveMealRecoveryPointer> & MealDraftScope;
    if (typeof pointer.expiresAt !== 'number' || pointer.expiresAt <= now) {
      localStorage.removeItem(ACTIVE_MEAL_RECOVERY_KEY);
      return null;
    }
    if (expectedUserId && pointer.userId !== expectedUserId) {
      return null;
    }
    return {
      userId: pointer.userId,
      patientId: pointer.patientId,
      mealId: pointer.mealId,
      eventDate: pointer.eventDate,
      tab: pointer.tab === 'history' ? 'history' : 'today',
      editingDateStr: pointer.editingDateStr ?? null,
      ts: typeof pointer.ts === 'number' ? pointer.ts : now,
      expiresAt: pointer.expiresAt,
    };
  } catch {
    return null;
  }
}

export function clearActiveMealRecovery(matchScope?: Partial<MealDraftScope>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (matchScope) {
      const current = readActiveMealRecovery(undefined, 0);
      if (
        current &&
        ((matchScope.userId && current.userId !== matchScope.userId) ||
          (matchScope.patientId && current.patientId !== matchScope.patientId) ||
          (matchScope.mealId && current.mealId !== matchScope.mealId) ||
          (matchScope.eventDate && current.eventDate !== matchScope.eventDate))
      ) {
        return;
      }
    }
    localStorage.removeItem(ACTIVE_MEAL_RECOVERY_KEY);
    localStorage.removeItem(CAMERA_INTENT_PENDING_KEY);
    localStorage.removeItem(LEGACY_MEAL_DRAFT_KEY);
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(LEGACY_MEAL_DRAFT_KEY);
    }
  } catch {}
}

export function isInAppCameraPreferred(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(PREFER_INAPP_CAMERA_KEY) === '1';
  } catch {
    return false;
  }
}

export function setInAppCameraPreferred(preferred: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (preferred) {
      localStorage.setItem(PREFER_INAPP_CAMERA_KEY, '1');
    } else {
      localStorage.removeItem(PREFER_INAPP_CAMERA_KEY);
    }
  } catch {}
}

export function markNativeCameraPending(scope: MealDraftScope, now = Date.now()): void {
  if (!isValidScope(scope)) return;
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(
      CAMERA_INTENT_PENDING_KEY,
      JSON.stringify({
        userId: scope.userId,
        patientId: scope.patientId,
        mealId: scope.mealId,
        eventDate: scope.eventDate,
        ts: now,
        expiresAt: now + CAMERA_INTENT_TTL_MS,
      })
    );
  } catch {}
}

export function clearNativeCameraPending(matchScope?: Partial<MealDraftScope>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (matchScope) {
      const raw = localStorage.getItem(CAMERA_INTENT_PENDING_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<MealDraftScope>;
      if (
        (matchScope.userId && parsed.userId !== matchScope.userId) ||
        (matchScope.patientId && parsed.patientId !== matchScope.patientId) ||
        (matchScope.mealId && parsed.mealId !== matchScope.mealId) ||
        (matchScope.eventDate && parsed.eventDate !== matchScope.eventDate)
      ) {
        return;
      }
    }
    localStorage.removeItem(CAMERA_INTENT_PENDING_KEY);
  } catch {}
}

/**
 * Checks on cold mount whether the browser/PWA restarted while a native camera intent was open
 * for the given meal scope. If so, clears the pending flag, enables per-device in-app fallback,
 * and returns true so the UI can explain and offer the in-app camera immediately.
 */
export function consumePendingNativeCameraCrash(
  scope: MealDraftScope,
  now = Date.now()
): boolean {
  if (!isValidScope(scope)) return false;
  try {
    if (typeof localStorage === 'undefined') return false;
    const raw = localStorage.getItem(CAMERA_INTENT_PENDING_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Partial<MealDraftScope> & { expiresAt?: number };
    const matches =
      parsed.userId === scope.userId &&
      parsed.patientId === scope.patientId &&
      parsed.mealId === scope.mealId &&
      parsed.eventDate === scope.eventDate;
    if (!matches) return false;

    localStorage.removeItem(CAMERA_INTENT_PENDING_KEY);
    if (typeof parsed.expiresAt !== 'number' || parsed.expiresAt <= now) {
      return false;
    }

    setInAppCameraPreferred(true);
    return true;
  } catch {
    return false;
  }
}

export async function saveMealDraft(
  input: SaveMealDraftInput,
  adapter: MealDraftStorageAdapter = defaultStorageAdapter,
  now = Date.now()
): Promise<MealDraftRecord | null> {
  if (!isValidScope(input)) return null;

  const key = buildMealDraftKey(input);
  const existing = hasIndexedDbAvailable(adapter)
    ? await adapter.get<MealDraftRecord>(key).catch(() => undefined)
    : undefined;

  const safeBlob = isUsableBlob(input.photoBlob) ? input.photoBlob : null;
  const record: MealDraftRecord = {
    version: 1,
    key,
    userId: input.userId,
    patientId: input.patientId,
    mealId: input.mealId,
    eventDate: input.eventDate,
    tab: input.tab === 'history' ? 'history' : 'today',
    editingDateStr: input.editingDateStr ?? null,
    consumption: input.consumption,
    description: input.description,
    drinkDescription: input.drinkDescription,
    notes: input.notes,
    mealTime: input.mealTime,
    photoBlob: safeBlob,
    photoName: safeBlob ? input.photoName || (safeBlob as File).name || 'foto.jpg' : null,
    photoType: safeBlob ? input.photoType || safeBlob.type || 'image/jpeg' : null,
    photoRemoved: Boolean(input.photoRemoved),
    uploadedPhotoPath: input.uploadedPhotoPath ?? null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    expiresAt: now + MEAL_DRAFT_TTL_MS,
  };

  if (hasIndexedDbAvailable(adapter)) {
    await adapter.set(key, record);
  }

  if (input.markActiveRecovery !== false) {
    setActiveMealRecovery(
      {
        userId: input.userId,
        patientId: input.patientId,
        mealId: input.mealId,
        eventDate: input.eventDate,
        tab: record.tab,
        editingDateStr: record.editingDateStr,
      },
      now
    );
  }

  return record;
}

export async function getMealDraft(
  scope: MealDraftScope,
  adapter: MealDraftStorageAdapter = defaultStorageAdapter,
  now = Date.now()
): Promise<MealDraftRecord | null> {
  if (!isValidScope(scope) || !hasIndexedDbAvailable(adapter)) return null;

  const key = buildMealDraftKey(scope);
  try {
    const raw = await adapter.get<MealDraftRecord>(key);
    if (!raw || raw.version !== 1) return null;

    // Enforce strict isolation across user, patient, meal, and date
    if (
      raw.userId !== scope.userId ||
      raw.patientId !== scope.patientId ||
      raw.mealId !== scope.mealId ||
      raw.eventDate !== scope.eventDate
    ) {
      return null;
    }

    if (typeof raw.expiresAt !== 'number' || raw.expiresAt <= now) {
      await adapter.del(key).catch(() => {});
      clearActiveMealRecovery(scope);
      return null;
    }

    const usableBlob = isUsableBlob(raw.photoBlob) ? raw.photoBlob : null;
    return {
      ...raw,
      photoBlob: usableBlob,
      photoName: usableBlob ? raw.photoName || 'foto.jpg' : null,
      photoType: usableBlob ? raw.photoType || usableBlob.type || 'image/jpeg' : null,
      uploadedPhotoPath: raw.uploadedPhotoPath ?? null,
    };
  } catch {
    return null;
  }
}

export async function deleteMealDraft(
  scope: MealDraftScope,
  adapter: MealDraftStorageAdapter = defaultStorageAdapter
): Promise<void> {
  if (!isValidScope(scope)) return;
  const key = buildMealDraftKey(scope);
  if (hasIndexedDbAvailable(adapter)) {
    try {
      await adapter.del(key);
    } catch {}
  }
  clearActiveMealRecovery(scope);
}

/**
 * Finds a valid recoverable draft matching the active user, patient, and date.
 * Prefers the exact active recovery pointer if present, otherwise scans only scoped meal_draft:* keys.
 */
export async function findRecoverableMealDraftForDate(
  userId: string | undefined | null,
  patientId: string | undefined | null,
  eventDate: string | undefined | null,
  tab: 'today' | 'history' = 'today',
  adapter: MealDraftStorageAdapter = defaultStorageAdapter,
  now = Date.now()
): Promise<MealDraftRecord | null> {
  if (!userId || !patientId || !eventDate || !hasIndexedDbAvailable(adapter)) return null;

  const pointer = readActiveMealRecovery(userId, now);
  if (
    pointer &&
    pointer.patientId === patientId &&
    pointer.eventDate === eventDate &&
    pointer.tab === tab
  ) {
    const pointedDraft = await getMealDraft(pointer, adapter, now);
    if (pointedDraft) return pointedDraft;
  }

  const scopePrefix = `${MEAL_DRAFT_KEY_PREFIX}${userId}:${patientId}:`;
  try {
    const allKeys = await adapter.keys();
    let newest: MealDraftRecord | null = null;
    for (const rawKey of allKeys) {
      const k = String(rawKey);
      if (!k.startsWith(scopePrefix) || !k.endsWith(`:${eventDate}`)) continue;
      const draft = await adapter.get<MealDraftRecord>(k).catch(() => undefined);
      if (!draft || draft.version !== 1) continue;
      if (typeof draft.expiresAt !== 'number' || draft.expiresAt <= now) {
        await adapter.del(k).catch(() => {});
        continue;
      }
      if (
        draft.userId === userId &&
        draft.patientId === patientId &&
        draft.eventDate === eventDate &&
        draft.tab === tab
      ) {
        if (!newest || draft.updatedAt > newest.updatedAt) {
          newest = draft;
        }
      }
    }
    return newest;
  } catch {
    return null;
  }
}

/**
 * Removes expired meal drafts (`meal_draft:*`) without ever touching `offline_mutation_queue` or caches.
 */
export async function cleanupExpiredMealDrafts(
  now = Date.now(),
  adapter: MealDraftStorageAdapter = defaultStorageAdapter
): Promise<number> {
  if (!hasIndexedDbAvailable(adapter)) return 0;
  let removed = 0;
  try {
    const allKeys = await adapter.keys();
    for (const rawKey of allKeys) {
      const k = String(rawKey);
      if (!k.startsWith(MEAL_DRAFT_KEY_PREFIX)) continue;
      const record = await adapter.get<MealDraftRecord>(k).catch(() => undefined);
      const isExpired =
        !record ||
        record.version !== 1 ||
        typeof record.expiresAt !== 'number' ||
        record.expiresAt <= now;
      if (isExpired) {
        await adapter.del(k).catch(() => {});
        removed += 1;
      }
    }
  } catch {}
  return removed;
}

export function blobToFile(blob: Blob, fileName?: string | null, mimeType?: string | null): File {
  const safeName = fileName || (blob as File).name || `refeicao_${Date.now()}.jpg`;
  const safeType = mimeType || blob.type || 'image/jpeg';
  if (typeof File !== 'undefined' && blob instanceof File && blob.name === safeName && blob.type === safeType) {
    return blob;
  }
  return new File([blob], safeName, {
    type: safeType,
    lastModified: Date.now(),
  });
}
