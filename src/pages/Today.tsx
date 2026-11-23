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
  getActivities,
  getActivityLogs,
  getDailyMoodLog,
  getMyFamilyPermissions,
  type DailyMoodLog,
  getPatientPhotoUrl,
  getMealPhotoUrl,
  getDailyClosure,
  createDailyClosure,
  deleteDailyClosure,
  getPendingShoppingItems,
  mapWithConcurrency,
  subscribeStaleCache,
  isUsingStaleCache,
} from '../services/api';
import { getSyncQueue } from '../services/syncQueue';
import { useNetwork } from '../contexts/NetworkContext';
import { supabase } from '../services/supabase';
import {
  DEFAULT_TIMEZONE,
  getLocalDateString,
  getCurrentLocalTime,
  formatFriendlyDate,
  formatDateToTime,
  formatTime,
  isAfterClosureReminderTime,
  getMsUntilNextClosureBoundary,
} from '../utils/date';
import {
  isMedicationScheduledForDate,
  getTimelineProgressMetrics,
} from '../utils/medicationSchedule';
import {
  isActivityScheduledForDate,
  getUpcomingScheduledActivities,
  formatShortDateBR,
  formatDaysUntilLabel,
} from '../utils/activitySchedule';
import {
  isUpcomingActivityBannerDismissed,
  dismissUpcomingActivityBanner,
  shouldShowUpcomingActivityBanner,
} from '../utils/activityReminder';
import {
  isClosureReminderDismissed,
  dismissClosureReminder,
  shouldShowClosureReminderBanner,
} from '../utils/closureReminder';
import { Spinner } from '../components/ui/Spinner';
import { TimelineItem } from '../components/timeline/TimelineItem';
import { DailyProgressBar } from '../components/timeline/DailyProgressBar';
import { MealModal } from '../components/meals/MealModal';
import {
  findRecoverableMealDraftForDate,
  cleanupExpiredMealDrafts,
} from '../services/mealDrafts';
import { UserProfile } from '../components/ui/UserProfile';
import { NotificationBell } from '../components/notifications/NotificationBell';
import { PushAuthorizationPrompt } from '../components/notifications/PushAuthorizationPrompt';
import {
  getActivityMilestoneBadge,
  isActivityMilestoneDays,
} from '../utils/notifications';
import { MedicationModal } from '../components/medications/MedicationModal';
import { ActivityModal } from '../components/activities/ActivityModal';
import { ActivityFormModal } from '../components/routine/ActivityFormModal';
import { MoodAndPainModal } from '../components/mood/MoodAndPainModal';
import { ShoppingHomeCard } from '../components/shopping/ShoppingHomeCard';
import { ShoppingListModal } from '../components/shopping/ShoppingListModal';
import type { ShoppingItemRecord } from '../utils/shopping';
import type {
  TimelineEvent,
  MealEventData,
  MedicationEventData,
  ActivityEventData,
  EventSyncStatus,
} from '../types/timeline';
import { Unlock, MessageCircle, AlertCircle, RefreshCw, X, CheckCircle2, CalendarClock, Plus } from 'lucide-react';

const DEFAULT_NOW_PROVIDER = () => new Date();

export interface ClosureReminderBannerProps {
  eventsCount: number;
  pendingEventsCount: number;
  onRequestClose: () => void;
  onDismiss: () => void;
}

