import { get, set, del, keys } from 'idb-keyval';
import { addToSyncQueue, QUEUE_KEY, type OfflinePhotoAttachment } from './syncQueue';
import { supabase } from './supabase';
import type { Database } from '../types/database.types';
import { getLocalDateString } from '../utils/date';

const SIGNED_URL_TTL_MS = 6 * 24 * 60 * 60 * 1000; // 6 dias (margem segura sobre 7 dias)
const SIGNED_URL_REFRESH_BUFFER_MS = 60 * 60 * 1000; // renova se faltar menos de 1h

type Profile = Database['public']['Tables']['profiles']['Row'];

// Track stale cache usage so UI can inform when showing offline/contingent fallback data
let lastFetchUsedStaleCache = false;
const staleListeners = new Set<(isStale: boolean) => void>();

export function isUsingStaleCache(): boolean {
  return lastFetchUsedStaleCache;
}

export function subscribeStaleCache(listener: (isStale: boolean) => void): () => void {
  staleListeners.add(listener);
  return () => staleListeners.delete(listener);
}

function setStaleCacheState(isStale: boolean) {
  if (lastFetchUsedStaleCache !== isStale) {
    lastFetchUsedStaleCache = isStale;
    staleListeners.forEach((fn) => {
      try {
        fn(isStale);
      } catch {}
    });
  }
}

export function isTransientNetworkError(err: any): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  if (!err) return false;
  const msg = String(err?.message || err || '').toLowerCase();
  const name = String(err?.name || '').toLowerCase();
  const code = String(err?.code || '');

  // Never treat RLS, permission, closed-day trigger or Postgres constraint errors as transient network issues
  if (
    code === '42501' ||
    code === '23503' ||
    code === '23505' ||
    code === '23514' ||
    code === '42703' ||
    code === 'PGRST204' ||
    msg.includes('row-level security') ||
    msg.includes('permission') ||
    msg.includes('já foi encerrado') ||
    msg.includes('administrador')
  ) {
    return false;
  }

  return (
    name === 'aborterror' ||
    name === 'typeerror' ||
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('fetch') ||
    msg.includes('timeout') ||
    msg.includes('load failed') ||
    msg.includes('offline')
  );
}

interface FetchWithCacheOptions {
  throwIfNoCacheWhenOnline?: boolean;
}

async function fetchWithCache<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  fallbackValue: T,
  options: FetchWithCacheOptions = {}
): Promise<T> {
  const { throwIfNoCacheWhenOnline = true } = options;
  const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;

  if (isOnline) {
    try {
      const data = await fetcher();
      await set(cacheKey, data);
      setStaleCacheState(false);
      return data;
    } catch (err) {
      const cached = await get<T>(cacheKey);
      if (cached !== undefined) {
        console.warn('Network fetch failed, using cached contingency data for', cacheKey);
        setStaleCacheState(true);
        return cached;
      }
      if (throwIfNoCacheWhenOnline) {
        throw err;
      }
      return fallbackValue;
    }
  } else {
    const cached = await get<T>(cacheKey);
    if (cached !== undefined) {
      setStaleCacheState(true);
      return cached;
    }
    return fallbackValue;
  }
}

// Controlled concurrency helper for parallel photo resolution
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  const safeLimit = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;

  async function runWorker() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) break;
      results[idx] = await worker(items[idx], idx);
    }
  }

  await Promise.all(Array.from({ length: safeLimit }, () => runWorker()));
  return results;
}

// In-memory short-lived cache for signed URLs + de-duplication of concurrent requests
const signedUrlMemoryCache = new Map<string, { url: string; expiresAt: number }>();
const pendingSignedUrlRequests = new Map<string, Promise<string | null>>();

// --- AUTH & PROFILES ---

export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  return user;
}

async function getCurrentSessionUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id || null;
  } catch {
    return null;
  }
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const sessionUserId = await getCurrentSessionUserId();
  const cacheKey = sessionUserId ? `currentProfile_${sessionUserId}` : 'currentProfile';

  return fetchWithCache<Profile | null>(
    cacheKey,
    async () => {
      const user = await getCurrentUser();
      if (!user) return null;

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        await set(`currentProfile_${user.id}`, data);
      }
      return data as Profile | null;
    },
    null,
    { throwIfNoCacheWhenOnline: true }
  );
}

// --- CONFIGURATION ---

export async function getPatient(familyId: string): Promise<any> {
  return fetchWithCache(
    `patient_${familyId}`,
    async () => {
      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .eq('family_id', familyId)
        .maybeSingle();

      if (error) throw error;
      return data || null;
    },
    null,
    { throwIfNoCacheWhenOnline: true }
  );
}

export async function getMealConfigs(patientId: string): Promise<any[]> {
  return fetchWithCache(
    `mealConfigs_${patientId}`,
    async () => {
      const { data, error } = await supabase
        .from('meal_configs')
        .select('*')
        .eq('patient_id', patientId)
        .eq('active', true)
        .order('display_order', { ascending: true });

      if (error) throw error;
      return data || [];
    },
    [],
    { throwIfNoCacheWhenOnline: true }
  );
}

