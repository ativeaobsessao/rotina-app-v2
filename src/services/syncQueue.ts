import { get, set } from 'idb-keyval';
import { supabase } from './supabase';

export const QUEUE_KEY = 'offline_mutation_queue';
const TAB_LOCK_KEY = 'duca_sync_tab_lock';
const TAB_LOCK_TTL_MS = 15_000;

export type SyncAction =
  | 'createMealLog'
  | 'updateMealLog'
  | 'createMedicationLog'
  | 'updateMedicationLog'
  | 'createDailyClosure'
  | 'deleteDailyClosure'
  | 'upsertDailyMoodLog';

export interface OfflinePhotoAttachment {
  bucket: 'meal-records';
  patientId: string;
  fileName: string;
  blob: Blob;
}

export interface SyncItem {
  id: string;
  action: SyncAction;
  payload: any;
  timestamp: number;
  status: 'pending' | 'failed';
  retryCount: number;
  lastError?: string | null;
  lastAttemptAt?: number | null;
  patientId?: string;
  eventDate?: string;
  userId?: string;
  localTempId?: string;
  expectedUpdatedAt?: string | null;
  offlinePhoto?: OfflinePhotoAttachment | null;
  oldPhotoPathToDelete?: string | null;
  _uploadedPhotoPath?: string | null;
}

export interface SyncProcessResult {
  processed: number;
  failed: number;
  remainingPending: number;
  remainingFailed: number;
  skippedDueToLock?: boolean;
  lastError?: string | null;
}

export interface SyncQueueAdapter {
  getQueue: () => Promise<SyncItem[]>;
  saveQueue: (items: SyncItem[]) => Promise<void>;
  getSessionUserId: () => Promise<string | null>;
  isOnline: () => boolean;
  client: any;
}

const defaultAdapter: SyncQueueAdapter = {
  getQueue: async () => ((await get<SyncItem[]>(QUEUE_KEY)) || []).map(normalizeSyncItem),
  saveQueue: async (items: SyncItem[]) => {
    await set(QUEUE_KEY, items);
  },
  getSessionUserId: async () => {
    try {
      const { data } = await supabase.auth.getSession();
      return data?.session?.user?.id || null;
    } catch {
      return null;
    }
  },
  isOnline: () => (typeof navigator !== 'undefined' ? navigator.onLine : true),
  client: supabase,
};

function normalizeSyncItem(raw: any): SyncItem {
  return {
    id: raw?.id || generateId(),
    action: raw?.action,
    payload: raw?.payload,
    timestamp: typeof raw?.timestamp === 'number' ? raw.timestamp : Date.now(),
    status: raw?.status === 'failed' ? 'failed' : 'pending',
    retryCount: typeof raw?.retryCount === 'number' ? raw.retryCount : 0,
    lastError: raw?.lastError ?? null,
    lastAttemptAt: raw?.lastAttemptAt ?? null,
    patientId: raw?.patientId || raw?.payload?.patient_id,
    eventDate: raw?.eventDate || raw?.payload?.event_date || raw?.payload?.date,
    userId: raw?.userId,
    localTempId: raw?.localTempId,
    expectedUpdatedAt: raw?.expectedUpdatedAt ?? null,
    offlinePhoto: raw?.offlinePhoto ?? null,
    oldPhotoPathToDelete: raw?.oldPhotoPathToDelete ?? null,
    _uploadedPhotoPath: raw?._uploadedPhotoPath ?? null,
  };
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sync_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// Serializes all read-modify-write mutations to IndexedDB queue
let queueWriteChain: Promise<any> = Promise.resolve();

function withQueueWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = queueWriteChain.then(fn, fn);
  queueWriteChain = next.catch(() => {});
  return next;
}

const queueListeners = new Set<() => void>();

export function subscribeSyncQueueChange(listener: () => void): () => void {
  queueListeners.add(listener);
  return () => {
    queueListeners.delete(listener);
  };
}

