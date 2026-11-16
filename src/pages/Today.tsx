import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MainLayout } from '../layouts/MainLayout';
import {
  getCurrentProfile,
  getPatient,
  getMealConfigs,
  getMedicationPeriods,
  getMedications,
  getMealLogs,
  getMedicationLogs,
  getDailyMoodLog,
  getMyFamilyRole,
  type DailyMoodLog,
  getPatientPhotoUrl,
  getMealPhotoUrl,
  getDailyClosure,
  createDailyClosure,
  deleteDailyClosure,
  mapWithConcurrency,
  subscribeStaleCache,
  isUsingStaleCache,
} from '../services/api';
import { getSyncQueue } from '../services/syncQueue';
import { useNetwork } from '../contexts/NetworkContext';
import { supabase } from '../services/supabase';
import {
  getLocalDateString,
  getCurrentLocalTime,
  formatFriendlyDate,
  getWeekdayName,
  formatDateToTime,
} from '../utils/date';
import { Spinner } from '../components/ui/Spinner';
import { TimelineItem } from '../components/timeline/TimelineItem';
import { DailyProgressBar } from '../components/timeline/DailyProgressBar';
import { MealModal, MEAL_DRAFT_KEY } from '../components/meals/MealModal';
import { UserProfile } from '../components/ui/UserProfile';
import { MedicationModal } from '../components/medications/MedicationModal';
import { MoodAndPainModal } from '../components/mood/MoodAndPainModal';
import type {
  TimelineEvent,
  MealEventData,
  MedicationEventData,
  EventSyncStatus,
} from '../types/timeline';
import { Unlock, MessageCircle, AlertCircle, RefreshCw } from 'lucide-react';