export async function getMedicationPeriods(patientId: string): Promise<any[]> {
  return fetchWithCache(
    `medPeriods_${patientId}`,
    async () => {
      const { data, error } = await supabase
        .from('medication_periods')
        .select('*')
        .eq('patient_id', patientId)
        .eq('active', true)
        .order('display_order', { ascending: true });

      if (error) throw error;
      return data || [];
    },
    [],
    { throwIfNoCacheWhenOnline: true }
  );
}

export async function getMedications(patientId: string): Promise<any[]> {
  return fetchWithCache(
    `medications_${patientId}`,
    async () => {
      const { data, error } = await supabase
        .from('medications')
        .select('*')
        .eq('patient_id', patientId)
        .eq('active', true);

      if (error) throw error;
      return data || [];
    },
    [],
    { throwIfNoCacheWhenOnline: true }
  );
}

// --- DAILY CLOSURES ---

export async function getDailyClosure(patientId: string, date: string) {
  return fetchWithCache(
    `closure_${patientId}_${date}`,
    async () => {
      const { data, error } = await supabase
        .from('daily_closures')
        .select('*, closed_by_profile:profiles!daily_closures_closed_by_fkey(name)')
        .eq('patient_id', patientId)
        .eq('date', date)
        .maybeSingle();

      if (error) throw error;
      return data || null;
    },
    null,
    { throwIfNoCacheWhenOnline: false }
  );
}

export async function getHistoricalDailyClosures(
  patientId: string,
  beforeDate: string,
  startDate?: string
): Promise<any[]> {
  let query = supabase
    .from('daily_closures')
    .select('*, closed_by_profile:profiles!daily_closures_closed_by_fkey(name)')
    .eq('patient_id', patientId)
    .lt('date', beforeDate)
    .order('date', { ascending: false });

  if (startDate) {
    query = query.gte('date', startDate);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[getHistoricalDailyClosures] error:', error.code, error.message);
    throw error;
  }
  return data ?? [];
}

export interface ClosureActionResult {
  success: boolean;
  queued?: boolean;
  alreadyClosed?: boolean;
  closure?: any;
  error?: string;
}

export async function createDailyClosure(
  familyId: string,
  patientId: string,
  date: string,
  closedBy: string
): Promise<ClosureActionResult> {
  const payload = {
    family_id: familyId,
    patient_id: patientId,
    date,
    status: 'closed',
    closed_by: closedBy,
  };

  const buildOptimistic = () => ({
    ...payload,
    id: `offline_closure_${patientId}_${date}`,
    closed_at: new Date().toISOString(),
    _syncPending: true,
  });

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const userId = await getCurrentSessionUserId();
    await addToSyncQueue('createDailyClosure', payload, {
      patientId,
      eventDate: date,
      userId: userId || closedBy,
    });
    const optimistic = buildOptimistic();
    await set(`closure_${patientId}_${date}`, optimistic);
    return { success: true, queued: true, closure: optimistic };
  }

  try {
    const { data, error } = await supabase
      .from('daily_closures')
      .insert([payload] as any)
      .select('*, closed_by_profile:profiles!daily_closures_closed_by_fkey(name)')
      .single();

    if (error) {
      // Idempotência para unique(patient_id, date): nunca sobrescreve closed_by original
      if (String(error.code || '') === '23505') {
        const { data: existing, error: fetchErr } = await supabase
          .from('daily_closures')
          .select('*, closed_by_profile:profiles!daily_closures_closed_by_fkey(name)')
          .eq('patient_id', patientId)
          .eq('date', date)
          .maybeSingle();

        if (!fetchErr && existing) {
          await set(`closure_${patientId}_${date}`, existing);
          return { success: true, alreadyClosed: true, closure: existing };
        }
      }

      if (isTransientNetworkError(error)) {
        const userId = await getCurrentSessionUserId();
        await addToSyncQueue('createDailyClosure', payload, {
          patientId,
          eventDate: date,
          userId: userId || closedBy,
        });
        const optimistic = buildOptimistic();
        await set(`closure_${patientId}_${date}`, optimistic);
        return { success: true, queued: true, closure: optimistic };
      }

      return { success: false, error: error.message || 'Erro ao encerrar o dia.' };
    }

    await set(`closure_${patientId}_${date}`, data);
    return { success: true, closure: data };
  } catch (err: any) {
    if (isTransientNetworkError(err)) {
      const userId = await getCurrentSessionUserId();
      await addToSyncQueue('createDailyClosure', payload, {
        patientId,
        eventDate: date,
        userId: userId || closedBy,
      });
      const optimistic = buildOptimistic();
      await set(`closure_${patientId}_${date}`, optimistic);
      return { success: true, queued: true, closure: optimistic };
    }
    return { success: false, error: err?.message || 'Erro ao encerrar o dia.' };
  }
}