function notifyQueueListeners() {
  queueListeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

export interface AddToSyncQueueOptions {
  patientId?: string;
  eventDate?: string;
  userId?: string;
  localTempId?: string;
  expectedUpdatedAt?: string | null;
  offlinePhoto?: OfflinePhotoAttachment | null;
  oldPhotoPathToDelete?: string | null;
  uploadedPhotoPath?: string | null;
}

export async function addToSyncQueue(
  action: SyncAction,
  payload: any,
  options: AddToSyncQueueOptions = {},
  adapter: SyncQueueAdapter = defaultAdapter
): Promise<string> {
  const itemId = await withQueueWriteLock(async () => {
    const queue = await adapter.getQueue();
    const patientId = options.patientId || payload?.patient_id;
    const eventDate = options.eventDate || payload?.event_date || payload?.date;

    // If editing a meal created offline while it's still pending in queue,
    // merge changes directly into the queued create item so update won't target a temp ID.
    if (action === 'updateMealLog' && payload?.id && String(payload.id).startsWith('offline_')) {
      const idx = queue.findIndex(
        (q) => q.action === 'createMealLog' && q.localTempId === payload.id && q.status === 'pending'
      );
      if (idx >= 0) {
        const { id: _ignored, ...updateFields } = payload;
        const prevUploadedPath = queue[idx]._uploadedPhotoPath;
        const replacingPhoto = options.offlinePhoto !== undefined;
        const nextOldToDelete =
          replacingPhoto && prevUploadedPath
            ? prevUploadedPath
            : options.oldPhotoPathToDelete !== undefined
            ? options.oldPhotoPathToDelete
            : queue[idx].oldPhotoPathToDelete;

        queue[idx] = {
          ...queue[idx],
          payload: { ...queue[idx].payload, ...updateFields },
          offlinePhoto: replacingPhoto ? options.offlinePhoto : queue[idx].offlinePhoto,
          oldPhotoPathToDelete: nextOldToDelete,
          _uploadedPhotoPath: replacingPhoto ? null : prevUploadedPath,
          timestamp: Date.now(),
        };
        await adapter.saveQueue(queue);
        return queue[idx].id;
      }
    }

    if (action === 'updateMedicationLog' && payload?.id && String(payload.id).startsWith('offline_')) {
      const idx = queue.findIndex(
        (q) => q.action === 'createMedicationLog' && q.localTempId === payload.id && q.status === 'pending'
      );
      if (idx >= 0) {
        const { id: _ignored, ...updateFields } = payload;
        queue[idx] = {
          ...queue[idx],
          payload: { ...queue[idx].payload, ...updateFields },
          timestamp: Date.now(),
        };
        await adapter.saveQueue(queue);
        return queue[idx].id;
      }
    }

    // Coalesce subsequent upsertDailyMoodLog for same patient+date if pending
    if (action === 'upsertDailyMoodLog' && patientId && eventDate) {
      const idx = queue.findIndex(
        (q) =>
          q.action === 'upsertDailyMoodLog' &&
          q.patientId === patientId &&
          q.eventDate === eventDate &&
          q.status === 'pending'
      );
      if (idx >= 0) {
        queue[idx] = {
          ...queue[idx],
          payload: { ...queue[idx].payload, ...payload },
          timestamp: Date.now(),
        };
        await adapter.saveQueue(queue);
        return queue[idx].id;
      }
    }

    const newItem: SyncItem = {
      id: generateId(),
      action,
      payload,
      timestamp: Date.now(),
      status: 'pending',
      retryCount: 0,
      lastError: null,
      lastAttemptAt: null,
      patientId,
      eventDate,
      userId: options.userId,
      localTempId: options.localTempId,
      expectedUpdatedAt: options.expectedUpdatedAt ?? null,
      offlinePhoto: options.offlinePhoto ?? null,
      oldPhotoPathToDelete: options.oldPhotoPathToDelete ?? null,
      _uploadedPhotoPath: options.uploadedPhotoPath ?? null,
    };

    queue.push(newItem);
    await adapter.saveQueue(queue);
    return newItem.id;
  });

  notifyQueueListeners();
  return itemId;
}

export async function getSyncQueue(adapter: SyncQueueAdapter = defaultAdapter): Promise<SyncItem[]> {
  return adapter.getQueue();
}

export async function clearQueueItem(id: string, adapter: SyncQueueAdapter = defaultAdapter) {
  await withQueueWriteLock(async () => {
    const queue = await adapter.getQueue();
    const updated = queue.filter((item) => item.id !== id);
    await adapter.saveQueue(updated);
  });
  notifyQueueListeners();
}

export async function retryFailedSyncItems(adapter: SyncQueueAdapter = defaultAdapter) {
  await withQueueWriteLock(async () => {
    const queue = await adapter.getQueue();
    const updated = queue.map((item) =>
      item.status === 'failed'
        ? { ...item, status: 'pending' as const, lastError: null }
        : item
    );
    await adapter.saveQueue(updated);
  });
  notifyQueueListeners();
}

export async function dismissFailedSyncItems(adapter: SyncQueueAdapter = defaultAdapter) {
  await withQueueWriteLock(async () => {
    const queue = await adapter.getQueue();
    const updated = queue.filter((item) => item.status !== 'failed');
    await adapter.saveQueue(updated);
  });
  notifyQueueListeners();
}

export function isPermanentSyncError(error: any): boolean {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = String(error.message || '').toLowerCase();

  // PostgreSQL / PostgREST permanent constraint, RLS, trigger, conflict or schema errors
  if (
    code === '42501' || // insufficient_privilege / RLS
    code === '23503' || // foreign_key_violation
    code === '23514' || // check_violation
    code === '22P02' || // invalid_text_representation
    code === '42703' || // undefined_column
    code === 'PGRST204' || // column not found in schema cache
    code === 'CONFLICT_23505' ||
    code === 'CONFLICT_STALE_UPDATE' ||
    code === 'ORPHAN_OFFLINE_ID'
  ) {
    return true;
  }

  if (
    msg.includes('row-level security') ||
    msg.includes('permission') ||
    msg.includes('já foi encerrado') ||
    msg.includes('apenas administradores') ||
    msg.includes('administrador') ||
    msg.includes('vínculo ativo') ||
    msg.includes('permissão ativa') ||
    msg.includes('outro cuidador') ||
    msg.includes('outro familiar')
  ) {
    return true;
  }

  return false;
}

export function formatSyncErrorMessage(error: any): string {
  const msg = String(error?.message || '');
  const lower = msg.toLowerCase();
  if (lower.includes('já foi encerrado')) {
    return 'Dia encerrado no servidor. Reabra o dia antes de sincronizar alterações.';
  }
  if (error?.code === '42501' || lower.includes('row-level security') || lower.includes('permission')) {
    return 'Sem permissão para salvar este registro na conta atual.';
  }
  if (error?.code === '23503') {
    return 'Item de rotina relacionado não existe mais no servidor.';
  }
  return msg || 'Erro desconhecido ao sincronizar com o servidor.';
}

function getScopeKey(item: SyncItem): string {
  return `${item.patientId || 'global'}:${item.eventDate || 'global'}`;
}

async function verifyDuplicateSatisfied(
  client: any,
  item: SyncItem
): Promise<{ status: 'match' | 'conflict' | 'missing'; existing?: any }> {
  try {
    if (item.action === 'createMealLog' && item.payload?.meal_config_id && item.payload?.event_date) {
      const { data, error } = await client
        .from('meal_logs')
        .select('*')
        .eq('meal_config_id', item.payload.meal_config_id)
        .eq('event_date', item.payload.event_date)
        .maybeSingle();
      if (error || !data?.id) return { status: 'missing' };
      const expectedOwner = item.payload?.created_by || item.userId;
      if (data.created_by && expectedOwner && data.created_by !== expectedOwner) {
        return { status: 'conflict', existing: data };
      }
      return { status: 'match', existing: data };
    }

    if (item.action === 'createMedicationLog' && item.payload?.medication_id && item.payload?.event_date) {
      const { data, error } = await client
        .from('medication_logs')
        .select('*')
        .eq('medication_id', item.payload.medication_id)
        .eq('event_date', item.payload.event_date)
        .maybeSingle();
      if (error || !data?.id) return { status: 'missing' };
      const expectedOwner = item.payload?.created_by || item.userId;
      if (data.created_by && expectedOwner && data.created_by !== expectedOwner) {
        return { status: 'conflict', existing: data };
      }
      return { status: 'match', existing: data };
    }

    if (item.action === 'createDailyClosure' && item.payload?.patient_id && item.payload?.date) {
      const { data, error } = await client
        .from('daily_closures')
        .select('*, closed_by_profile:profiles!daily_closures_closed_by_fkey(name)')
        .eq('patient_id', item.payload.patient_id)
        .eq('date', item.payload.date)
        .maybeSingle();
      if (error || !data?.id) return { status: 'missing' };
      // Daily closure is unique per (patient_id, date): preserves original closed_by idempotently
      return { status: 'match', existing: data };
    }
  } catch {
    return { status: 'missing' };
  }
  return { status: 'missing' };
}

async function syncLocalCacheAfterCommit(item: SyncItem, savedRow: any) {
  try {
    if (typeof indexedDB === 'undefined') return;
    const patientId = item.patientId || item.payload?.patient_id || savedRow?.patient_id;
    const eventDate = item.eventDate || item.payload?.event_date || item.payload?.date || savedRow?.event_date || savedRow?.date;
    if (!patientId || !eventDate) return;

    if ((item.action === 'createMealLog' || item.action === 'updateMealLog') && savedRow) {
      const key = `mealLogs_${patientId}_${eventDate}`;
      const current = (await get<any[]>(key)) || [];
      const filtered = current.filter(
        (x) => x.id !== savedRow.id && x.id !== item.localTempId && x.meal_config_id !== savedRow.meal_config_id
      );
      filtered.push(savedRow);
      await set(key, filtered);
    } else if ((item.action === 'createMedicationLog' || item.action === 'updateMedicationLog') && savedRow) {
      const key = `medLogs_${patientId}_${eventDate}`;
      const current = (await get<any[]>(key)) || [];
      const filtered = current.filter(
        (x) => x.id !== savedRow.id && x.id !== item.localTempId && x.medication_id !== savedRow.medication_id
      );
      filtered.push(savedRow);
      await set(key, filtered);
    } else if (item.action === 'createDailyClosure' && savedRow) {
      await set(`closure_${patientId}_${eventDate}`, savedRow);
    } else if (item.action === 'deleteDailyClosure') {
      await set(`closure_${patientId}_${eventDate}`, null);
    } else if (item.action === 'upsertDailyMoodLog' && savedRow) {
      await set(`mood_${patientId}_${eventDate}`, savedRow);
    }
  } catch {}
}

async function acquireCrossTabLock<T>(work: () => Promise<T>): Promise<{ acquired: boolean; result?: T }> {
  // Prefer Web Locks API when available in browser
  if (typeof navigator !== 'undefined' && (navigator as any).locks?.request) {
    let executed = false;
    let output: T | undefined;
    await (navigator as any).locks.request(
      'duca_sync_queue_lock',
      { ifAvailable: true },
      async (lock: any) => {
        if (!lock) return;
        executed = true;
        output = await work();
      }
    );
    return executed ? { acquired: true, result: output } : { acquired: false };
  }

  // Fallback cross-tab lease using localStorage with heartbeat renewal and abandoned-lock recovery
  if (typeof localStorage !== 'undefined') {
    const myToken = generateId();
    const now = Date.now();
    try {
      const raw = localStorage.getItem(TAB_LOCK_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.expiresAt > now) {
          return { acquired: false };
        }
      }
      localStorage.setItem(
        TAB_LOCK_KEY,
        JSON.stringify({ token: myToken, expiresAt: now + TAB_LOCK_TTL_MS })
      );
      const verify = JSON.parse(localStorage.getItem(TAB_LOCK_KEY) || '{}');
      if (verify?.token !== myToken) {
        return { acquired: false };
      }
    } catch {
      // Proceed cleanly if localStorage unavailable
    }

    const heartbeat = setInterval(() => {
      try {
        const current = JSON.parse(localStorage.getItem(TAB_LOCK_KEY) || '{}');
        if (current?.token === myToken) {
          localStorage.setItem(
            TAB_LOCK_KEY,
            JSON.stringify({ token: myToken, expiresAt: Date.now() + TAB_LOCK_TTL_MS })
          );
        }
      } catch {}
    }, Math.floor(TAB_LOCK_TTL_MS / 3));

    try {
      const result = await work();
      return { acquired: true, result };
    } finally {
      clearInterval(heartbeat);
      try {
        const current = JSON.parse(localStorage.getItem(TAB_LOCK_KEY) || '{}');
        if (current?.token === myToken) {
          localStorage.removeItem(TAB_LOCK_KEY);
        }
      } catch {}
    }
  }

  const result = await work();
  return { acquired: true, result };
}