export function ClosureReminderBanner({
  eventsCount,
  pendingEventsCount,
  onRequestClose,
  onDismiss,
}: ClosureReminderBannerProps) {
  return (
    <div
      role="region"
      aria-label="Lembrete de encerramento diário"
      className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-0 right-0 z-40 px-3.5 sm:px-4 max-w-md mx-auto w-full animate-in slide-in-from-bottom-6 fade-in duration-300"
    >
      <div className="bg-white/95 dark:bg-[#141419]/95 backdrop-blur-xl border border-gray-200/90 dark:border-white/[0.12] px-3.5 py-2.5 rounded-2xl shadow-lg dark:shadow-black/50 flex items-center justify-between gap-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-gray-900 dark:text-zinc-100 leading-tight">
            Encerrar Dia
          </p>
          <p className="text-[11px] font-medium text-gray-500 dark:text-zinc-400 truncate mt-0.5">
            {eventsCount === 0
              ? 'Nenhuma atividade configurada.'
              : pendingEventsCount > 0
              ? `${pendingEventsCount} ${
                  pendingEventsCount === 1 ? 'atividade pendente' : 'atividades pendentes'
                }`
              : 'Tudo registrado hoje.'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onRequestClose}
            className="bg-black dark:bg-indigo-600 hover:bg-gray-900 dark:hover:bg-indigo-500 active:bg-gray-800 text-white px-3.5 py-2 rounded-xl text-xs font-semibold transition-all shadow-sm active:scale-95 whitespace-nowrap"
          >
            Encerrar Dia
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dispensar lembrete de encerramento"
            title="Dispensar lembrete hoje"
            className="min-w-[36px] min-h-[36px] w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-gray-100 dark:hover:bg-white/[0.08] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function TodayScreen({
  onTabChange,
  editingDateStr,
  onClearEditDate,
  nowProvider = DEFAULT_NOW_PROVIDER,
}: {
  onTabChange?: (tab: 'today' | 'history' | 'routine') => void;
  editingDateStr?: string | null;
  onClearEditDate?: () => void;
  nowProvider?: () => Date;
}) {
  const { syncVersion } = useNetwork();

  const [clockDate, setClockDate] = useState<string>(() =>
    getLocalDateString(DEFAULT_TIMEZONE, nowProvider())
  );
  const [isAfterReminderTime, setIsAfterReminderTime] = useState<boolean>(() =>
    isAfterClosureReminderTime(nowProvider(), DEFAULT_TIMEZONE, 21)
  );
  const [dismissSyncTick, setDismissSyncTick] = useState(0);
  const [dismissActivityTick, setDismissActivityTick] = useState(0);
  const [isRecadoExpanded, setIsRecadoExpanded] = useState(false);

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
  const [allActivities, setAllActivities] = useState<any[]>([]);
  const [loadedDate, setLoadedDate] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Mood & Pain state
  const [todayMood, setTodayMood] = useState<DailyMoodLog | null>(null);
  const [showMoodModal, setShowMoodModal] = useState(false);
  const [moodModalMode, setMoodModalMode] = useState<'view' | 'edit'>('view');
  const [isAdmin, setIsAdmin] = useState(false);
  const [canRecordDailyActivities, setCanRecordDailyActivities] = useState(false);

  // Modals state
  const [selectedMealEvent, setSelectedMealEvent] = useState<MealEventData | null>(null);
  const [selectedMedEvent, setSelectedMedEvent] = useState<MedicationEventData | null>(null);
  const [selectedActivityEvent, setSelectedActivityEvent] = useState<ActivityEventData | null>(null);
  const [showActivityFormModal, setShowActivityFormModal] = useState(false);

  // Shopping list state
  const [shoppingItems, setShoppingItems] = useState<ShoppingItemRecord[]>([]);
  const [showShoppingModal, setShowShoppingModal] = useState(false);
  const [shoppingModalMode, setShoppingModalMode] = useState<'list' | 'add'>('list');

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

  const syncTimeState = useCallback(() => {
    const now = nowProvider();
    const current = getLocalDateString(DEFAULT_TIMEZONE, now);
    const after21 = isAfterClosureReminderTime(now, DEFAULT_TIMEZONE, 21);
    setClockDate((prev) => (prev !== current ? current : prev));
    setIsAfterReminderTime((prev) => (prev !== after21 ? after21 : prev));
  }, [nowProvider]);

  useEffect(() => {
    isMountedRef.current = true;
    const unsubStale = subscribeStaleCache((isStale) => {
      if (isMountedRef.current) setUsingStaleFallback(isStale);
    });

    syncTimeState();
    void cleanupExpiredMealDrafts();

    // Schedule exact wakeup for the next local America/Sao_Paulo boundary (21:00 or 00:00)
    // so the reminder appears automatically without refresh, plus 60s drift/sleep safety check.
    let boundaryTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleNextBoundary = () => {
      const delayMs = getMsUntilNextClosureBoundary(nowProvider(), DEFAULT_TIMEZONE, 21);
      boundaryTimer = setTimeout(() => {
        if (!isMountedRef.current) return;
        syncTimeState();
        scheduleNextBoundary();
      }, delayMs);
    };
    scheduleNextBoundary();

    const safetyInterval = setInterval(syncTimeState, 60_000);

    return () => {
      isMountedRef.current = false;
      unsubStale();
      if (boundaryTimer) clearTimeout(boundaryTimer);
      clearInterval(safetyInterval);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      revokeOfflinePreviewUrls();
    };
  }, [nowProvider, revokeOfflinePreviewUrls, syncTimeState]);

  const refreshTimeline = useCallback(
    async (patientId: string, dateStr: string, explicitUserId?: string) => {
      const reqSeq = ++timelineReqSeqRef.current;
      try {
        const [
          meals,
          medPeriods,
          allMeds,
          loadedActivities,
          mealLogs,
          medLogs,
          activityLogs,
          moodLog,
          closure,
          syncQueue,
          pendingShopping,
        ] = await Promise.all([
          getMealConfigs(patientId),
          getMedicationPeriods(patientId),
          getMedications(patientId),
          getActivities(patientId),
          getMealLogs(patientId, dateStr),
          getMedicationLogs(patientId, dateStr),
          getActivityLogs(patientId, dateStr),
          getDailyMoodLog(patientId, dateStr),
          getDailyClosure(patientId, dateStr),
          getSyncQueue(),
          getPendingShoppingItems(patientId).catch(() => []),
        ]);

        if (!isMountedRef.current || reqSeq !== timelineReqSeqRef.current) {
          return;
        }

        const scopedQueue = syncQueue.filter(
          (item) => item.patientId === patientId && item.eventDate === dateStr
        );

        const currentTime = getCurrentLocalTime();

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
        const loggedMedIdsOnDate = new Set(medLogs.map((l) => l.medication_id));

        for (const period of medPeriods) {
          const periodMeds = allMeds.filter((m) => {
            if (m.medication_period_id !== period.id) return false;
            return isMedicationScheduledForDate(m, dateStr) || loggedMedIdsOnDate.has(m.id);
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
          } else if (hasNotAdministered) {
            status = 'attention';
          } else if (periodLogs.length > 0 || period.scheduled_time <= currentTime) {
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

        // 3. Process Activities scheduled for dateStr (or already logged on dateStr)
        const loggedActivityIds = new Set(activityLogs.map((l) => l.activity_id));
        const scheduledActivitiesForDate = loadedActivities.filter(
          (act) => isActivityScheduledForDate(act, dateStr) || loggedActivityIds.has(act.id)
        );

        for (const act of scheduledActivitiesForDate) {
          const log = activityLogs.find((l) => l.activity_id === act.id);
          const matchingQueueItems = scopedQueue.filter(
            (q) =>
              (q.action === 'createActivityLog' && q.payload?.activity_id === act.id) ||
              (q.action === 'updateActivityLog' &&
                ((log && q.payload?.id === log.id) || q.payload?.activity_id === act.id))
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

          let status: 'waiting' | 'pending' | 'confirmed' | 'attention' = 'waiting';
          if (log) {
            status = log.status === 'not_completed' ? 'attention' : 'confirmed';
          } else if (act.scheduled_time <= currentTime) {
            status = 'pending';
          }

          timeline.push({
            id: act.id,
            type: 'activity',
            time: act.scheduled_time,
            title: act.title,
            status,
            _syncStatus: syncStatus,
            _syncError: syncError,
            activity: act,
            log,
          });
        }

        timeline.sort((a, b) => a.time.localeCompare(b.time));

        setTodayMood(moodLog);
        setDailyClosure(closure);
        setAllActivities(loadedActivities);
        setShoppingItems(pendingShopping);
        setEvents(timeline);
        setLoadedDate(dateStr);
        setLoadError(null);

        // Restore in-progress meal draft from scoped IndexedDB storage if PWA/tab restarted after camera/picker return
        try {
          let resolvedUserId = explicitUserId || profile?.id;
          if (!resolvedUserId) {
            const { data: sessionData } = await supabase.auth.getSession();
            resolvedUserId = sessionData?.session?.user?.id;
          }
          if (resolvedUserId) {
            const recoverableDraft = await findRecoverableMealDraftForDate(
              resolvedUserId,
              patientId,
              dateStr,
              'today'
            );
            if (recoverableDraft && isMountedRef.current && reqSeq === timelineReqSeqRef.current) {
              const targetEvent = timeline.find(
                (e) => e.type === 'meal' && e.id === recoverableDraft.mealId
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
    [profile?.id, revokeOfflinePreviewUrls]
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

      const [pat, perms] = await Promise.all([
        getPatient(prof.family_id),
        getMyFamilyPermissions(prof.family_id),
      ]);
      if (!isMountedRef.current || seq !== loadSeqRef.current) return;

      setIsAdmin(perms.isAdmin);
      setCanRecordDailyActivities(perms.isMember);
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

      await refreshTimeline(pat.id, localDate, prof.id);
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

    const activitiesSub = supabase
      .channel(`patient:${pid}:activities`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'activities', filter: `patient_id=eq.${pid}` },
        () => scheduleRefresh(pid, localDate, 250)
      )
      .subscribe();

    const activityLogsSub = supabase
      .channel(`patient:${pid}:activity_logs`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'activity_logs', filter: `patient_id=eq.${pid}` },
        () => scheduleRefresh(pid, localDate, 250)
      )
      .subscribe();

    const shoppingSub = supabase
      .channel(`patient:${pid}:shopping_items`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shopping_items', filter: `patient_id=eq.${pid}` },
        () => scheduleRefresh(pid, localDate, 250)
      )
      .subscribe();

    const triggerFocusRefresh = () => {
      syncTimeState();
      const now = Date.now();
      if (now - lastFocusRefreshRef.current < 1500) return;
      lastFocusRefreshRef.current = now;
      scheduleRefresh(pid, localDate, 100);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
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
      supabase.removeChannel(activitiesSub);
      supabase.removeChannel(activityLogsSub);
      supabase.removeChannel(shoppingSub);
      window.removeEventListener('focus', triggerFocusRefresh);
      window.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [patient?.id, localDate, scheduleRefresh, syncTimeState]);

  useEffect(() => {
    setIsRecadoExpanded(false);
  }, [localDate, todayMood?.notes]);

  const handleMealRefresh = () => {
    if (patient) refreshTimeline(patient.id, localDate);
    setSelectedMealEvent(null);
  };

  const handleMedRefresh = () => {
    if (patient) refreshTimeline(patient.id, localDate);
    setSelectedMedEvent(null);
  };

  const handleActivityRefresh = () => {
    if (patient) refreshTimeline(patient.id, localDate);
    setSelectedActivityEvent(null);
  };

  const handleActivityFormSuccess = () => {
    setShowActivityFormModal(false);
    if (patient) refreshTimeline(patient.id, localDate);
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
    if (!canRecordDailyActivities) {
      setActionError('Sua conta não possui vínculo ativo com esta família para encerrar o dia.');
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

  const {
    totalItems,
    completedItems,
    pendingItems,
    allCompleted: isAllEventsCompleted,
  } = getTimelineProgressMetrics(events);

  const isViewingToday = localDate === clockDate;
  const isClosureBannerDismissed =
    isClosureReminderDismissed(profile?.id, patient?.id, localDate) && dismissSyncTick >= 0;

  const showClosureReminderBanner = shouldShowClosureReminderBanner({
    canCloseDay: canRecordDailyActivities,
    isAdmin,
    isViewingToday,
    isDayClosed: Boolean(dailyClosure),
    isAfterReminderTime,
    isDismissed: isClosureBannerDismissed,
  });

  const handleDismissClosureBanner = () => {
    dismissClosureReminder(profile?.id, patient?.id, localDate);
    setDismissSyncTick((tick) => tick + 1);
  };

  const upcomingActivities = getUpcomingScheduledActivities(allActivities, clockDate, 1, 7);
  const upcomingBannerRawActivities = upcomingActivities.map((item) => item.activity);
  const isUpcomingBannerDismissed =
    isUpcomingActivityBannerDismissed(
      profile?.id,
      patient?.id,
      clockDate,
      upcomingBannerRawActivities
    ) && dismissActivityTick >= 0;

  const showUpcomingActivityBanner = shouldShowUpcomingActivityBanner({
    isViewingToday,
    isDayClosed: Boolean(dailyClosure),
    upcomingCount: upcomingActivities.length,
    isDismissed: isUpcomingBannerDismissed,
  });

  const handleDismissUpcomingBanner = () => {
    dismissUpcomingActivityBanner(
      profile?.id,
      patient?.id,
      clockDate,
      upcomingBannerRawActivities
    );
    setDismissActivityTick((tick) => tick + 1);
  };

  const handleSelectEvent = (event: TimelineEvent) => {
    if (event.type === 'meal') setSelectedMealEvent(event as MealEventData);
    else if (event.type === 'activity') setSelectedActivityEvent(event as ActivityEventData);
    else setSelectedMedEvent(event as MedicationEventData);
  };

  const morning = events.filter((e) => e.time < '12:00:00');
  const afternoon = events.filter((e) => e.time >= '12:00:00' && e.time < '18:00:00');
  const night = events.filter((e) => e.time >= '18:00:00');

  const moodEmoji = todayMood
    ? todayMood.mood === 'happy'
      ? '😊'
      : todayMood.mood === 'calm'
      ? '😌'
      : todayMood.mood === 'tired'
      ? '🥱'
      : todayMood.mood === 'sad'
      ? '😢'
      : '😣'
    : null;

  const moodSummaryText = todayMood
    ? todayMood.pain_level === 'none'
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
        })`
    : '';

  const recadoText = todayMood?.notes?.trim() || '';
  const isLongRecado = recadoText.length > 72 || recadoText.includes('\n');

  return (
    <MainLayout activeTab={editingDateStr ? 'history' : 'today'} onTabChange={onTabChange}>
      <div className="max-w-md mx-auto w-full">
        {/* Barra superior compacta (apenas logo + perfil permanecem fixos durante a rolagem) */}
        <header className="sticky top-0 z-30 bg-white/95 dark:bg-[#111115]/95 backdrop-blur-xl border-b border-gray-100/80 dark:border-white/[0.08] px-4 pt-safe transition-colors">
          <div className="h-12 flex items-center justify-between gap-4">
            <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-zinc-100 whitespace-nowrap shrink-0">
              DUCA
            </h1>
            <div className="flex items-center gap-2 shrink-0">
              <NotificationBell
                familyId={profile?.family_id}
                patientId={patient?.id}
                patientName={patient?.name}
                userId={profile?.id}
                activities={allActivities}
                todayDateStr={clockDate}
              />
              <UserProfile />
            </div>
          </div>
        </header>

        {/* Banner de Edição do Passado */}
        {editingDateStr && (
          <div className="bg-indigo-50 dark:bg-indigo-950/50 px-4 py-2.5 border-b border-indigo-100 dark:border-indigo-900/50 flex items-center justify-between gap-2 shadow-sm">
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-indigo-800 dark:text-indigo-300 uppercase tracking-wider leading-tight">
                Modo de Edição
              </p>
              <p className="text-xs font-medium text-indigo-900 dark:text-indigo-100 truncate mt-0.5">
                Editando o dia {friendlyDate}
              </p>
            </div>
            <button
              type="button"
              onClick={onClearEditDate}
              className="text-xs font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-100/60 dark:bg-indigo-900/50 hover:bg-indigo-200 dark:hover:bg-indigo-800/60 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Voltar a Hoje
            </button>
          </div>
        )}

        {/* Cabeçalho informativo do idoso, bem-estar, recado e progresso (acompanha a rolagem) */}
        <section className="bg-white dark:bg-[#111115] px-4 pt-3 pb-3 border-b border-gray-100 dark:border-white/[0.08] transition-colors space-y-2.5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setMoodModalMode(todayMood || !canRecordDailyActivities ? 'view' : 'edit');
                setShowMoodModal(true);
              }}
              className="relative group transition-transform active:scale-95 focus:outline-none shrink-0"
              title={
                todayMood
                  ? 'Ver avaliação de bem-estar de hoje'
                  : canRecordDailyActivities
                  ? 'Registrar como está hoje'
                  : 'Ver bem-estar de hoje'
              }
            >
              <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-[#1c1c22] border-2 border-white dark:border-zinc-900 shadow-sm overflow-hidden flex items-center justify-center ring-2 ring-indigo-100 dark:ring-indigo-500/30 group-hover:ring-indigo-300 dark:group-hover:ring-indigo-400/50 transition-all">
                {patientPhoto ? (
                  <img src={patientPhoto} alt={patient.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xl">👵</span>
                )}
              </div>

              {todayMood && moodEmoji ? (
                <div
                  className={`absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[11px] shadow-sm border-2 border-white dark:border-[#111115] ${
                    todayMood.pain_level !== 'none'
                      ? 'bg-rose-50 dark:bg-rose-950 ring-1 ring-rose-300 dark:ring-rose-800'
                      : 'bg-emerald-50 dark:bg-emerald-950 ring-1 ring-emerald-300 dark:ring-emerald-800'
                  }`}
                >
                  {moodEmoji}
                </div>
              ) : canRecordDailyActivities ? (
                <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-indigo-50 dark:bg-indigo-950 border-2 border-white dark:border-[#111115] ring-1 ring-indigo-200 dark:ring-indigo-700 flex items-center justify-center text-[10px] text-indigo-600 dark:text-indigo-300 shadow-sm">
                  +
                </div>
              ) : null}
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-zinc-100 truncate leading-tight">
                  {patient.name}
                </h2>

                {todayMood ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMoodModalMode('view');
                      setShowMoodModal(true);
                    }}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium border transition-all active:scale-95 shrink-0 max-w-[56%] ${
                      todayMood.pain_level === 'none'
                        ? 'bg-emerald-50/90 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-200/70 dark:border-emerald-800/50 hover:bg-emerald-100/70 dark:hover:bg-emerald-950/80'
                        : 'bg-rose-50/90 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300 border-rose-200/70 dark:border-rose-800/50 hover:bg-rose-100/70 dark:hover:bg-rose-950/80'
                    }`}
                    title={moodSummaryText}
                  >
                    <span className="text-xs shrink-0">{moodEmoji}</span>
                    <span className="truncate">{moodSummaryText}</span>
                  </button>
                ) : canRecordDailyActivities ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMoodModalMode('edit');
                      setShowMoodModal(true);
                    }}
                    aria-label="Registrar bem-estar de hoje"
                    title="Registrar bem-estar de hoje"
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium bg-slate-50 dark:bg-white/[0.05] hover:bg-slate-100 dark:hover:bg-white/[0.09] text-slate-600 dark:text-zinc-300 border border-dashed border-slate-300 dark:border-white/[0.15] transition-all active:scale-95 shrink-0 whitespace-nowrap"
                  >
                    <span className="text-indigo-500 dark:text-indigo-400 font-bold">+</span>
                    <span>Bem-estar</span>
                  </button>
                ) : null}
              </div>

              <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5 truncate">
                {editingDateStr && !isViewingToday ? friendlyDate : `Hoje, ${friendlyDate}`}
              </p>
            </div>
          </div>

          {recadoText && (
            <div className="bg-gray-50/90 dark:bg-white/[0.04] border border-gray-200/70 dark:border-white/[0.08] rounded-xl px-3 py-2 flex items-start gap-2 transition-colors">
              <MessageCircle className="w-3.5 h-3.5 text-gray-400 dark:text-zinc-500 mt-0.5 shrink-0" />
              <button
                type="button"
                onClick={() => {
                  if (isLongRecado) {
                    setIsRecadoExpanded((prev) => !prev);
                  } else {
                    setMoodModalMode('view');
                    setShowMoodModal(true);
                  }
                }}
                className="flex-1 min-w-0 text-left focus:outline-none"
              >
                <p
                  className={`text-xs text-gray-600 dark:text-zinc-300 leading-snug ${
                    isRecadoExpanded ? 'whitespace-pre-wrap break-words' : 'line-clamp-1'
                  }`}
                >
                  <span className="font-semibold text-gray-700 dark:text-zinc-200">Recado: </span>
                  {recadoText}
                </p>
              </button>
              {isLongRecado && (
                <button
                  type="button"
                  onClick={() => setIsRecadoExpanded((prev) => !prev)}
                  className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 shrink-0 whitespace-nowrap pl-1 hover:underline"
                >
                  {isRecadoExpanded ? 'Menos' : 'Ver mais'}
                </button>
              )}
            </div>
          )}

          <ShoppingHomeCard
            items={shoppingItems}
            canEdit={canRecordDailyActivities}
            onOpenList={() => {
              setShoppingModalMode('list');
              setShowShoppingModal(true);
            }}
            onQuickAdd={() => {
              setShoppingModalMode('add');
              setShowShoppingModal(true);
            }}
          />

          <DailyProgressBar total={totalItems} completed={completedItems} />
        </section>

        {/* Contingency stale cache notice */}
        {usingStaleFallback && (
          <div className="mx-3.5 sm:mx-5 mt-3 bg-slate-100 dark:bg-white/[0.05] border border-slate-200 dark:border-white/[0.08] rounded-xl px-3.5 py-2 flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-zinc-300">
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
          <div className="mx-3.5 sm:mx-5 mt-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 rounded-2xl p-3 flex items-center justify-between gap-3 text-xs text-rose-700 dark:text-rose-300">
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

        {/* Dismissible Upcoming Activity Banner (1 to 7 days ahead) */}
        {showUpcomingActivityBanner && (
          <div
            role="region"
            aria-label="Aviso de atividade agendada"
            className="mx-3.5 sm:mx-5 mt-3 bg-indigo-50/90 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/50 rounded-2xl p-3.5 flex items-start gap-3 shadow-sm animate-in fade-in slide-in-from-top-2"
          >
            <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/60 flex items-center justify-center shrink-0 mt-0.5">
              <CalendarClock className="w-4 h-4 text-indigo-600 dark:text-indigo-300" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                {upcomingActivities.length === 1
                  ? 'Atividade agendada próxima'
                  : `${upcomingActivities.length} atividades agendadas nos próximos dias`}
              </p>
              <div className="mt-1 space-y-1">
                {upcomingActivities.slice(0, 2).map(({ activity, daysUntil }) => {
                  const isExactMilestone = isActivityMilestoneDays(daysUntil);
                  return (
                    <div key={activity.id} className="text-xs text-indigo-950 dark:text-indigo-100 leading-snug">
                      {isExactMilestone && (
                        <span
                          className={`inline-block mr-1.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide align-middle ${
                            daysUntil === 1
                              ? 'bg-rose-100 dark:bg-rose-900/60 text-rose-800 dark:text-rose-200'
                              : daysUntil === 3
                              ? 'bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200'
                              : 'bg-indigo-100 dark:bg-indigo-900/70 text-indigo-800 dark:text-indigo-200'
                          }`}
                        >
                          {getActivityMilestoneBadge(daysUntil)}
                        </span>
                      )}
                      <span className="font-semibold">{activity.title}</span>
                      <span className="text-indigo-700/90 dark:text-indigo-300 tabular-nums">
                        {' '}
                        · {formatDaysUntilLabel(daysUntil)} ({formatShortDateBR(activity.scheduled_date)} às{' '}
                        {formatTime(activity.scheduled_time || '09:00')})
                      </span>
                      {activity.notes && (
                        <span className="block text-[11px] text-indigo-700/80 dark:text-indigo-300/80 truncate">
                          {activity.notes}
                        </span>
                      )}
                    </div>
                  );
                })}
                {upcomingActivities.length > 2 && (
                  <p className="text-[11px] font-medium text-indigo-700/85 dark:text-indigo-300/85">
                    + {upcomingActivities.length - 2} outra(s) nos próximos 7 dias em Rotina
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={handleDismissUpcomingBanner}
              aria-label="Fechar aviso de atividade agendada"
              title="Fechar aviso"
              className="min-w-[44px] min-h-[44px] -mr-2 -mt-2 flex items-center justify-center rounded-xl text-indigo-500 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-white hover:bg-indigo-100/70 dark:hover:bg-white/[0.08] transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <PushAuthorizationPrompt
          familyId={profile?.family_id}
          patientId={patient?.id}
          patientName={patient?.name}
          userId={profile?.id}
          onPushReceived={() => {
            if (patient?.id && localDate) {
              void refreshTimeline(patient.id, localDate);
            }
          }}
        />

        {/* Banners */}
        {!dailyClosure && hasReopened && (
          <div className="mx-3.5 sm:mx-5 mt-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900/50 rounded-2xl p-3.5 flex items-start gap-3 shadow-sm animate-in fade-in slide-in-from-top-2">
            <div className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-900/60 flex items-center justify-center shrink-0">
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
          <div className="mx-3.5 sm:mx-5 mt-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/50 rounded-2xl p-3.5 flex items-start gap-3 shadow-sm animate-in fade-in slide-in-from-top-2">
            <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/60 flex items-center justify-center shrink-0">
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
                {canRecordDailyActivities
                  ? 'Todas as atividades foram registradas. Você já pode encerrar o dia.'
                  : 'Todas as atividades de hoje já foram registradas.'}
              </p>
            </div>
          </div>
        )}

        {/* Quick Create Same-Day or Scheduled Activity directly from Home */}
        {!dailyClosure && canRecordDailyActivities && (
          <div className="px-3.5 sm:px-5 pt-3 flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-gray-400 dark:text-zinc-500">
              Linha do tempo
            </span>
            <button
              type="button"
              onClick={() => setShowActivityFormModal(true)}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50/90 dark:bg-indigo-950/45 border border-indigo-200/70 dark:border-indigo-800/50 hover:bg-indigo-100/80 dark:hover:bg-indigo-900/50 transition-all active:scale-95 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Atividade</span>
            </button>
          </div>
        )}

        {/* Timeline */}
        <div
          className={`px-3.5 sm:px-5 pt-3.5 space-y-5 ${
            showClosureReminderBanner ? 'pb-28' : 'pb-8'
          }`}
        >
          {morning.length > 0 && (
            <div className="space-y-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
                Manhã
              </h3>
              <div className="space-y-2.5 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gray-100 dark:before:bg-white/[0.08]">
                {morning.map((event) => (
                  <TimelineItem
                    profileId={profile?.id}
                    key={`${event.type}-${event.id}`}
                    event={event}
                    onClick={() => handleSelectEvent(event)}
                  />
                ))}
              </div>
            </div>
          )}

          {afternoon.length > 0 && (
            <div className="space-y-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
                Tarde
              </h3>
              <div className="space-y-2.5 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gray-100 dark:before:bg-white/[0.08]">
                {afternoon.map((event) => (
                  <TimelineItem
                    profileId={profile?.id}
                    key={`${event.type}-${event.id}`}
                    event={event}
                    onClick={() => handleSelectEvent(event)}
                  />
                ))}
              </div>
            </div>
          )}

          {night.length > 0 && (
            <div className="space-y-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
                Noite
              </h3>
              <div className="space-y-2.5 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gray-100 dark:before:bg-white/[0.08]">
                {night.map((event) => (
                  <TimelineItem
                    profileId={profile?.id}
                    key={`${event.type}-${event.id}`}
                    event={event}
                    onClick={() => handleSelectEvent(event)}
                  />
                ))}
              </div>
            </div>
          )}

          {events.length === 0 && (
            <div className="text-center py-8">
              <p className="text-gray-500 dark:text-zinc-400">Nenhum evento configurado para hoje.</p>
            </div>
          )}

          {/* Sessão Final: Encerramento do Dia (disponível a qualquer horário para todas as contas ativas) */}
          {(dailyClosure || canRecordDailyActivities) && (
            <section aria-label="Encerramento do dia" className="space-y-2.5 pt-1 pb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
                Encerramento do dia
              </h3>

              {dailyClosure ? (
                <div className="bg-gray-50 dark:bg-[#121216] border border-gray-200 dark:border-white/[0.08] rounded-2xl p-4 flex flex-col items-center text-center shadow-sm">
                  <div className="w-10 h-10 bg-green-100 dark:bg-emerald-950/60 text-green-600 dark:text-emerald-300 rounded-full flex items-center justify-center mb-2">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <h4 className="font-semibold text-gray-900 dark:text-zinc-100">Dia encerrado</h4>
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
                      className="mt-5 inline-flex items-center justify-center text-sm font-medium text-gray-500 dark:text-zinc-300 hover:text-gray-700 dark:hover:text-white bg-white dark:bg-[#1c1c22] hover:bg-gray-100 dark:hover:bg-[#26262f] px-5 py-2.5 rounded-2xl transition-all active:scale-95 border border-gray-200 dark:border-white/[0.1] disabled:opacity-50 w-full sm:w-auto"
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
              ) : (
                <div className="bg-white dark:bg-[#121216] border border-gray-200/90 dark:border-white/[0.08] rounded-2xl p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                        isAllEventsCompleted
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300'
                          : 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300'
                      }`}
                    >
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                        {isAllEventsCompleted ? 'Rotina do dia concluída' : 'Encerrar rotina do dia'}
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1 leading-relaxed">
                        {isAllEventsCompleted
                          ? 'Todas as atividades foram registradas. Toque abaixo para finalizar o dia.'
                          : totalItems > 0
                          ? `${completedItems} de ${totalItems} atividades registradas. Você pode encerrar o dia a qualquer momento.`
                          : 'Você pode encerrar o dia a qualquer momento.'}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setActionError(null);
                      setShowClosureModal(true);
                    }}
                    className={`mt-4 w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl text-sm font-semibold transition-all shadow-sm active:scale-[0.99] ${
                      isAllEventsCompleted
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20'
                        : 'bg-gray-900 hover:bg-black dark:bg-indigo-600 dark:hover:bg-indigo-500 text-white'
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Encerrar Dia</span>
                  </button>
                </div>
              )}
            </section>
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
              {totalItems === 0 ? (
                <>
                  Nenhuma atividade foi configurada na rotina para este dia. Deseja encerrá-lo mesmo assim?
                </>
              ) : pendingItems > 0 ? (
                <>
                  {pendingItems === 1
                    ? 'Existe 1 atividade sem registro neste dia. Deseja encerrá-lo mesmo assim?'
                    : `Existem ${pendingItems} atividades sem registro neste dia. Deseja encerrá-lo mesmo assim?`}
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
                  : totalItems === 0 || pendingItems > 0
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
          canEdit={canRecordDailyActivities}
          recoveryTab="today"
          editingDateStr={editingDateStr || null}
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
          canEdit={canRecordDailyActivities}
          onSuccess={handleMedRefresh}
          onPartialSuccess={() => {
            if (patient) refreshTimeline(patient.id, localDate);
          }}
        />
      )}

      {selectedActivityEvent && patient && profile && (
        <ActivityModal
          isOpen={!!selectedActivityEvent}
          onClose={() => setSelectedActivityEvent(null)}
          event={selectedActivityEvent}
          patientId={patient.id}
          profileId={profile.id}
          eventDate={localDate}
          isDayClosed={!!dailyClosure}
          canEdit={canRecordDailyActivities}
          onSuccess={handleActivityRefresh}
        />
      )}

      {showActivityFormModal && patient && profile && canRecordDailyActivities && (
        <ActivityFormModal
          isOpen={showActivityFormModal}
          onClose={() => setShowActivityFormModal(false)}
          patientId={patient.id}
          profileId={profile.id}
          defaultScheduleType="one_time"
          defaultDate={localDate}
          onSuccess={handleActivityFormSuccess}
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
          canEdit={canRecordDailyActivities}
          onSuccess={(updatedLog) => {
            setTodayMood(updatedLog);
          }}
        />
      )}

      {/* Nightly Closure Reminder Banner: active members/caregivers/admins, today only, open day only, >= 21:00 America/Sao_Paulo, not dismissed */}
      {showClosureReminderBanner && (
        <ClosureReminderBanner
          eventsCount={totalItems}
          pendingEventsCount={pendingItems}
          onRequestClose={() => {
            setActionError(null);
            setShowClosureModal(true);
          }}
          onDismiss={handleDismissClosureBanner}
        />
      )}
      {showShoppingModal && patient && profile && (
        <ShoppingListModal
          isOpen={showShoppingModal}
          initialMode={shoppingModalMode}
          onClose={() => setShowShoppingModal(false)}
          patientId={patient.id}
          familyId={profile.family_id}
          profileId={profile.id}
          eventDate={clockDate}
          canEdit={canRecordDailyActivities}
          items={shoppingItems}
          onChanged={() => {
            if (patient) return refreshTimeline(patient.id, localDate);
          }}
        />
      )}
    </MainLayout>
  );
}