export async function deleteDailyClosure(
  patientId: string,
  date: string
): Promise<ClosureActionResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const userId = await getCurrentSessionUserId();
    await addToSyncQueue(
      'deleteDailyClosure',
      { patient_id: patientId, date },
      { patientId, eventDate: date, userId: userId || undefined }
    );
    await set(`closure_${patientId}_${date}`, null);
    return { success: true, queued: true };
  }

  try {
    const { error } = await supabase
      .from('daily_closures')
      .delete()
      .eq('patient_id', patientId)
      .eq('date', date);

    if (error) {
      if (isTransientNetworkError(error)) {
        const userId = await getCurrentSessionUserId();
        await addToSyncQueue(
          'deleteDailyClosure',
          { patient_id: patientId, date },
          { patientId, eventDate: date, userId: userId || undefined }
        );
        await set(`closure_${patientId}_${date}`, null);
        return { success: true, queued: true };
      }
      return { success: false, error: error.message || 'Erro ao reabrir o dia.' };
    }

    // Verifica se o registro realmente foi removido (protege contra bloqueio silencioso de RLS)
    const { data: stillExists } = await supabase
      .from('daily_closures')
      .select('id')
      .eq('patient_id', patientId)
      .eq('date', date)
      .maybeSingle();

    if (stillExists) {
      return {
        success: false,
        error: 'Não foi possível reabrir o dia no servidor (permissão DELETE necessária em daily_closures).',
      };
    }

    await set(`closure_${patientId}_${date}`, null);
    return { success: true };
  } catch (err: any) {
    if (isTransientNetworkError(err)) {
      const userId = await getCurrentSessionUserId();
      await addToSyncQueue(
        'deleteDailyClosure',
        { patient_id: patientId, date },
        { patientId, eventDate: date, userId: userId || undefined }
      );
      await set(`closure_${patientId}_${date}`, null);
      return { success: true, queued: true };
    }
    return { success: false, error: err?.message || 'Erro ao reabrir o dia.' };
  }
}

// --- DAILY MOOD & PAIN LOGS ---

export interface DailyMoodLog {
  id?: string;
  patient_id: string;
  family_id: string;
  date: string;
  mood: 'happy' | 'calm' | 'tired' | 'sad' | 'agitated';
  pain_level: 'none' | 'mild' | 'moderate' | 'severe';
  pain_locations: string[];
  notes?: string | null;
  updated_by?: string | null;
  updater?: { name: string } | null;
  created_at?: string;
  updated_at?: string;
  _syncPending?: boolean;
}

function updateCachedContextMood(log: DailyMoodLog) {
  try {
    const todayStr = getLocalDateString();
    if (log.date === todayStr) {
      const raw = localStorage.getItem('duca_cached_context_moods');
      const parsed = raw ? JSON.parse(raw) : null;
      const currentMoods = parsed?.date === todayStr && parsed?.moods ? parsed.moods : {};
      localStorage.setItem(
        'duca_cached_context_moods',
        JSON.stringify({
          date: todayStr,
          moods: { ...currentMoods, [log.patient_id]: log },
        })
      );
    }
  } catch {}
}

export async function getDailyMoodLog(patientId: string, date: string): Promise<DailyMoodLog | null> {
  return fetchWithCache(
    `mood_${patientId}_${date}`,
    async () => {
      const { data, error } = await (supabase as any)
        .from('daily_mood_logs')
        .select('*, updater:profiles!daily_mood_logs_updated_by_fkey(name)')
        .eq('patient_id', patientId)
        .eq('date', date)
        .maybeSingle();

      if (error) {
        if (isTransientNetworkError(error)) throw error;
        console.warn('Error fetching daily mood:', error.message);
        return null;
      }
      return data || null;
    },
    null,
    { throwIfNoCacheWhenOnline: false }
  );
}

export async function upsertDailyMoodLog(log: DailyMoodLog): Promise<DailyMoodLog | null> {
  const payload = {
    patient_id: log.patient_id,
    family_id: log.family_id,
    date: log.date,
    mood: log.mood,
    pain_level: log.pain_level,
    pain_locations: log.pain_locations || [],
    notes: log.notes || null,
    updated_by: log.updated_by || null,
    updated_at: new Date().toISOString(),
  };

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const userId = await getCurrentSessionUserId();
    await addToSyncQueue('upsertDailyMoodLog', payload, {
      patientId: log.patient_id,
      eventDate: log.date,
      userId: userId || log.updated_by || undefined,
    });
    const optimistic: DailyMoodLog = { ...payload, _syncPending: true };
    await set(`mood_${log.patient_id}_${log.date}`, optimistic);
    updateCachedContextMood(optimistic);
    return optimistic;
  }

  try {
    const { data, error } = await (supabase as any)
      .from('daily_mood_logs')
      .upsert(payload, { onConflict: 'patient_id,date' })
      .select('*, updater:profiles!daily_mood_logs_updated_by_fkey(name)')
      .single();

    if (error) throw error;
    await set(`mood_${log.patient_id}_${log.date}`, data);
    updateCachedContextMood(data);
    return data;
  } catch (err: any) {
    const isPermissionError =
      err?.code === '42501' ||
      String(err?.message || '').toLowerCase().includes('row-level security') ||
      String(err?.message || '').toLowerCase().includes('permission');
    if (isPermissionError) {
      throw new Error('Apenas contas Administrador podem registrar ou alterar o estado de bem-estar.');
    }

    if (isTransientNetworkError(err)) {
      const userId = await getCurrentSessionUserId();
      await addToSyncQueue('upsertDailyMoodLog', payload, {
        patientId: log.patient_id,
        eventDate: log.date,
        userId: userId || log.updated_by || undefined,
      });
      const optimistic: DailyMoodLog = { ...payload, _syncPending: true };
      await set(`mood_${log.patient_id}_${log.date}`, optimistic);
      updateCachedContextMood(optimistic);
      return optimistic;
    }

    throw err;
  }
}