let inFlightSyncPromise: Promise<SyncProcessResult> | null = null;

export async function processSyncQueue(
  options: { includeFailed?: boolean; adapter?: SyncQueueAdapter } = {}
): Promise<SyncProcessResult> {
  const adapter = options.adapter || defaultAdapter;

  // Single-flight mutex in current tab (only deduplicate when using default or active call)
  if (!options.adapter && inFlightSyncPromise) {
    return inFlightSyncPromise;
  }

  const run = async (): Promise<SyncProcessResult> => {
    if (!adapter.isOnline()) {
      const q = await adapter.getQueue();
      return {
        processed: 0,
        failed: 0,
        remainingPending: q.filter((i) => i.status === 'pending').length,
        remainingFailed: q.filter((i) => i.status === 'failed').length,
      };
    }

    const queueSnapshot = await adapter.getQueue();
    const runnableCount = queueSnapshot.filter(
      (i) => i.status === 'pending' || (options.includeFailed && i.status === 'failed')
    ).length;

    if (runnableCount === 0) {
      return {
        processed: 0,
        failed: 0,
        remainingPending: 0,
        remainingFailed: queueSnapshot.filter((i) => i.status === 'failed').length,
      };
    }

    const activeUserId = await adapter.getSessionUserId();
    if (!activeUserId) {
      return {
        processed: 0,
        failed: 0,
        remainingPending: queueSnapshot.filter((i) => i.status === 'pending').length,
        remainingFailed: queueSnapshot.filter((i) => i.status === 'failed').length,
      };
    }

    const lockRes = await acquireCrossTabLock(async () => {
      return runQueueCore(adapter, activeUserId, Boolean(options.includeFailed));
    });

    if (!lockRes.acquired || !lockRes.result) {
      const q = await adapter.getQueue();
      return {
        processed: 0,
        failed: 0,
        remainingPending: q.filter((i) => i.status === 'pending').length,
        remainingFailed: q.filter((i) => i.status === 'failed').length,
        skippedDueToLock: true,
      };
    }

    return lockRes.result;
  };

  if (options.adapter) {
    return run();
  }

  inFlightSyncPromise = run().finally(() => {
    inFlightSyncPromise = null;
  });

  return inFlightSyncPromise;
}