export function TodayScreen({
  onTabChange,
  editingDateStr,
  onClearEditDate,
}: {
  onTabChange?: (tab: 'today' | 'history' | 'routine') => void;
  editingDateStr?: string | null;
  onClearEditDate?: () => void;
}) {
  const { syncVersion } = useNetwork();

  const [clockDate, setClockDate] = useState<string>(() => getLocalDateString());
  const localDate = editingDateStr || clockDate;
  const friendlyDate = formatFriendlyDate(localDate);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [usingStaleFallback, setUsingStaleFallback] = useState<boolean>(() => isUsingStaleCache());

  const [dailyClosure, setDailyClosure] = useState<any>(null);
  const [showClosureModal, setShowClosureModal] = useState(false);
  const [closingDay, setClosingDay] = useState(false);
  const [reopeningDay, setReopeningDay] = useState(false);
  const [hasReopened, setHasReopened] = useState(false);

  const [profile, setProfile] = useState<any>(null);
  const [patient, setPatient] = useState<any>(null);
  const [patientPhoto, setPatientPhoto] = useState<string | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loadedDate, setLoadedDate] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Mood & Pain state
  const [todayMood, setTodayMood] = useState<DailyMoodLog | null>(null);
  const [showMoodModal, setShowMoodModal] = useState(false);
  const [moodModalMode, setMoodModalMode] = useState<'view' | 'edit'>('view');
  const [isAdmin, setIsAdmin] = useState(false);

  // Modals state
  const [selectedMealEvent, setSelectedMealEvent] = useState<MealEventData | null>(null);
  const [selectedMedEvent, setSelectedMedEvent] = useState<MedicationEventData | null>(null);

  // Concurrency, debouncing and memory guards
  const isMountedRef = useRef(true);
  const timelineReqSeqRef = useRef(0);
  const loadSeqRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFocusRefreshRef = useRef(0);
  const offlineBlobUrlsRef = useRef<string[]>([]);
  const closingRef = useRef(false);
  const reopeningRef = useRef(false);

  const revokeOfflinePreviewUrls = useCallback(() => {
    if (offlineBlobUrlsRef.current.length > 0) {
      offlineBlobUrlsRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      });
      offlineBlobUrlsRef.current = [];
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    const unsubStale = subscribeStaleCache((isStale) => {
      if (isMountedRef.current) setUsingStaleFallback(isStale);
    });

    // Check midnight rollover every 30s so active app transitions cleanly to next day
    const midnightTimer = setInterval(() => {
      const current = getLocalDateString();
      setClockDate((prev) => (prev !== current ? current : prev));
    }, 30_000);

    return () => {
      isMountedRef.current = false;
      unsubStale();
      clearInterval(midnightTimer);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      revokeOfflinePreviewUrls();
    };
  }, [revokeOfflinePreviewUrls]);

  const refreshTimeline = useCallback(
    async (patientId: string, dateStr: string) => {
      const reqSeq = ++timelineReqSeqRef.current;
      try {
        const [meals, medPeriods, allMeds, mealLogs, medLogs, moodLog, closure, syncQueue] =
          await Promise.all([
            getMealConfigs(patientId),
            getMedicationPeriods(patientId),
            getMedications(patientId),
            getMealLogs(patientId, dateStr),
            getMedicationLogs(patientId, dateStr),
            getDailyMoodLog(patientId, dateStr),
            getDailyClosure(patientId, dateStr),
            getSyncQueue(),
          ]);

        if (!isMountedRef.current || reqSeq !== timelineReqSeqRef.current) {
          return;
        }

        const scopedQueue = syncQueue.filter(
          (item) => item.patientId === patientId && item.eventDate === dateStr
        );

        const currentTime = getCurrentLocalTime();
        const currentWeekday = getWeekdayName(dateStr);

        // Track new offline object URLs and revoke old ones cleanly only when replacing
        const nextBlobUrls: string[] = [];

        // Build base meal objects and resolve all existing photos in bounded parallel (limit 5)
        const resolvedMeals = await mapWithConcurrency(meals, 5, async (meal) => {
          const log = mealLogs.find((l) => l.meal_config_id === meal.id);

          // Check offline queue status for this meal
          const matchingQueueItems = scopedQueue.filter(
            (q) =>
              (q.action === 'createMealLog' && q.payload?.meal_config_id === meal.id) ||
              (q.action === 'updateMealLog' &&
                ((log && q.payload?.id === log.id) || q.payload?.meal_config_id === meal.id))
          );
          const failedItem = matchingQueueItems.find((q) => q.status === 'failed');
          const pendingItem = matchingQueueItems.find((q) => q.status === 'pending');

          let syncStatus: EventSyncStatus = 'synced';
          let syncError: string | null = null;
          if (failedItem) {
            syncStatus = 'failed';
            syncError = failedItem.lastError || null;
          } else if (pendingItem || log?._syncPending) {
            syncStatus = 'pending';
          }

          let photoSignedUrl: string | null = null;
          const offlinePhotoBlob =
            matchingQueueItems
              .slice()
              .reverse()
              .find((q) => q.offlinePhoto?.blob)?.offlinePhoto?.blob || null;

          if (offlinePhotoBlob) {
            try {
              const objUrl = URL.createObjectURL(offlinePhotoBlob);
              nextBlobUrls.push(objUrl);
              photoSignedUrl = objUrl;
            } catch {}
          } else if (log?.photo_url) {
            photoSignedUrl = await getMealPhotoUrl(log.photo_url);
          }

          let status: 'waiting' | 'pending' | 'confirmed' = 'waiting';
          if (log) {
            status = 'confirmed';
          } else if (meal.scheduled_time <= currentTime) {
            status = 'pending';
          }

          return {
            id: meal.id,
            type: 'meal' as const,
            time: meal.scheduled_time,
            title: meal.name,
            status,
            _syncStatus: syncStatus,
            _syncError: syncError,
            mealConfig: meal,
            log,
            photoSignedUrl,
          };
        });

        if (!isMountedRef.current || reqSeq !== timelineReqSeqRef.current) {
          nextBlobUrls.forEach((u) => {
            try {
              URL.revokeObjectURL(u);
            } catch {}
          });
          return;
        }

        revokeOfflinePreviewUrls();
        offlineBlobUrlsRef.current = nextBlobUrls;

        const timeline: TimelineEvent[] = [...resolvedMeals];

        // 2. Process Medication Periods
        for (const period of medPeriods) {
          const periodMeds = allMeds.filter((m) => {
            if (m.medication_period_id !== period.id) return false;
            if (m.frequency === 'daily') return true;
            if (m.frequency === 'weekly') return m.weekday === currentWeekday;
            return false;
          });

          if (periodMeds.length === 0) continue;

          const periodMedIds = new Set(periodMeds.map((m) => m.id));
          const periodLogs = medLogs.filter((l) => periodMedIds.has(l.medication_id));

          const matchingQueueItems = scopedQueue.filter(
            (q) =>
              (q.action === 'createMedicationLog' && periodMedIds.has(q.payload?.medication_id)) ||
              (q.action === 'updateMedicationLog' &&
                periodLogs.some((pl) => pl.id === q.payload?.id))
          );
          const failedItem = matchingQueueItems.find((q) => q.status === 'failed');
          const pendingItem = matchingQueueItems.find((q) => q.status === 'pending');

          let syncStatus: EventSyncStatus = 'synced';
          let syncError: string | null = null;
          if (failedItem) {
            syncStatus = 'failed';
            syncError = failedItem.lastError || null;
          } else if (pendingItem || periodLogs.some((l) => Boolean(l?._syncPending))) {
            syncStatus = 'pending';
          }

          let status: 'waiting' | 'pending' | 'confirmed' | 'attention' = 'waiting';
          const allResolved = periodMeds.every((m) =>
            periodLogs.some((l) => l.medication_id === m.id)
          );
          const hasNotAdministered = periodLogs.some((l) => l.status === 'not_administered');

          if (allResolved) {
            status = hasNotAdministered ? 'attention' : 'confirmed';
          } else if (period.scheduled_time <= currentTime) {
            status = 'pending';
          }

          timeline.push({
            id: period.id,
            type: 'medication_period',
            time: period.scheduled_time,
            title: period.name,
            status,
            _syncStatus: syncStatus,
            _syncError: syncError,
            period,
            medications: periodMeds,
            logs: periodLogs,
          });
        }

        timeline.sort((a, b) => a.time.localeCompare(b.time));

        setTodayMood(moodLog);
        setDailyClosure(closure);
        setEvents(timeline);
        setLoadedDate(dateStr);
        setLoadError(null);

        // Restore in-progress meal draft if OS reloaded tab after camera return
        try {
          const rawDraft =
            sessionStorage.getItem(MEAL_DRAFT_KEY) || localStorage.getItem(MEAL_DRAFT_KEY);
          if (rawDraft) {
            const parsedDraft = JSON.parse(rawDraft);
            if (
              parsedDraft &&
              parsedDraft.patientId === patientId &&
              parsedDraft.eventDate === dateStr &&
              Date.now() - (parsedDraft.ts || 0) < 15 * 60 * 1000
            ) {
              const targetEvent = timeline.find(
                (e) => e.type === 'meal' && e.id === parsedDraft.mealId
              ) as MealEventData | undefined;
              if (targetEvent) {
                setSelectedMealEvent((prev) => prev || targetEvent);
              }
            }
          }
        } catch {}
      } catch (error: any) {
        if (!isMountedRef.current || reqSeq !== timelineReqSeqRef.current) return;
        console.error('Error refreshing timeline:', error);
        setLoadError(
          error?.message || 'Não foi possível carregar a rotina. Verifique sua conexão e tente novamente.'
        );
      }
    },
    [revokeOfflinePreviewUrls]
  );

  const scheduleRefresh = useCallback(
    (patientId: string, dateStr: string, delayMs = 250) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        if (isMountedRef.current) {
          refreshTimeline(patientId, dateStr);
        }
      }, delayMs);
    },
    [refreshTimeline]
  );

  const loadData = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    if (!patient) setLoading(true);
    else setIsTransitioning(true);
    setLoadError(null);

    try {
      const prof = await getCurrentProfile();
      if (!isMountedRef.current || seq !== loadSeqRef.current) return;
      if (!prof) {
        setLoadError('Não foi possível identificar seu perfil.');
        return;
      }
      setProfile(prof);

      const [pat, role] = await Promise.all([
        getPatient(prof.family_id),
        getMyFamilyRole(prof.family_id),
      ]);
      if (!isMountedRef.current || seq !== loadSeqRef.current) return;

      setIsAdmin(role === 'ADMIN');
      if (!pat) {
        setPatient(null);
        return;
      }
      setPatient(pat);

      if (pat.photo_url) {
        const url = await getPatientPhotoUrl(pat.id, pat.photo_url);
        if (isMountedRef.current && seq === loadSeqRef.current) {
          setPatientPhoto(url);
        }
      } else {
        setPatientPhoto(null);
      }

      await refreshTimeline(pat.id, localDate);
    } catch (err: any) {
      if (!isMountedRef.current || seq !== loadSeqRef.current) return;
      console.error('Error loading data:', err);
      setLoadError(
        err?.message || 'Não foi possível carregar os dados. Verifique sua conexão e tente novamente.'
      );
    } finally {
      if (isMountedRef.current && seq === loadSeqRef.current) {
        setLoading(false);
        setIsTransitioning(false);
      }
    }
  }, [localDate, patient?.id, refreshTimeline]);

  useEffect(() => {
    setHasReopened(false);
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localDate]);

  // Refresh timeline automatically when offline queue completes background syncs
  useEffect(() => {
    if (syncVersion > 0 && patient?.id) {
      scheduleRefresh(patient.id, localDate, 150);
    }
  }, [syncVersion, patient?.id, localDate, scheduleRefresh]);

  // Patient-scoped Realtime subscriptions + deduplicated focus/visibility handlers
  useEffect(() => {
    if (!patient?.id) return;
    const pid = patient.id;

    const mealSub = supabase
      .channel(`patient:${pid}:meal_logs`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'meal_logs', filter: `patient_id=eq.${pid}` },
        () => scheduleRefresh(pid, localDate, 250)
      )
      .subscribe();

    const medSub = supabase
      .channel(`patient:${pid}:medication_logs`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'medication_logs', filter: `patient_id=eq.${pid}` },
        () => scheduleRefresh(pid, localDate, 250)
      )
      .subscribe();

    const moodSub = supabase
      .channel(`patient:${pid}:daily_mood_logs`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'daily_mood_logs', filter: `patient_id=eq.${pid}` },
        () => scheduleRefresh(pid, localDate, 250)
      )
      .subscribe();

    const closureSub = supabase
      .channel(`patient:${pid}:daily_closures`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'daily_closures', filter: `patient_id=eq.${pid}` },
        () => scheduleRefresh(pid, localDate, 250)
      )
      .subscribe();

    const triggerFocusRefresh = () => {
      const now = Date.now();
      if (now - lastFocusRefreshRef.current < 1500) return;
      lastFocusRefreshRef.current = now;
      scheduleRefresh(pid, localDate, 100);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const current = getLocalDateString();
        setClockDate((prev) => (prev !== current ? current : prev));
        triggerFocusRefresh();
      }
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', triggerFocusRefresh);

    return () => {
      supabase.removeChannel(mealSub);
      supabase.removeChannel(medSub);
      supabase.removeChannel(moodSub);
      supabase.removeChannel(closureSub);
      window.removeEventListener('focus', triggerFocusRefresh);
      window.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [patient?.id, localDate, scheduleRefresh]);

  const handleMealRefresh = () => {
    if (patient) refreshTimeline(patient.id, localDate);
    setSelectedMealEvent(null);
  };

  const handleMedRefresh = () => {
    if (patient) refreshTimeline(patient.id, localDate);
    setSelectedMedEvent(null);
  };

  const handleReopenDay = async () => {
    if (!patient || reopeningRef.current || reopeningDay) return;
    if (!isAdmin) {
      setActionError('Apenas administradores podem reabrir um dia encerrado.');
      return;
    }
    reopeningRef.current = true;
    setReopeningDay(true);
    setActionError(null);
    try {
      const res = await deleteDailyClosure(patient.id, localDate);
      if (!isMountedRef.current) return;
      if (res.success) {
        setDailyClosure(null);
        setHasReopened(true);
        await refreshTimeline(patient.id, localDate);
      } else {
        setActionError(res.error || 'Não foi possível reabrir o dia. Tente novamente.');
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setActionError(err?.message || 'Erro ao reabrir o dia.');
      }
    } finally {
      reopeningRef.current = false;
      if (isMountedRef.current) setReopeningDay(false);
    }
  };

  const handleCloseDay = async () => {
    if (!patient || !profile || closingRef.current || closingDay) return;
    if (!isAdmin) {
      setActionError('Apenas administradores podem encerrar o dia.');
      return;
    }
    closingRef.current = true;
    setClosingDay(true);
    setActionError(null);
    try {
      const res = await createDailyClosure(profile.family_id, patient.id, localDate, profile.id);
      if (!isMountedRef.current) return;
      if (res.success) {
        setShowClosureModal(false);
        setHasReopened(false);
        await refreshTimeline(patient.id, localDate);
      } else {
        setActionError(res.error || 'Não foi possível encerrar o dia. Tente novamente.');
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setActionError(err?.message || 'Erro ao encerrar o dia.');
      }
    } finally {
      closingRef.current = false;
      if (isMountedRef.current) setClosingDay(false);
    }
  };

  // Recoverable error view MUST run before infinite spinner check
  if (loadError && loadedDate !== localDate) {
    return (
      <MainLayout activeTab={editingDateStr ? 'history' : 'today'} onTabChange={onTabChange}>
        <div className="flex h-[80vh] items-center justify-center flex-col text-center px-6 space-y-4">
          <div className="w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div className="space-y-1 max-w-xs">
            <h3 className="font-semibold text-gray-900 dark:text-zinc-100">
              Não foi possível carregar hoje
            </h3>
            <p className="text-sm text-gray-500 dark:text-zinc-400">{loadError}</p>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Tentar novamente</span>
          </button>
        </div>
      </MainLayout>
    );
  }

  if (loading || isTransitioning || loadedDate !== localDate) {
    return (
      <MainLayout activeTab={editingDateStr ? 'history' : 'today'} onTabChange={onTabChange}>
        <div className="flex h-[80vh] items-center justify-center">
          <Spinner />
        </div>
      </MainLayout>
    );
  }

  if (!patient) {
    return (
      <MainLayout activeTab={editingDateStr ? 'history' : 'today'} onTabChange={onTabChange}>
        <div className="flex h-[80vh] items-center justify-center flex-col text-center px-6">
          <p className="text-gray-500 dark:text-zinc-400">
            Familiar não encontrado ou rotina não configurada.
          </p>
        </div>
      </MainLayout>
    );
  }

  const resolvedEventsCount = events.filter(
    (e) => e.status === 'confirmed' || e.status === 'attention'
  ).length;
  const pendingEventsCount = events.length - resolvedEventsCount;
  const isAllEventsCompleted = events.length > 0 && resolvedEventsCount === events.length;

  const morning = events.filter((e) => e.time < '12:00:00');
  const afternoon = events.filter((e) => e.time >= '12:00:00' && e.time < '18:00:00');
  const night = events.filter((e) => e.time >= '18:00:00');

  return (
    <MainLayout activeTab={editingDateStr ? 'history' : 'today'} onTabChange={onTabChange}>
      <div className="max-w-md mx-auto w-full">
        {/* Banner de Edição do Passado */}
        {editingDateStr && (
          <div className="bg-indigo-50 dark:bg-indigo-950/50 px-6 py-3 border-b border-indigo-100 dark:border-indigo-900/50 flex items-center justify-between shadow-sm">
            <div>
              <p className="text-xs font-bold text-indigo-800 dark:text-indigo-300 uppercase tracking-wider">
                Modo de Edição
              </p>
              <p className="text-sm font-medium text-indigo-900 dark:text-indigo-100 mt-0.5">
                Editando o dia {friendlyDate}
              </p>
            </div>
            <button
              type="button"
              onClick={onClearEditDate}
              className="text-xs font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-100/50 dark:bg-indigo-900/50 hover:bg-indigo-200 dark:hover:bg-indigo-800/60 px-3 py-1.5 rounded-lg transition-colors"
            >
              Voltar a Hoje
            </button>
          </div>
        )}

        <div className="bg-white/95 dark:bg-[#111115]/95 px-6 pt-12 pb-6 sticky top-0 z-30 border-b border-gray-100/50 dark:border-white/[0.08] backdrop-blur-xl transition-colors">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">DUCA</h1>
            <UserProfile />
          </div>

          <div className="flex items-center space-x-4">
            <button
              type="button"
              onClick={() => {
                setMoodModalMode(todayMood || !isAdmin ? 'view' : 'edit');
                setShowMoodModal(true);
              }}
              className="relative group transition-transform active:scale-95 focus:outline-none shrink-0"
              title={
                todayMood
                  ? 'Ver avaliação de bem-estar de hoje'
                  : isAdmin
                  ? 'Registrar como está hoje'
                  : 'Ver bem-estar de hoje'
              }
            >
              <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-[#1c1c22] border-2 border-white dark:border-zinc-900 shadow-md overflow-hidden flex items-center justify-center ring-2 ring-indigo-100 dark:ring-indigo-500/30 group-hover:ring-indigo-300 dark:group-hover:ring-indigo-400/50 transition-all">
                {patientPhoto ? (
                  <img src={patientPhoto} alt={patient.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl">👵</span>
                )}
              </div>

              {todayMood ? (
                <div
                  className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-xs shadow-md border-2 border-white dark:border-[#111115] ${
                    todayMood.pain_level !== 'none'
                      ? 'bg-rose-50 dark:bg-rose-950 ring-1 ring-rose-300 dark:ring-rose-800'
                      : 'bg-emerald-50 dark:bg-emerald-950 ring-1 ring-emerald-300 dark:ring-emerald-800'
                  }`}
                >
                  {todayMood.mood === 'happy'
                    ? '😊'
                    : todayMood.mood === 'calm'
                    ? '😌'
                    : todayMood.mood === 'tired'
                    ? '🥱'
                    : todayMood.mood === 'sad'
                    ? '😢'
                    : '😣'}
                </div>
              ) : isAdmin ? (
                <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-indigo-50 dark:bg-indigo-950 border-2 border-white dark:border-[#111115] ring-1 ring-indigo-200 dark:ring-indigo-700 flex items-center justify-center text-[10px] text-indigo-600 dark:text-indigo-300 shadow-sm animate-pulse">
                  ✨
                </div>
              ) : null}
            </button>

            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-zinc-100 truncate">
                {patient.name}
              </h2>
              <p className="text-xs text-gray-500 dark:text-zinc-400 mb-1.5">Hoje, {friendlyDate}</p>

              {todayMood ? (
                <button
                  type="button"
                  onClick={() => {
                    setMoodModalMode('view');
                    setShowMoodModal(true);
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all active:scale-95 text-left max-w-full ${
                    todayMood.pain_level === 'none'
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-200/70 dark:border-emerald-800/50 hover:bg-emerald-100/70 dark:hover:bg-emerald-950/80'
                      : 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300 border-rose-200/70 dark:border-rose-800/50 hover:bg-rose-100/70 dark:hover:bg-rose-950/80'
                  }`}
                >
                  <span className="text-sm">
                    {todayMood.mood === 'happy'
                      ? '😊'
                      : todayMood.mood === 'calm'
                      ? '😌'
                      : todayMood.mood === 'tired'
                      ? '🥱'
                      : todayMood.mood === 'sad'
                      ? '😢'
                      : '😣'}
                  </span>
                  <span className="truncate">
                    {todayMood.pain_level === 'none'
                      ? 'Bem e sem dores'
                      : `Queixa de dor (${
                          todayMood.pain_locations?.length
                            ? todayMood.pain_locations
                                .map((p) =>
                                  p === 'head'
                                    ? 'cabeça'
                                    : p === 'belly'
                                    ? 'barriga'
                                    : p === 'back'
                                    ? 'costas'
                                    : p === 'legs'
                                    ? 'pernas'
                                    : p === 'chest'
                                    ? 'peito'
                                    : p === 'arms'
                                    ? 'braços'
                                    : p === 'feet'
                                    ? 'pés'
                                    : 'corpo'
                                )
                                .join(', ')
                            : 'dor relatada'
                        })`}
                  </span>
                </button>
              ) : isAdmin ? (
                <button
                  type="button"
                  onClick={() => {
                    setMoodModalMode('edit');
                    setShowMoodModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-50 dark:bg-white/[0.05] hover:bg-slate-100 dark:hover:bg-white/[0.09] text-slate-600 dark:text-zinc-300 border border-dashed border-slate-300 dark:border-white/[0.15] transition-all active:scale-95"
                >
                  <span className="text-indigo-500 dark:text-indigo-400 font-bold">+</span>
                  <span>Registrar bem-estar de hoje</span>
                </button>
              ) : null}
            </div>
          </div>

          {todayMood?.notes?.trim() && (
            <button
              type="button"
              onClick={() => {
                setMoodModalMode('view');
                setShowMoodModal(true);
              }}
              className="mt-3.5 w-full text-left bg-gray-50/90 hover:bg-gray-100/80 dark:bg-white/[0.04] dark:hover:bg-white/[0.07] border border-gray-200/70 dark:border-white/[0.08] rounded-2xl px-3.5 py-2.5 flex items-start gap-2.5 transition-all active:scale-[0.99]"
            >
              <MessageCircle className="w-3.5 h-3.5 text-gray-400 dark:text-zinc-500 mt-0.5 shrink-0" />
              <p className="text-xs text-gray-600 dark:text-zinc-300 leading-relaxed line-clamp-2 flex-1">
                <span className="font-semibold text-gray-700 dark:text-zinc-200">Recado: </span>
                {todayMood.notes.trim()}
              </p>
            </button>
          )}

          <DailyProgressBar total={events.length} completed={resolvedEventsCount} />
        </div>

        {/* Contingency stale cache notice */}
        {usingStaleFallback && (
          <div className="mx-6 mt-4 bg-slate-100 dark:bg-white/[0.05] border border-slate-200 dark:border-white/[0.08] rounded-xl px-3.5 py-2 flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-zinc-300">
            <span>Exibindo dados salvos no aparelho (sem confirmação recente do servidor).</span>
            <button
              type="button"
              onClick={() => refreshTimeline(patient.id, localDate)}
              className="font-semibold text-indigo-600 dark:text-indigo-400 shrink-0"
            >
              Atualizar
            </button>
          </div>
        )}

        {/* Inline error feedback */}
        {(actionError || loadError) && (
          <div className="mx-6 mt-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 rounded-2xl p-3.5 flex items-center justify-between gap-3 text-xs text-rose-700 dark:text-rose-300">
            <span>{actionError || loadError}</span>
            <button
              type="button"
              onClick={() => {
                setActionError(null);
                setLoadError(null);
                refreshTimeline(patient.id, localDate);
              }}
              className="font-semibold underline shrink-0"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {/* Banners */}
        {!dailyClosure && hasReopened && (
          <div className="mx-6 mt-6 bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900/50 rounded-2xl p-4 flex items-start gap-3 shadow-sm animate-in fade-in slide-in-from-top-2">
            <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/60 flex items-center justify-center shrink-0">
              <svg
                className="w-4 h-4 text-amber-600 dark:text-amber-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                Dia reaberto para alterações.
              </p>
              <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-0.5">
                Não esqueça de encerrá-lo novamente ao terminar.
              </p>
            </div>
          </div>
        )}

        {!dailyClosure && !hasReopened && isAllEventsCompleted && (
          <div className="mx-6 mt-6 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/50 rounded-2xl p-4 flex items-start gap-3 shadow-sm animate-in fade-in slide-in-from-top-2">
            <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/60 flex items-center justify-center shrink-0">
              <svg
                className="w-4 h-4 text-emerald-600 dark:text-emerald-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">Tudo pronto!</p>
              <p className="text-xs text-emerald-700/80 dark:text-emerald-300/80 mt-0.5">
                {isAdmin
                  ? 'Todas as atividades foram registradas. Você já pode encerrar o dia.'
                  : 'Todas as atividades de hoje já foram registradas.'}
              </p>
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="px-6 py-6 space-y-8 pb-36">
          {morning.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
                Manhã
              </h3>
              <div className="space-y-3 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gray-100 dark:before:bg-white/[0.08]">
                {morning.map((event) => (
                  <TimelineItem
                    profileId={profile?.id}
                    key={event.id}
                    event={event}
                    onClick={() =>
                      event.type === 'meal'
                        ? setSelectedMealEvent(event as MealEventData)
                        : setSelectedMedEvent(event as MedicationEventData)
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {afternoon.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
                Tarde
              </h3>
              <div className="space-y-3 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gray-100 dark:before:bg-white/[0.08]">
                {afternoon.map((event) => (
                  <TimelineItem
                    profileId={profile?.id}
                    key={event.id}
                    event={event}
                    onClick={() =>
                      event.type === 'meal'
                        ? setSelectedMealEvent(event as MealEventData)
                        : setSelectedMedEvent(event as MedicationEventData)
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {night.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
                Noite
              </h3>
              <div className="space-y-3 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gray-100 dark:before:bg-white/[0.08]">
                {night.map((event) => (
                  <TimelineItem
                    profileId={profile?.id}
                    key={event.id}
                    event={event}
                    onClick={() =>
                      event.type === 'meal'
                        ? setSelectedMealEvent(event as MealEventData)
                        : setSelectedMedEvent(event as MedicationEventData)
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {/* Closure Area */}
          <div className="px-0 pb-6">
            {dailyClosure ? (
              <div className="bg-gray-50 dark:bg-[#121216] border border-gray-200 dark:border-white/[0.08] rounded-xl p-4 flex flex-col items-center text-center">
                <div className="w-10 h-10 bg-green-100 dark:bg-emerald-950/60 text-green-600 dark:text-emerald-300 rounded-full flex items-center justify-center mb-2">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                <h3 className="font-semibold text-gray-900 dark:text-zinc-100">Dia encerrado</h3>
                <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">
                  Encerrado por {dailyClosure.closed_by_profile?.name || profile?.name || 'Familiar'} às{' '}
                  {formatDateToTime(dailyClosure.closed_at)}
                </p>
                {dailyClosure._syncPending && (
                  <span className="mt-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                    Salvo no aparelho • Aguardando envio
                  </span>
                )}

                {isAdmin && (
                  <button
                    type="button"
                    onClick={handleReopenDay}
                    disabled={reopeningDay}
                    className="mt-6 inline-flex items-center justify-center text-sm font-medium text-gray-500 dark:text-zinc-300 hover:text-gray-700 dark:hover:text-white bg-gray-50 dark:bg-[#1c1c22] hover:bg-gray-100 dark:hover:bg-[#26262f] px-5 py-2.5 rounded-2xl transition-all active:scale-95 border border-gray-200 dark:border-white/[0.1] disabled:opacity-50 w-full sm:w-auto"
                  >
                    {reopeningDay ? (
                      <Spinner className="w-4 h-4 mr-2" />
                    ) : (
                      <Unlock className="w-4 h-4 mr-2" />
                    )}
                    {reopeningDay ? 'Reabrindo...' : 'Desfazer e reabrir dia'}
                  </button>
                )}
              </div>
            ) : null}
          </div>

          {events.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-500 dark:text-zinc-400">Nenhum evento configurado para hoje.</p>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal for Closing Day (supports complete, incomplete, or zero-event days) */}
      {showClosureModal && patient && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 dark:bg-black/75 p-4">
          <div className="bg-white dark:bg-[#141419] dark:border dark:border-white/[0.08] rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100 mb-2">
              Encerrar o dia?
            </h3>
            <p className="text-sm text-gray-500 dark:text-zinc-400 mb-4">
              {events.length === 0 ? (
                <>
                  Nenhuma atividade foi configurada na rotina para este dia. Deseja encerrá-lo mesmo assim?
                </>
              ) : pendingEventsCount > 0 ? (
                <>
                  {pendingEventsCount === 1
                    ? 'Existe 1 atividade sem registro neste dia. Deseja encerrá-lo mesmo assim?'
                    : `Existem ${pendingEventsCount} atividades sem registro neste dia. Deseja encerrá-lo mesmo assim?`}
                  <span className="block mt-2 text-xs text-gray-400 dark:text-zinc-500">
                    Os registros já preenchidos e as pendências continuarão preservados como estão.
                  </span>
                </>
              ) : (
                <>
                  Você está encerrando a rotina de {patient.name} deste dia. Depois disso, o dia aparecerá como concluído no Histórico.
                </>
              )}
            </p>

            {actionError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 text-xs text-rose-700 dark:text-rose-300">
                {actionError}
              </div>
            )}

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                disabled={closingDay}
                onClick={() => {
                  setActionError(null);
                  setShowClosureModal(false);
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-white/[0.08] rounded-xl transition-colors disabled:opacity-50"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={handleCloseDay}
                disabled={closingDay}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50 transition-colors"
              >
                {closingDay
                  ? 'Encerrando...'
                  : events.length === 0 || pendingEventsCount > 0
                  ? 'Encerrar mesmo assim'
                  : 'Encerrar dia'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {selectedMealEvent && patient && profile && (
        <MealModal
          isOpen={!!selectedMealEvent}
          onClose={() => setSelectedMealEvent(null)}
          event={selectedMealEvent}
          patientId={patient.id}
          profileId={profile.id}
          eventDate={localDate}
          patientGender={patient.gender}
          isDayClosed={!!dailyClosure}
          canEdit={isAdmin}
          onSuccess={handleMealRefresh}
        />
      )}

      {selectedMedEvent && patient && profile && (
        <MedicationModal
          isOpen={!!selectedMedEvent}
          onClose={() => setSelectedMedEvent(null)}
          event={selectedMedEvent}
          patientId={patient.id}
          profileId={profile.id}
          eventDate={localDate}
          isDayClosed={!!dailyClosure}
          canEdit={isAdmin}
          onSuccess={handleMedRefresh}
          onPartialSuccess={() => {
            if (patient) refreshTimeline(patient.id, localDate);
          }}
        />
      )}

      {/* Mood and Pain Modal */}
      {showMoodModal && patient && profile && (
        <MoodAndPainModal
          isOpen={showMoodModal}
          onClose={() => setShowMoodModal(false)}
          patientId={patient.id}
          familyId={profile.family_id}
          profileId={profile.id}
          patientName={patient.name}
          dateStr={localDate}
          currentLog={todayMood}
          mode={moodModalMode}
          canEdit={isAdmin}
          onSuccess={(updatedLog) => {
            setTodayMood(updatedLog);
          }}
        />
      )}

      {/* Sticky Bottom Footer for Closing the Day: ADMIN only while day is not closed */}
      {isAdmin && !dailyClosure && (
        <div className="fixed bottom-[80px] left-0 right-0 z-40 px-4 sm:max-w-md mx-auto w-full pb-4 animate-in slide-in-from-bottom-6 fade-in duration-300">
          <div className="bg-white/90 dark:bg-[#141419]/92 backdrop-blur-md border border-gray-200 dark:border-white/[0.1] p-3 rounded-2xl shadow-lg flex items-center justify-between">
            <div className="pl-2 pr-4">
              <p className="text-sm font-bold text-gray-900 dark:text-zinc-100">Encerrar Dia</p>
              <p className="text-[11px] font-medium text-gray-500 dark:text-zinc-400">
                {events.length === 0
                  ? 'Nenhuma atividade configurada.'
                  : pendingEventsCount > 0
                  ? `${pendingEventsCount} ${
                      pendingEventsCount === 1 ? 'atividade pendente' : 'atividades pendentes'
                    }`
                  : 'Tudo registrado hoje.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setActionError(null);
                setShowClosureModal(true);
              }}
              className="bg-black dark:bg-indigo-600 hover:bg-gray-900 dark:hover:bg-indigo-500 active:bg-gray-800 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-all shadow-md active:scale-95 shrink-0"
            >
              Encerrar Dia
            </button>
          </div>
        </div>
      )}
    </MainLayout>
  );
}