export async function getHistoricalMoodLogs(
  patientId: string,
  beforeDate: string,
  afterDate: string
): Promise<DailyMoodLog[]> {
  try {
    const { data, error } = await (supabase as any)
      .from('daily_mood_logs')
      .select('*, updater:profiles!daily_mood_logs_updated_by_fkey(name)')
      .eq('patient_id', patientId)
      .lte('date', beforeDate)
      .gte('date', afterDate)
      .order('date', { ascending: false });

    if (error) {
      console.warn('Error fetching historical mood logs:', error.message);
      return [];
    }
    return data || [];
  } catch {
    return [];
  }
}

// --- LOGS ---

export async function getHistoricalMealLogs(
  patientId: string,
  beforeDate: string,
  startDate?: string
): Promise<any[]> {
  let query = supabase
    .from('meal_logs')
    .select('*, creator:profiles!meal_logs_created_by_fkey(name), updater:profiles!meal_logs_updated_by_fkey(name), meal_config:meal_configs(*)')
    .eq('patient_id', patientId)
    .lt('event_date', beforeDate)
    .order('event_date', { ascending: false })
    .order('meal_time', { ascending: true, nullsFirst: false });

  if (startDate) {
    query = query.gte('event_date', startDate);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[getHistoricalMealLogs] error:', error);
    throw error;
  }
  return data ?? [];
}

export async function getHistoricalMedicationLogs(
  patientId: string,
  beforeDate: string,
  startDate?: string
): Promise<any[]> {
  let query = supabase
    .from('medication_logs')
    .select('*, medication:medications(*, period:medication_periods(*)), creator:profiles!medication_logs_created_by_fkey(name), updater:profiles!medication_logs_updated_by_fkey(name)')
    .eq('patient_id', patientId)
    .lt('event_date', beforeDate)
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: true });

  if (startDate) {
    query = query.gte('event_date', startDate);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[getHistoricalMedicationLogs] error:', error);
    throw error;
  }
  return data ?? [];
}

export async function getMealLogs(patientId: string, eventDate: string): Promise<any[]> {
  return fetchWithCache(
    `mealLogs_${patientId}_${eventDate}`,
    async () => {
      const { data, error } = await supabase
        .from('meal_logs')
        .select('*, creator:profiles!meal_logs_created_by_fkey(name), updater:profiles!meal_logs_updated_by_fkey(name)')
        .eq('patient_id', patientId)
        .eq('event_date', eventDate);
      if (error) throw error;
      return data || [];
    },
    [],
    { throwIfNoCacheWhenOnline: true }
  );
}

export async function getMedicationLogs(patientId: string, eventDate: string): Promise<any[]> {
  return fetchWithCache(
    `medLogs_${patientId}_${eventDate}`,
    async () => {
      const { data, error } = await supabase
        .from('medication_logs')
        .select('*, creator:profiles!medication_logs_created_by_fkey(name), updater:profiles!medication_logs_updated_by_fkey(name)')
        .eq('patient_id', patientId)
        .eq('event_date', eventDate);
      if (error) throw error;
      return data || [];
    },
    [],
    { throwIfNoCacheWhenOnline: true }
  );
}

async function upsertMealLogInCache(patientId: string, eventDate: string, savedLog: any) {
  try {
    const key = `mealLogs_${patientId}_${eventDate}`;
    const current = (await get<any[]>(key)) || [];
    const filtered = current.filter(
      (item) => item.id !== savedLog.id && item.meal_config_id !== savedLog.meal_config_id
    );
    filtered.push(savedLog);
    await set(key, filtered);
  } catch {}
}

async function upsertMedLogInCache(patientId: string, eventDate: string, savedLog: any) {
  try {
    const key = `medLogs_${patientId}_${eventDate}`;
    const current = (await get<any[]>(key)) || [];
    const filtered = current.filter(
      (item) => item.id !== savedLog.id && item.medication_id !== savedLog.medication_id
    );
    filtered.push(savedLog);
    await set(key, filtered);
  } catch {}
}

export interface OfflineMealMutationOptions {
  offlinePhoto?: OfflinePhotoAttachment | null;
  oldPhotoPathToDelete?: string | null;
}