async function runQueueCore(
  adapter: SyncQueueAdapter,
  activeUserId: string,
  includeFailed: boolean
): Promise<SyncProcessResult> {
  const client = adapter.client;
  const blockedScopes = new Set<string>();
  let processed = 0;
  let failed = 0;
  let lastError: string | null = null;

  // Snapshot ordered IDs cleanly; mutate safely under withQueueWriteLock
  const initialQueue = await adapter.getQueue();

  for (const snapshotItem of initialQueue) {
    // Re-read current item state in case an earlier step modified it
    const currentQueue = await adapter.getQueue();
    const item = currentQueue.find((q) => q.id === snapshotItem.id);
    if (!item) continue;

    // Protect cross-user isolation: never sync mutations belonging to a different account
    if (item.userId && item.userId !== activeUserId) {
      continue;
    }

    const scopeKey = getScopeKey(item);

    if (item.status === 'failed' && !includeFailed) {
      blockedScopes.add(scopeKey);
      continue;
    }

    if (blockedScopes.has(scopeKey)) {
      continue;
    }

    try {
      let currentPayload = { ...item.payload };
      let uploadedPath = item._uploadedPhotoPath || null;

      // Step 1: Upload pending offline photo if present and not yet uploaded
      if (item.offlinePhoto && !uploadedPath) {
        const filePath = `${item.offlinePhoto.patientId}/${item.offlinePhoto.fileName}`;
        const { data: upData, error: upError } = await client.storage
          .from(item.offlinePhoto.bucket)
          .upload(filePath, item.offlinePhoto.blob, {
            upsert: false,
            contentType: item.offlinePhoto.blob.type || 'image/jpeg',
          });

        if (upError) {
          throw upError;
        }
        uploadedPath = upData?.path || filePath;
        currentPayload.photo_url = uploadedPath;

        // Checkpoint uploaded photo path so retry won't re-upload needlessly
        await withQueueWriteLock(async () => {
          const q = await adapter.getQueue();
          const idx = q.findIndex((x) => x.id === item.id);
          if (idx >= 0) {
            q[idx] = {
              ...q[idx],
              payload: { ...q[idx].payload, photo_url: uploadedPath },
              _uploadedPhotoPath: uploadedPath,
            };
            await adapter.saveQueue(q);
          }
        });
      }

      // Step 2: Execute DB operation AND ALWAYS verify { data, error }
      let dbResult: { data: any; error: any } = { data: null, error: null };

      if (item.action === 'createMealLog') {
        dbResult = await client.from('meal_logs').insert(currentPayload).select().maybeSingle();
      } else if (item.action === 'updateMealLog') {
        const { id, ...data } = currentPayload;
        if (String(id || '').startsWith('offline_')) {
          throw {
            code: 'ORPHAN_OFFLINE_ID',
            message: 'Registro original offline não foi criado no servidor antes desta atualização.',
          };
        }
        if (item.expectedUpdatedAt) {
          const { data: currentServer, error: checkErr } = await client
            .from('meal_logs')
            .select('id, updated_at, updated_by')
            .eq('id', id)
            .maybeSingle();
          if (checkErr) throw checkErr;
          if (
            currentServer?.updated_at &&
            currentServer.updated_at !== item.expectedUpdatedAt &&
            currentServer.updated_by &&
            currentServer.updated_by !== data.updated_by
          ) {
            throw {
              code: 'CONFLICT_STALE_UPDATE',
              message:
                'Outro cuidador atualizou esta refeição enquanto você estava offline. Descarte ou edite novamente após atualizar.',
            };
          }
        }
        dbResult = await client.from('meal_logs').update(data).eq('id', id).select().maybeSingle();
      } else if (item.action === 'createMedicationLog') {
        dbResult = await client.from('medication_logs').insert(currentPayload).select().maybeSingle();
      } else if (item.action === 'updateMedicationLog') {
        const { id, ...data } = currentPayload;
        if (String(id || '').startsWith('offline_')) {
          throw {
            code: 'ORPHAN_OFFLINE_ID',
            message: 'Registro original de medicamento não foi criado no servidor antes desta atualização.',
          };
        }
        if (item.expectedUpdatedAt) {
          const { data: currentServer, error: checkErr } = await client
            .from('medication_logs')
            .select('id, updated_at, updated_by')
            .eq('id', id)
            .maybeSingle();
          if (checkErr) throw checkErr;
          if (
            currentServer?.updated_at &&
            currentServer.updated_at !== item.expectedUpdatedAt &&
            currentServer.updated_by &&
            currentServer.updated_by !== data.updated_by
          ) {
            throw {
              code: 'CONFLICT_STALE_UPDATE',
              message:
                'Outro cuidador atualizou este medicamento enquanto você estava offline.',
            };
          }
        }
        dbResult = await client.from('medication_logs').update(data).eq('id', id).select().maybeSingle();
      } else if (item.action === 'createDailyClosure') {
        dbResult = await client.from('daily_closures').insert(currentPayload).select().maybeSingle();
      } else if (item.action === 'deleteDailyClosure') {
        dbResult = await client
          .from('daily_closures')
          .delete()
          .eq('patient_id', currentPayload.patient_id)
          .eq('date', currentPayload.date)
          .select('id');
        if (!dbResult.error) {
          const { data: stillExists, error: verifyErr } = await client
            .from('daily_closures')
            .select('id')
            .eq('patient_id', currentPayload.patient_id)
            .eq('date', currentPayload.date)
            .maybeSingle();
          if (verifyErr) {
            throw verifyErr;
          }
          if (stillExists) {
            throw {
              code: '42501',
              message:
                'Sem permissão DELETE no servidor para reabrir este dia em daily_closures.',
            };
          }
        }
      } else if (item.action === 'upsertDailyMoodLog') {
        dbResult = await client
          .from('daily_mood_logs')
          .upsert(
            {
              patient_id: currentPayload.patient_id,
              family_id: currentPayload.family_id,
              date: currentPayload.date,
              mood: currentPayload.mood,
              pain_level: currentPayload.pain_level,
              pain_locations: currentPayload.pain_locations || [],
              notes: currentPayload.notes || null,
              updated_by: currentPayload.updated_by || activeUserId,
              updated_at: currentPayload.updated_at || new Date().toISOString(),
            },
            { onConflict: 'patient_id,date' }
          )
          .select()
          .maybeSingle();
      }

      if (dbResult.error) {
        // Unique violation (23505): verify if server already committed THIS exact operation
        if (String(dbResult.error.code || '') === '23505') {
          const dupCheck = await verifyDuplicateSatisfied(client, item);
          if (dupCheck.status === 'match') {
            if (uploadedPath && dupCheck.existing?.photo_url !== uploadedPath) {
              try {
                await client.storage.from('meal-records').remove([uploadedPath]);
              } catch {}
            }
            await syncLocalCacheAfterCommit(item, dupCheck.existing);
            await clearQueueItem(item.id, adapter);
            processed += 1;
            continue;
          }
          if (dupCheck.status === 'conflict') {
            throw {
              code: 'CONFLICT_23505',
              message:
                'Outro cuidador já registrou esta atividade neste dia. Seu registro local foi mantido para revisão sem sobrescrever.',
            };
          }
        }
        throw dbResult.error;
      }

      // Step 3: Post-confirmation cleanup (old photo removal ONLY after DB confirmed)
      if (item.oldPhotoPathToDelete && item.oldPhotoPathToDelete !== currentPayload?.photo_url) {
        try {
          await client.storage.from('meal-records').remove([item.oldPhotoPathToDelete]);
        } catch (cleanupErr) {
          console.warn('Recoverable cleanup warning removing old photo:', cleanupErr);
        }
      }

      await syncLocalCacheAfterCommit(item, dbResult.data);

      // If this created a real DB row for an optimistic temp ID, rewrite dependent queued updates
      const createdServerId = dbResult.data?.id;
      await withQueueWriteLock(async () => {
        let q = await adapter.getQueue();
        q = q.filter((x) => x.id !== item.id);
        if (item.localTempId && createdServerId) {
          q = q.map((x) =>
            x.payload?.id === item.localTempId
              ? { ...x, payload: { ...x.payload, id: createdServerId } }
              : x
          );
        }
        await adapter.saveQueue(q);
      });
      notifyQueueListeners();
      processed += 1;
    } catch (err: any) {
      const permanent = isPermanentSyncError(err);
      const friendlyMsg = formatSyncErrorMessage(err);
      lastError = friendlyMsg;

      if (permanent) {
        // Clean up orphan uploaded offline photo if DB rejected permanently
        const curQ = await adapter.getQueue();
        const curItem = curQ.find((q) => q.id === item.id);
        if (curItem?._uploadedPhotoPath) {
          try {
            await client.storage.from('meal-records').remove([curItem._uploadedPhotoPath]);
          } catch {}
        }

        await withQueueWriteLock(async () => {
          const q = await adapter.getQueue();
          const idx = q.findIndex((x) => x.id === item.id);
          if (idx >= 0) {
            q[idx] = {
              ...q[idx],
              status: 'failed',
              retryCount: (q[idx].retryCount || 0) + 1,
              lastError: friendlyMsg,
              lastAttemptAt: Date.now(),
              _uploadedPhotoPath: null,
            };
            await adapter.saveQueue(q);
          }
        });
        notifyQueueListeners();
        failed += 1;
        blockedScopes.add(scopeKey);
      } else {
        // Transient network / timeout error: preserve item as pending, preserve FIFO order, stop loop
        await withQueueWriteLock(async () => {
          const q = await adapter.getQueue();
          const idx = q.findIndex((x) => x.id === item.id);
          if (idx >= 0) {
            q[idx] = {
              ...q[idx],
              status: 'pending',
              retryCount: (q[idx].retryCount || 0) + 1,
              lastError: friendlyMsg,
              lastAttemptAt: Date.now(),
            };
            await adapter.saveQueue(q);
          }
        });
        notifyQueueListeners();
        break;
      }
    }
  }

  const finalQueue = await adapter.getQueue();
  return {
    processed,
    failed,
    remainingPending: finalQueue.filter((i) => i.status === 'pending').length,
    remainingFailed: finalQueue.filter((i) => i.status === 'failed').length,
    lastError,
  };
}