export async function createMealLog(
  log: Database['public']['Tables']['meal_logs']['Insert'],
  offlineOptions: OfflineMealMutationOptions = {}
) {
  const buildOptimistic = (tempId: string) => ({
    ...log,
    id: tempId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    _syncPending: true,
  });

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const tempId = `offline_meal_${log.meal_config_id}_${log.event_date}_${Date.now()}`;
    const userId = await getCurrentSessionUserId();
    await addToSyncQueue('createMealLog', log, {
      patientId: log.patient_id,
      eventDate: log.event_date,
      userId: userId || log.created_by,
      localTempId: tempId,
      offlinePhoto: offlineOptions.offlinePhoto,
      oldPhotoPathToDelete: offlineOptions.oldPhotoPathToDelete,
    });
    const optimistic = buildOptimistic(tempId);
    await upsertMealLogInCache(log.patient_id, log.event_date, optimistic);
    return optimistic;
  }

  try {
    const { data, error } = await supabase
      .from('meal_logs')
      .insert(log as any)
      .select('*, creator:profiles!meal_logs_created_by_fkey(name), updater:profiles!meal_logs_updated_by_fkey(name)')
      .single();

    if (error) {
      if (String(error.code || '') === '23505') {
        const { data: existing, error: fetchErr } = await supabase
          .from('meal_logs')
          .select('*, creator:profiles!meal_logs_created_by_fkey(name), updater:profiles!meal_logs_updated_by_fkey(name)')
          .eq('meal_config_id', log.meal_config_id)
          .eq('event_date', log.event_date)
          .maybeSingle();
        if (!fetchErr && existing) {
          await upsertMealLogInCache(log.patient_id, log.event_date, existing);
          return existing;
        }
      }
      if (error.code === 'PGRST204') {
        console.error("ERRO CRÍTICO: Coluna ausente no banco (meal_time / drink_description).");
      }
      throw error;
    }
    if (data) {
      await upsertMealLogInCache(log.patient_id, log.event_date, data);
    }
    return data;
  } catch (err: any) {
    if (isTransientNetworkError(err)) {
      const tempId = `offline_meal_${log.meal_config_id}_${log.event_date}_${Date.now()}`;
      const userId = await getCurrentSessionUserId();
      await addToSyncQueue('createMealLog', log, {
        patientId: log.patient_id,
        eventDate: log.event_date,
        userId: userId || log.created_by,
        localTempId: tempId,
        offlinePhoto: offlineOptions.offlinePhoto,
        oldPhotoPathToDelete: offlineOptions.oldPhotoPathToDelete,
      });
      const optimistic = buildOptimistic(tempId);
      await upsertMealLogInCache(log.patient_id, log.event_date, optimistic);
      return optimistic;
    }
    throw err;
  }
}

export async function updateMealLog(
  id: string,
  log: Database['public']['Tables']['meal_logs']['Update'] & { patient_id?: string; event_date?: string },
  offlineOptions: OfflineMealMutationOptions = {}
) {
  const patientId = log.patient_id;
  const eventDate = log.event_date;

  if ((typeof navigator !== 'undefined' && !navigator.onLine) || id.startsWith('offline_')) {
    const userId = await getCurrentSessionUserId();
    await addToSyncQueue(
      'updateMealLog',
      { id, ...log },
      {
        patientId,
        eventDate,
        userId: userId || log.updated_by,
        offlinePhoto: offlineOptions.offlinePhoto,
        oldPhotoPathToDelete: offlineOptions.oldPhotoPathToDelete,
      }
    );
    if (patientId && eventDate) {
      const key = `mealLogs_${patientId}_${eventDate}`;
      const current = (await get<any[]>(key)) || [];
      const existing = current.find((item) => item.id === id) || {};
      await upsertMealLogInCache(patientId, eventDate, {
        ...existing,
        ...log,
        id,
        updated_at: new Date().toISOString(),
        _syncPending: true,
      });
    }
    return { id, ...log, _syncPending: true };
  }

  try {
    const { data, error } = await (supabase as any)
      .from('meal_logs')
      .update(log)
      .eq('id', id)
      .select('*, creator:profiles!meal_logs_created_by_fkey(name), updater:profiles!meal_logs_updated_by_fkey(name)')
      .single();

    if (error) {
      if (error.code === 'PGRST204') {
        console.error("ERRO CRÍTICO: Coluna ausente no banco.");
      }
      throw error;
    }
    if (data && data.patient_id && data.event_date) {
      await upsertMealLogInCache(data.patient_id, data.event_date, data);
    }
    return data;
  } catch (err: any) {
    if (isTransientNetworkError(err)) {
      const userId = await getCurrentSessionUserId();
      await addToSyncQueue(
        'updateMealLog',
        { id, ...log },
        {
          patientId,
          eventDate,
          userId: userId || log.updated_by,
          offlinePhoto: offlineOptions.offlinePhoto,
          oldPhotoPathToDelete: offlineOptions.oldPhotoPathToDelete,
        }
      );
      if (patientId && eventDate) {
        const key = `mealLogs_${patientId}_${eventDate}`;
        const current = (await get<any[]>(key)) || [];
        const existing = current.find((item) => item.id === id) || {};
        await upsertMealLogInCache(patientId, eventDate, {
          ...existing,
          ...log,
          id,
          updated_at: new Date().toISOString(),
          _syncPending: true,
        });
      }
      return { id, ...log, _syncPending: true };
    }
    throw err;
  }
}

export async function createMedicationLog(log: Database['public']['Tables']['medication_logs']['Insert']) {
  const buildOptimistic = (tempId: string) => ({
    ...log,
    id: tempId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    _syncPending: true,
  });

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const tempId = `offline_med_${log.medication_id}_${log.event_date}_${Date.now()}`;
    const userId = await getCurrentSessionUserId();
    await addToSyncQueue('createMedicationLog', log, {
      patientId: log.patient_id,
      eventDate: log.event_date,
      userId: userId || log.created_by,
      localTempId: tempId,
    });
    const optimistic = buildOptimistic(tempId);
    await upsertMedLogInCache(log.patient_id, log.event_date, optimistic);
    return optimistic;
  }

  try {
    const { data, error } = await supabase
      .from('medication_logs')
      .insert(log as any)
      .select()
      .single();

    if (error) {
      // Idempotency if already inserted concurrently
      if (String(error.code || '') === '23505') {
        const { data: existing, error: fetchErr } = await supabase
          .from('medication_logs')
          .select()
          .eq('medication_id', log.medication_id)
          .eq('event_date', log.event_date)
          .maybeSingle();
        if (!fetchErr && existing) {
          await upsertMedLogInCache(log.patient_id, log.event_date, existing);
          return existing;
        }
      }
      throw error;
    }
    if (data) {
      await upsertMedLogInCache(log.patient_id, log.event_date, data);
    }
    return data;
  } catch (err: any) {
    if (isTransientNetworkError(err)) {
      const tempId = `offline_med_${log.medication_id}_${log.event_date}_${Date.now()}`;
      const userId = await getCurrentSessionUserId();
      await addToSyncQueue('createMedicationLog', log, {
        patientId: log.patient_id,
        eventDate: log.event_date,
        userId: userId || log.created_by,
        localTempId: tempId,
      });
      const optimistic = buildOptimistic(tempId);
      await upsertMedLogInCache(log.patient_id, log.event_date, optimistic);
      return optimistic;
    }
    throw err;
  }
}

export async function updateMedicationLog(
  id: string,
  log: Database['public']['Tables']['medication_logs']['Update'] & { patient_id?: string; event_date?: string }
) {
  const patientId = log.patient_id;
  const eventDate = log.event_date;

  if ((typeof navigator !== 'undefined' && !navigator.onLine) || id.startsWith('offline_')) {
    const userId = await getCurrentSessionUserId();
    await addToSyncQueue(
      'updateMedicationLog',
      { id, ...log },
      { patientId, eventDate, userId: userId || log.updated_by }
    );
    if (patientId && eventDate) {
      const key = `medLogs_${patientId}_${eventDate}`;
      const current = (await get<any[]>(key)) || [];
      const existing = current.find((item) => item.id === id) || {};
      await upsertMedLogInCache(patientId, eventDate, {
        ...existing,
        ...log,
        id,
        updated_at: new Date().toISOString(),
        _syncPending: true,
      });
    }
    return { id, ...log, _syncPending: true };
  }

  try {
    const { data, error } = await (supabase as any)
      .from('medication_logs')
      .update(log)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (data && data.patient_id && data.event_date) {
      await upsertMedLogInCache(data.patient_id, data.event_date, data);
    }
    return data;
  } catch (err: any) {
    if (isTransientNetworkError(err)) {
      const userId = await getCurrentSessionUserId();
      await addToSyncQueue(
        'updateMedicationLog',
        { id, ...log },
        { patientId, eventDate, userId: userId || log.updated_by }
      );
      if (patientId && eventDate) {
        const key = `medLogs_${patientId}_${eventDate}`;
        const current = (await get<any[]>(key)) || [];
        const existing = current.find((item) => item.id === id) || {};
        await upsertMedLogInCache(patientId, eventDate, {
          ...existing,
          ...log,
          id,
          updated_at: new Date().toISOString(),
          _syncPending: true,
        });
      }
      return { id, ...log, _syncPending: true };
    }
    throw err;
  }
}

// --- STORAGE WITH EXPIRY-AWARE SIGNED URL CACHE ---

interface CachedSignedUrl {
  url: string;
  expiresAt: number;
}

async function resolveSignedUrl(bucket: 'patient-profile' | 'meal-records', path: string): Promise<string | null> {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('blob:') || path.startsWith('data:')) {
    return path;
  }

  const cacheKey = bucket === 'patient-profile' ? `photo_url_patient_${path}` : `photo_url_meal_${path}`;
  const now = Date.now();

  // 1. Check in-memory cache first (valid if > 1h remaining)
  const mem = signedUrlMemoryCache.get(cacheKey);
  if (mem && mem.expiresAt > now + SIGNED_URL_REFRESH_BUFFER_MS) {
    return mem.url;
  }

  // 2. Check IndexedDB cached URL (avoids re-signing every photo on every timeline refresh!)
  const idbRaw = await get<CachedSignedUrl | string>(cacheKey);
  let idbUrl: string | null = null;
  if (typeof idbRaw === 'string') {
    idbUrl = idbRaw;
  } else if (idbRaw && typeof idbRaw === 'object' && idbRaw.url) {
    if (idbRaw.expiresAt > now + SIGNED_URL_REFRESH_BUFFER_MS) {
      signedUrlMemoryCache.set(cacheKey, idbRaw);
      return idbRaw.url;
    }
    idbUrl = idbRaw.url;
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return idbUrl;
  }

  // 3. Deduplicate concurrent Storage API sign calls for identical path
  const inFlight = pendingSignedUrlRequests.get(cacheKey);
  if (inFlight) return inFlight;

  const request = (async (): Promise<string | null> => {
    try {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, 60 * 60 * 24 * 7);

      if (!error && data?.signedUrl) {
        const entry: CachedSignedUrl = {
          url: data.signedUrl,
          expiresAt: Date.now() + SIGNED_URL_TTL_MS,
        };
        signedUrlMemoryCache.set(cacheKey, entry);
        await set(cacheKey, entry);
        return data.signedUrl;
      }
      if (error) console.error(`Error signing URL for ${bucket}/${path}:`, error);
    } catch (err) {
      console.warn(`Network error signing URL for ${bucket}/${path}:`, err);
    }
    return idbUrl;
  })().finally(() => {
    pendingSignedUrlRequests.delete(cacheKey);
  });

  pendingSignedUrlRequests.set(cacheKey, request);
  return request;
}

export async function getPatientPhotoUrl(_patientId: string, path: string): Promise<string | null> {
  return resolveSignedUrl('patient-profile', path);
}

export async function getMealPhotoUrl(path: string): Promise<string | null> {
  return resolveSignedUrl('meal-records', path);
}

export async function uploadMealPhoto(patientId: string, file: File, fileName: string) {
  const filePath = `${patientId}/${fileName}`;
  const { data, error } = await supabase.storage
    .from('meal-records')
    .upload(filePath, file, {
      upsert: false,
      contentType: file.type || 'image/jpeg',
    });

  if (error) throw error;
  return {
    ...(data || {}),
    path: data?.path || filePath,
  };
}

export async function deleteStorageFile(bucket: string, path: string): Promise<boolean> {
  if (!path) return true;
  try {
    const cacheKey = bucket === 'patient-profile' ? `photo_url_patient_${path}` : `photo_url_meal_${path}`;
    signedUrlMemoryCache.delete(cacheKey);
    await del(cacheKey).catch(() => {});

    const { error } = await supabase.storage.from(bucket).remove([path]);
    if (error) {
      console.error(`Error deleting ${path} from ${bucket}:`, error);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`Exception deleting ${path} from ${bucket}:`, err);
    return false;
  }
}

// --- SETUP & ROUTINE MUTATIONS ---

export async function createPatient(
  patient: Database['public']['Tables']['patients']['Insert']
): Promise<Database['public']['Tables']['patients']['Row']> {
  const { data, error } = await (supabase as any)
    .from('patients')
    .insert(patient)
    .select()
    .single();
  if (error) throw error;
  await set(`patient_${patient.family_id}`, data);
  return data;
}

export async function updatePatient(id: string, patient: Database['public']['Tables']['patients']['Update']) {
  const { data, error } = await (supabase as any).from('patients').update(patient).eq('id', id).select().single();
  if (error) throw error;
  if (data?.family_id) {
    await set(`patient_${data.family_id}`, data);
  }
  return data;
}

export async function uploadPatientPhoto(patientId: string, file: File, fileName: string) {
  const filePath = `${patientId}/${fileName}`;
  const { data, error } = await supabase.storage
    .from('patient-profile')
    .upload(filePath, file, { upsert: true, contentType: file.type || 'image/jpeg' });
  if (error) throw error;
  return {
    ...(data || {}),
    path: data?.path || filePath,
  };
}

export async function createMealConfig(config: Database['public']['Tables']['meal_configs']['Insert']) {
  const { data, error } = await (supabase as any).from('meal_configs').insert(config).select().single();
  if (error) throw error;
  await del(`mealConfigs_${config.patient_id}`).catch(() => {});
  return data;
}

export async function updateMealConfig(id: string, config: Database['public']['Tables']['meal_configs']['Update']) {
  const { data, error } = await (supabase as any).from('meal_configs').update(config).eq('id', id).select().single();
  if (error) throw error;
  if (data?.patient_id) {
    await del(`mealConfigs_${data.patient_id}`).catch(() => {});
  }
  return data;
}

export async function createMedicationPeriod(period: Database['public']['Tables']['medication_periods']['Insert']) {
  const { data, error } = await (supabase as any).from('medication_periods').insert(period).select().single();
  if (error) throw error;
  await del(`medPeriods_${period.patient_id}`).catch(() => {});
  return data;
}

export async function updateMedicationPeriod(
  id: string,
  period: Database['public']['Tables']['medication_periods']['Update']
) {
  const { data, error } = await (supabase as any)
    .from('medication_periods')
    .update(period)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  if (data?.patient_id) {
    await del(`medPeriods_${data.patient_id}`).catch(() => {});
  }
  return data;
}

export async function createMedication(med: Database['public']['Tables']['medications']['Insert']) {
  const { data, error } = await (supabase as any).from('medications').insert(med).select().single();
  if (error) throw error;
  await del(`medications_${med.patient_id}`).catch(() => {});
  return data;
}

export async function updateMedication(id: string, med: Database['public']['Tables']['medications']['Update']) {
  const { data, error } = await (supabase as any).from('medications').update(med).eq('id', id).select().single();
  if (error) throw error;
  if (data?.patient_id) {
    await del(`medications_${data.patient_id}`).catch(() => {});
  }
  return data;
}

export async function seedInitialRoutine(patientId: string) {
  await supabase.from('meal_configs').insert([
    { patient_id: patientId, name: 'Café da manhã', type: 'breakfast', scheduled_time: '08:00', display_order: 1 },
    { patient_id: patientId, name: 'Almoço', type: 'lunch', scheduled_time: '12:30', display_order: 2 },
    { patient_id: patientId, name: 'Lanche da tarde', type: 'snack', scheduled_time: '16:00', display_order: 3 },
    { patient_id: patientId, name: 'Jantar', type: 'dinner', scheduled_time: '19:30', display_order: 4 },
  ] as any);

  await supabase.from('medication_periods').insert([
    { patient_id: patientId, name: 'Antes do café', scheduled_time: '07:30', display_order: 1 },
    { patient_id: patientId, name: 'Depois do café', scheduled_time: '08:30', display_order: 2 },
    { patient_id: patientId, name: 'Depois do almoço', scheduled_time: '13:00', display_order: 3 },
    { patient_id: patientId, name: 'Depois do jantar', scheduled_time: '20:00', display_order: 4 },
  ] as any);

  await Promise.all([
    del(`mealConfigs_${patientId}`).catch(() => {}),
    del(`medPeriods_${patientId}`).catch(() => {}),
  ]);
}

// --- FAMILY MEMBERSHIPS & INVITES ---

export async function getMyFamilyMemberships(): Promise<any[]> {
  const sessionUserId = await getCurrentSessionUserId();
  const cacheKey = sessionUserId ? `myFamilyMemberships_${sessionUserId}` : 'myFamilyMemberships';

  return fetchWithCache(
    cacheKey,
    async () => {
      const user = await getCurrentUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from('family_members')
        .select('*')
        .eq('user_id', user.id);

      if (error) throw error;
      if (data) {
        await set(`myFamilyMemberships_${user.id}`, data);
      }
      return data || [];
    },
    [],
    { throwIfNoCacheWhenOnline: true }
  );
}

export async function getMyFamilyRole(familyId: string): Promise<'ADMIN' | 'MEMBER'> {
  if (!familyId) return 'MEMBER';
  const memberships = await getMyFamilyMemberships();
  const match = memberships.find((m: any) => m.family_id === familyId);
  return match?.role === 'ADMIN' ? 'ADMIN' : 'MEMBER';
}

export async function getFamilyMembers(familyId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('family_members')
    .select('*')
    .eq('family_id', familyId);
  if (error) throw error;

  if (data && data.length > 0) {
    const userIds = (data as any[]).map((m) => m.user_id);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, name, email, avatar_url')
      .in('id', userIds);

    if (profiles) {
      return (data as any[]).map((m) => ({
        ...m,
        profile: (profiles as any[]).find((p) => p.id === m.user_id),
      }));
    }
  }

  return data || [];
}

export async function getFamilyInvites(familyId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('family_invites')
    .select('*')
    .eq('family_id', familyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createFamilyInvite(): Promise<any> {
  const { data, error } = await (supabase as any).rpc('create_family_invite');
  if (error) throw error;
  return data || [];
}

export async function acceptFamilyInvite(token: string): Promise<any> {
  const { data, error } = await (supabase as any).rpc('accept_family_invite', { p_token: token });
  if (error) throw error;
  return data || [];
}

export async function revokeFamilyInvite(inviteId: string) {
  const { error } = await (supabase as any).rpc('revoke_family_invite', { p_invite_id: inviteId });
  if (error) throw error;
}

export async function setActiveFamily(familyId: string) {
  const { error } = await (supabase as any).rpc('set_active_family', { p_family_id: familyId });
  if (error) throw error;
  signedUrlMemoryCache.clear();
  try {
    const allKeys = await keys();
    await Promise.all(
      allKeys
        .filter((k) => {
          const str = String(k);
          return (
            str.startsWith('currentProfile') ||
            str.startsWith('myFamilyMemberships') ||
            str.startsWith('photo_url_')
          );
        })
        .map((k) => del(k))
    );
  } catch {}
}

export async function clearFamilyAndProfileCaches() {
  signedUrlMemoryCache.clear();
  try {
    const allKeys = await keys();
    await Promise.all(
      allKeys
        .filter((k) => {
          const str = String(k);
          return str.startsWith('currentProfile') || str.startsWith('myFamilyMemberships');
        })
        .map((k) => del(k))
    );
  } catch {}
}

/**
 * Full privacy cache purge on logout or user account switch.
 * Leaves offline_mutation_queue intact (user-scoped inside syncQueue) while purging all
 * read caches, signed URLs, and Service Worker private image caches.
 */
export async function clearAllUserCaches() {
  signedUrlMemoryCache.clear();
  pendingSignedUrlRequests.clear();
  setStaleCacheState(false);

  try {
    const allKeys = await keys();
    await Promise.all(
      allKeys
        .filter((k) => String(k) !== QUEUE_KEY)
        .map((k) => del(k))
    );
  } catch {}

  try {
    if (typeof window !== 'undefined' && 'caches' in window) {
      await window.caches.delete('supabase-images-cache');
    }
  } catch {}
}

export async function removeFamilyMember(userId: string, familyId: string) {
  const { error } = await (supabase as any).rpc('remove_family_member', {
    p_user_id: userId,
    p_family_id: familyId,
  });
  if (error) throw error;
}

export async function updateFamilyMemberRole(
  userId: string,
  familyId: string,
  newRole: 'ADMIN' | 'MEMBER'
) {
  const { data, error } = await (supabase as any).rpc('update_family_member_role', {
    p_user_id: userId,
    p_family_id: familyId,
    p_new_role: newRole,
  });
  if (error) throw error;
  await clearFamilyAndProfileCaches();
  return data;
}
