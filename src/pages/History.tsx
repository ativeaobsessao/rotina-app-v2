import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MainLayout } from '../layouts/MainLayout';
import {
  getCurrentProfile,
  getPatient,
  getHistoricalMealLogs,
  getHistoricalMedicationLogs,
  getMealPhotoUrl,
  getHistoricalDailyClosures,
  createDailyClosure,
  mapWithConcurrency,
} from '../services/api';
import { useNetwork } from '../contexts/NetworkContext';
import {
  getLocalDateString,
  shiftDateString,
  formatDateToTime,
  formatFriendlyDate,
  formatTime,
} from '../utils/date';
import { Spinner } from '../components/ui/Spinner';
import { UserProfile } from '../components/ui/UserProfile';
import {
  ChevronDown,
  ChevronUp,
  Coffee,
  Pill,
  CheckCircle2,
  Circle,
  FileText,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { MealModal } from '../components/meals/MealModal';
import { MedicationModal } from '../components/medications/MedicationModal';
import { ReportModal } from '../components/history/ReportModal';
import type { MealEventData, MedicationEventData } from '../types/timeline';

// ─── Types ───────────────────────────────────────────────────────────────────

interface HistoryMealEntry {
  id: string;
  logId: string;
  mealConfigId: string;
  title: string;
  time: string;
  consumption_status: 'normal' | 'partial' | 'none';
  description: string | null;
  drink_description: string | null;
  notes: string | null;
  photo_url: string | null;
  photoSignedUrl: string | null;
  creatorName: string;
  created_at: string;
  mealConfig: any;
  log: any;
}

interface HistoryMedEntry {
  id: string;
  logId: string;
  medicationId: string;
  name: string;
  dosage: string;
  status: 'administered' | 'not_administered';
  reason: string | null;
  time: string;
  periodName: string;
  creatorName: string;
  created_at: string;
  log: any;
  medication: any;
  periodId: string;
}

interface DayData {
  dateStr: string;
  meals: HistoryMealEntry[];
  meds: HistoryMedEntry[];
  closure: any | null;
}

// ─── Sub-component: individual meal row ──────────────────────────────────────

function MealRow({
  meal,
  onEdit,
  profileId,
}: {
  meal: HistoryMealEntry;
  onEdit: () => void;
  profileId?: string;
  key?: React.Key;
}) {
  const consumptionLabel =
    meal.consumption_status === 'normal'
      ? 'Comeu normalmente'
      : meal.consumption_status === 'partial'
      ? 'Comeu parcialmente'
      : 'Não comeu';

  const consumptionColor =
    meal.consumption_status === 'normal'
      ? 'text-green-700 dark:text-emerald-400'
      : meal.consumption_status === 'partial'
      ? 'text-yellow-700 dark:text-amber-400'
      : 'text-red-700 dark:text-rose-400';

  const hideCreator = profileId && meal.log?.created_by === profileId;

  return (
    <button
      type="button"
      onClick={onEdit}
      className="w-full text-left bg-white dark:bg-[#121216] rounded-2xl border border-gray-100 dark:border-white/[0.08] shadow-sm overflow-hidden hover:border-gray-200 dark:hover:bg-[#18181d] active:scale-[0.99] transition-all"
    >
      {meal.photoSignedUrl && (
        <div className="w-full aspect-[4/3] bg-gray-100 dark:bg-[#1c1c22]">
          <img src={meal.photoSignedUrl} alt={meal.title} className="w-full h-full object-cover" />
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <Coffee className="w-4 h-4 text-gray-400 dark:text-zinc-500 shrink-0 mt-0.5" />
            <span className="font-semibold text-gray-900 dark:text-zinc-100 text-sm">
              {meal.title}
            </span>
          </div>
          <span className={`text-xs font-medium shrink-0 ${consumptionColor}`}>
            {consumptionLabel}
          </span>
        </div>

        {meal.time && (
          <p className="text-xs text-gray-400 dark:text-zinc-500 ml-6 mb-2">
            {formatTime(meal.time)} · Refeição realizada
          </p>
        )}

        {meal.description && (
          <p className="text-sm text-gray-600 dark:text-zinc-300 ml-6 mb-1 italic">
            🍽️ "{meal.description}"
          </p>
        )}
        {meal.drink_description && (
          <p className="text-xs text-sky-700 dark:text-sky-400 ml-6 mb-2">
            🥤 Bebeu: {meal.drink_description}
          </p>
        )}

        {!hideCreator && (
          <div className="ml-6 pt-2 border-t border-gray-50 dark:border-white/[0.06] flex items-center gap-1.5 mt-2">
            <span className="text-[11px] text-gray-400 dark:text-zinc-500">👤</span>
            <span className="text-[11px] text-gray-500 dark:text-zinc-400">
              Registrado por{' '}
              <span className="font-medium text-gray-700 dark:text-zinc-300">
                {meal.creatorName}
              </span>{' '}
              às {formatDateToTime(meal.created_at)}
            </span>
          </div>
        )}
      </div>
    </button>
  );
}

// ─── Sub-component: individual medication row ─────────────────────────────────

function MedRow({
  med,
  onEdit,
  profileId,
}: {
  med: HistoryMedEntry;
  onEdit: () => void;
  profileId?: string;
  key?: React.Key;
}) {
  const isAdministered = med.status === 'administered';
  const hideCreator = profileId && med.log?.created_by === profileId;

  return (
    <button
      type="button"
      onClick={onEdit}
      className="w-full text-left bg-white dark:bg-[#121216] rounded-2xl border border-gray-100 dark:border-white/[0.08] shadow-sm overflow-hidden hover:border-gray-200 dark:hover:bg-[#18181d] active:scale-[0.99] transition-all p-4"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <Pill className="w-4 h-4 text-gray-400 dark:text-zinc-500 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-gray-900 dark:text-zinc-100 text-sm">{med.name}</span>
            {med.dosage && (
              <span className="text-xs text-gray-400 dark:text-zinc-500 ml-1.5">{med.dosage}</span>
            )}
          </div>
        </div>
        <span
          className={`text-xs font-medium shrink-0 ${
            isAdministered ? 'text-green-700 dark:text-emerald-400' : 'text-red-600 dark:text-rose-400'
          }`}
        >
          {isAdministered ? '✓ Administrado' : '✗ Não administrado'}
        </span>
      </div>

      <p className="text-xs text-gray-400 dark:text-zinc-500 ml-6 mb-2">
        {med.periodName} · {formatTime(med.time)}
      </p>

      {!isAdministered && med.reason && (
        <p className="text-xs text-red-600 dark:text-rose-400 ml-6 mb-2">Motivo: {med.reason}</p>
      )}

      {!hideCreator && (
        <div className="ml-6 pt-2 border-t border-gray-50 dark:border-white/[0.06] flex items-center gap-1.5 mt-2">
          <span className="text-[11px] text-gray-400 dark:text-zinc-500">👤</span>
          <span className="text-[11px] text-gray-500 dark:text-zinc-400">
            Registrado por{' '}
            <span className="font-medium text-gray-700 dark:text-zinc-300">
              {med.creatorName}
            </span>{' '}
            às {formatDateToTime(med.created_at)}
          </span>
        </div>
      )}
    </button>
  );
}

// ─── Sub-component: Day Accordion ─────────────────────────────────────────────

function HistoryDayGroup({
  profileId,
  day,
  onEditMeal,
  onEditMed,
  onRequestCloseDay,
  isClosingDay,
  onOpenDayEdit,
}: {
  day: DayData;
  onOpenDayEdit: () => void;
  onEditMeal: (meal: HistoryMealEntry) => void;
  onEditMed: (med: HistoryMedEntry) => void;
  onRequestCloseDay?: (date: string) => void;
  isClosingDay?: boolean;
  profileId?: string;
  key?: React.Key;
}) {
  const [expanded, setExpanded] = useState(false);
  const friendly = formatFriendlyDate(day.dateStr);
  const { closure, meals, meds } = day;

  const totalMeals = meals.length;
  const totalMeds = meds.length;

  return (
    <div className="mb-3">
      {/* Accordion header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex flex-col p-4 bg-white dark:bg-[#121216] rounded-2xl border border-gray-100 dark:border-white/[0.08] shadow-sm hover:border-gray-200 dark:hover:bg-[#18181d] transition-all active:scale-[0.995]"
      >
        <div className="w-full flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {closure ? (
              <CheckCircle2 className="w-4 h-4 text-green-500 dark:text-emerald-400 shrink-0" />
            ) : (
              <Circle className="w-4 h-4 text-gray-300 dark:text-zinc-600 shrink-0" />
            )}
            <span className="font-semibold text-gray-900 dark:text-zinc-100 text-sm">
              {friendly}
            </span>
          </div>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-400 dark:text-zinc-500 shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400 dark:text-zinc-500 shrink-0" />
          )}
        </div>

        {/* Subtitle */}
        <div className="mt-1.5 ml-6.5 text-left pl-[26px]">
          {closure ? (
            <span className="text-[11px] text-gray-400 dark:text-zinc-500">
              Encerrado por{' '}
              <span className="font-medium text-gray-600 dark:text-zinc-300">
                {closure.closed_by_profile?.name || 'Familiar'}
              </span>{' '}
              às {formatDateToTime(closure.closed_at)}
            </span>
          ) : (
            <span className="text-[11px] text-gray-400 dark:text-zinc-500">Dia em aberto</span>
          )}
        </div>
      </button>

      {/* Accordion body */}
      {expanded && (
        <div className="mt-2 bg-gray-50/80 dark:bg-[#0e0e12] rounded-2xl border border-gray-100 dark:border-white/[0.06] p-4 space-y-6">
          {/* Status banner */}
          {closure ? (
            <div className="flex items-center gap-2 text-xs font-semibold text-green-700 dark:text-emerald-300 bg-green-50 dark:bg-emerald-950/35 border border-green-100 dark:border-emerald-800/50 px-3 py-2.5 rounded-xl">
              <CheckCircle2 className="w-3.5 h-3.5" />
              DIA ENCERRADO
            </div>
          ) : (
            <div className="flex items-center justify-between text-xs font-semibold text-gray-500 dark:text-zinc-400 bg-white dark:bg-[#16161b] border border-gray-100 dark:border-white/[0.08] px-3 py-2.5 rounded-xl shadow-sm">
              <div className="flex items-center gap-2">
                <Circle className="w-3.5 h-3.5" />
                DIA EM ABERTO
              </div>
              {onRequestCloseDay && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRequestCloseDay(day.dateStr);
                  }}
                  disabled={isClosingDay}
                  className="px-3 py-1.5 bg-black dark:bg-zinc-100 text-white dark:text-zinc-950 rounded-lg active:scale-95 transition-all disabled:opacity-50 font-medium tracking-wide flex items-center gap-1.5"
                >
                  {isClosingDay ? (
                    <>
                      <Spinner className="w-3 h-3 text-white dark:text-zinc-950" />
                      <span>Encerrando...</span>
                    </>
                  ) : (
                    'Encerrar Dia'
                  )}
                </button>
              )}
            </div>
          )}

          {/* Edit button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDayEdit();
            }}
            className="w-full flex items-center justify-center gap-2 py-2.5 mt-2 bg-white dark:bg-[#1c1c22] border border-gray-200 dark:border-white/[0.08] text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-[#222229] active:bg-gray-100 rounded-xl text-sm font-medium transition-all shadow-sm"
          >
            {closure ? 'Visualizar / Reabrir este dia' : 'Editar registros deste dia'}
          </button>

          {/* Meals section */}
          {meals.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500">
                🍽 Refeições
              </h4>
              <div className="space-y-3">
                {meals.map((meal) => (
                  <MealRow
                    profileId={profileId}
                    key={meal.logId}
                    meal={meal}
                    onEdit={() => onEditMeal(meal)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Medications section */}
          {meds.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500">
                💊 Medicamentos
              </h4>
              <div className="space-y-3">
                {meds.map((med) => (
                  <MedRow
                    profileId={profileId}
                    key={med.logId}
                    med={med}
                    onEdit={() => onEditMed(med)}
                  />
                ))}
              </div>
            </div>
          )}

          {meals.length === 0 && meds.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-zinc-500 text-center py-4">
              Nenhum registro neste dia.
            </p>
          )}

          {/* Day summary */}
          <div className="border-t border-gray-100 dark:border-white/[0.08] pt-4">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-3">
              Resumo do dia
            </h4>
            <div className="space-y-1.5 text-xs text-gray-600 dark:text-zinc-400">
              <div className="flex justify-between">
                <span>Refeições registradas</span>
                <span className="font-semibold text-gray-900 dark:text-zinc-100">{totalMeals}</span>
              </div>
              <div className="flex justify-between">
                <span>Medicamentos registrados</span>
                <span className="font-semibold text-gray-900 dark:text-zinc-100">{totalMeds}</span>
              </div>
              <div className="flex justify-between mt-2 pt-2 border-t border-gray-100 dark:border-white/[0.08]">
                <span>Status</span>
                <span
                  className={`font-semibold ${
                    closure
                      ? 'text-green-700 dark:text-emerald-400'
                      : 'text-gray-500 dark:text-zinc-400'
                  }`}
                >
                  {closure ? '✓ Encerrado' : '○ Em aberto'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function HistoryScreen({
  onTabChange,
  onEditPastDay,
}: {
  onTabChange?: (tab: 'today' | 'history' | 'routine') => void;
  onEditPastDay?: (dateStr: string) => void;
}) {
  const { syncVersion } = useNetwork();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [patient, setPatient] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [days, setDays] = useState<DayData[]>([]);

  // Modal state — meal / med editing
  const [selectedMeal, setSelectedMeal] = useState<{
    meal: HistoryMealEntry;
    dateStr: string;
    isDayClosed: boolean;
  } | null>(null);
  const [selectedMed, setSelectedMed] = useState<{
    med: HistoryMedEntry;
    dateStr: string;
    isDayClosed: boolean;
  } | null>(null);

  const [pendingClosureDate, setPendingClosureDate] = useState<string | null>(null);
  const [closingDateStr, setClosingDateStr] = useState<string | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);

  const [daysLimit, setDaysLimit] = useState(14);
  const [filterCategory, setFilterCategory] = useState<'all' | 'meals' | 'meds'>('all');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  const isMountedRef = useRef(true);
  const loadSeqRef = useRef(0);
  const closingRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadData = useCallback(async () => {
    const reqSeq = ++loadSeqRef.current;
    setLoading(true);
    setLoadError(null);

    try {
      const prof = await getCurrentProfile();
      if (!isMountedRef.current || reqSeq !== loadSeqRef.current) return;
      if (!prof) {
        setLoadError('Não foi possível carregar o perfil atual.');
        return;
      }
      setProfile(prof);

      const pat = await getPatient(prof.family_id);
      if (!isMountedRef.current || reqSeq !== loadSeqRef.current) return;
      if (!pat) {
        setPatient(null);
        return;
      }
      setPatient(pat);

      const todayStr = getLocalDateString();
      const upperLimit = filterEndDate ? shiftDateString(filterEndDate, 1) : todayStr;
      const lowerLimit = filterStartDate
        ? filterStartDate
        : shiftDateString(todayStr, -daysLimit);

      const [rawMealLogs, rawMedLogs, rawClosures] = await Promise.all([
        filterCategory === 'meds'
          ? Promise.resolve([])
          : getHistoricalMealLogs(pat.id, upperLimit, lowerLimit),
        filterCategory === 'meals'
          ? Promise.resolve([])
          : getHistoricalMedicationLogs(pat.id, upperLimit, lowerLimit),
        getHistoricalDailyClosures(pat.id, upperLimit, lowerLimit),
      ]);

      if (!isMountedRef.current || reqSeq !== loadSeqRef.current) return;

      const closuresMap: Record<string, any> = {};
      for (const c of rawClosures) {
        closuresMap[c.date] = c;
      }

      const dateSet = new Set<string>();
      for (const log of rawMealLogs) {
        if (log.event_date) dateSet.add(log.event_date);
      }
      for (const log of rawMedLogs) {
        if (log.event_date) dateSet.add(log.event_date);
      }
      if (filterCategory === 'all') {
        for (const c of rawClosures) {
          if (c.date) dateSet.add(c.date);
        }
      }

      const sortedDates = Array.from(dateSet).sort((a, b) => b.localeCompare(a));

      // Resolve all meal signed URLs in bounded parallel (concurrency 5)
      const resolvedPhotos = await mapWithConcurrency(rawMealLogs, 5, async (log) => {
        if (!log.photo_url) return null;
        return getMealPhotoUrl(log.photo_url);
      });

      if (!isMountedRef.current || reqSeq !== loadSeqRef.current) return;

      const mealsByDate: Record<string, HistoryMealEntry[]> = {};
      rawMealLogs.forEach((log, idx) => {
        const d = log.event_date;
        if (!d) return;
        if (!mealsByDate[d]) mealsByDate[d] = [];

        const mealConfig = log.meal_config || {
          name: 'Refeição',
          scheduled_time: log.meal_time || '00:00:00',
        };

        mealsByDate[d].push({
          id: log.meal_config_id || log.id,
          logId: log.id,
          mealConfigId: log.meal_config_id,
          title: mealConfig.name || 'Refeição',
          time: log.meal_time || mealConfig.scheduled_time || '00:00:00',
          consumption_status: log.consumption_status ?? 'normal',
          description: log.description ?? null,
          drink_description: log.drink_description ?? null,
          notes: log.notes ?? null,
          photo_url: log.photo_url ?? null,
          photoSignedUrl: resolvedPhotos[idx] ?? null,
          creatorName: log.creator?.name || 'Familiar',
          created_at: log.created_at,
          mealConfig,
          log,
        });
      });

      for (const d of Object.keys(mealsByDate)) {
        mealsByDate[d].sort((a, b) => a.time.localeCompare(b.time));
      }

      const medsByDate: Record<string, HistoryMedEntry[]> = {};
      for (const log of rawMedLogs) {
        const d = log.event_date;
        if (!d) continue;
        if (!medsByDate[d]) medsByDate[d] = [];

        const medication = log.medication || null;
        const period = medication?.period || null;

        medsByDate[d].push({
          id: log.medication_id,
          logId: log.id,
          medicationId: log.medication_id,
          name: medication?.name || 'Medicamento',
          dosage: medication?.dosage || '',
          status: log.status,
          reason: log.reason ?? null,
          time: period?.scheduled_time || '00:00:00',
          periodName: period?.name || 'Medicamentos',
          periodId: medication?.medication_period_id || 'unknown',
          creatorName: log.creator?.name || 'Familiar',
          created_at: log.created_at,
          log,
          medication,
        });
      }

      for (const d of Object.keys(medsByDate)) {
        medsByDate[d].sort((a, b) => a.time.localeCompare(b.time));
      }

      const assembled: DayData[] = sortedDates.map((dateStr) => ({
        dateStr,
        meals: mealsByDate[dateStr] ?? [],
        meds: medsByDate[dateStr] ?? [],
        closure: closuresMap[dateStr] ?? null,
      }));

      setDays(assembled);
    } catch (err: any) {
      if (!isMountedRef.current || reqSeq !== loadSeqRef.current) return;
      console.error('[HistoryScreen] loadData error:', err);
      setLoadError(
        err?.message || 'Não foi possível carregar o histórico. Verifique sua conexão e tente novamente.'
      );
    } finally {
      if (isMountedRef.current && reqSeq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, [daysLimit, filterCategory, filterStartDate, filterEndDate]);

  useEffect(() => {
    loadData();
  }, [loadData, syncVersion]);

  async function handleConfirmCloseDay(dateStr: string) {
    if (!profile || !patient || closingRef.current) return;
    closingRef.current = true;
    setClosingDateStr(dateStr);
    setActionError(null);
    try {
      const res = await createDailyClosure(profile.family_id, patient.id, dateStr, profile.id);
      if (!isMountedRef.current) return;
      if (res.success) {
        setPendingClosureDate(null);
        await loadData();
      } else {
        setActionError(res.error || 'Não foi possível encerrar este dia no servidor.');
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setActionError(err?.message || 'Erro ao encerrar o dia.');
      }
    } finally {
      closingRef.current = false;
      if (isMountedRef.current) setClosingDateStr(null);
    }
  }

  if (loading) {
    return (
      <MainLayout activeTab="history" onTabChange={onTabChange}>
        <div className="flex h-[80vh] items-center justify-center">
          <Spinner />
        </div>
      </MainLayout>
    );
  }

  if (loadError && days.length === 0) {
    return (
      <MainLayout activeTab="history" onTabChange={onTabChange}>
        <div className="flex h-[80vh] items-center justify-center flex-col text-center px-6 space-y-4">
          <div className="w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div className="space-y-1 max-w-xs">
            <h3 className="font-semibold text-gray-900 dark:text-zinc-100">
              Erro ao carregar histórico
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

  if (!patient) {
    return (
      <MainLayout activeTab="history" onTabChange={onTabChange}>
        <div className="flex h-[80vh] items-center justify-center flex-col text-center px-6">
          <p className="text-gray-500 dark:text-zinc-400">Paciente não encontrado.</p>
        </div>
      </MainLayout>
    );
  }

  function toMealEvent(meal: HistoryMealEntry): MealEventData {
    return {
      id: meal.mealConfigId || meal.id,
      type: 'meal',
      time: meal.time,
      title: meal.title,
      status: 'confirmed',
      mealConfig: meal.mealConfig,
      log: meal.log,
      photoSignedUrl: meal.photoSignedUrl,
    };
  }

  function toMedEvent(med: HistoryMedEntry): MedicationEventData {
    return {
      id: med.periodId,
      type: 'medication_period',
      time: med.time,
      title: med.periodName,
      status: med.status === 'administered' ? 'confirmed' : 'attention',
      period: med.medication?.period || {
        id: med.periodId,
        scheduled_time: med.time,
        name: med.periodName,
      },
      medications: med.medication ? [med.medication] : [],
      logs: [med.log],
    };
  }

  return (
    <MainLayout activeTab="history" onTabChange={onTabChange}>
      <div className="max-w-md mx-auto w-full">
        {/* Header */}
        <div className="bg-white/95 dark:bg-[#09090b]/95 px-6 pt-12 pb-6 sticky top-0 z-30 border-b border-gray-100/50 dark:border-white/[0.08] backdrop-blur-xl">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">
              Histórico
            </h1>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowReportModal(true)}
                className="p-2 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 rounded-full transition-colors"
                title="Gerar Relatório"
              >
                <FileText className="w-5 h-5" />
              </button>
              <UserProfile />
            </div>
          </div>
          <p className="text-sm text-gray-500 dark:text-zinc-400">
            Registros anteriores de {patient.name}
          </p>
        </div>

        {(actionError || loadError) && (
          <div className="mx-6 mt-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 rounded-2xl p-3.5 flex items-center justify-between gap-3 text-xs text-rose-700 dark:text-rose-300">
            <span>{actionError || loadError}</span>
            <button
              type="button"
              onClick={() => {
                setActionError(null);
                setLoadError(null);
                loadData();
              }}
              className="font-semibold underline shrink-0"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="px-6 pt-4 pb-2">
          <div className="flex flex-wrap gap-2">
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value as any)}
              className="bg-gray-50 dark:bg-[#1c1c22] border border-gray-200 dark:border-white/[0.1] text-gray-700 dark:text-zinc-200 text-sm rounded-xl px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            >
              <option value="all">Todas as categorias</option>
              <option value="meals">Apenas Alimentação</option>
              <option value="meds">Apenas Medicamentos</option>
            </select>

            <div className="flex items-center gap-2">
              <input
                type="date"
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
                className="bg-gray-50 dark:bg-[#1c1c22] border border-gray-200 dark:border-white/[0.1] text-gray-700 dark:text-zinc-200 text-sm rounded-xl px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                title="Data inicial"
              />
              <span className="text-gray-400 dark:text-zinc-500 text-sm">até</span>
              <input
                type="date"
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
                className="bg-gray-50 dark:bg-[#1c1c22] border border-gray-200 dark:border-white/[0.1] text-gray-700 dark:text-zinc-200 text-sm rounded-xl px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                title="Data final"
              />
            </div>

            {(filterStartDate || filterEndDate || filterCategory !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setFilterStartDate('');
                  setFilterEndDate('');
                  setFilterCategory('all');
                }}
                className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 self-center px-2 py-2"
              >
                Limpar filtros
              </button>
            )}
          </div>
        </div>

        {/* List */}
        <div className="p-4">
          {days.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-gray-400 dark:text-zinc-500 text-sm">
                Nenhum registro histórico encontrado nos últimos {daysLimit} dias.
              </p>
              <p className="text-gray-300 dark:text-zinc-600 text-xs mt-1">
                Os registros dos dias anteriores aparecerão aqui.
              </p>
            </div>
          ) : (
            days.map((day) => (
              <HistoryDayGroup
                profileId={profile?.id}
                key={day.dateStr}
                day={day}
                onEditMeal={(meal) =>
                  setSelectedMeal({
                    meal,
                    dateStr: day.dateStr,
                    isDayClosed: Boolean(day.closure),
                  })
                }
                onEditMed={(med) =>
                  setSelectedMed({
                    med,
                    dateStr: day.dateStr,
                    isDayClosed: Boolean(day.closure),
                  })
                }
                onRequestCloseDay={(date) => {
                  setActionError(null);
                  setPendingClosureDate(date);
                }}
                isClosingDay={closingDateStr === day.dateStr}
                onOpenDayEdit={() => onEditPastDay?.(day.dateStr)}
              />
            ))
          )}

          {days.length > 0 && !filterStartDate && (
            <div className="flex justify-center pt-8 pb-4">
              <button
                type="button"
                onClick={() => setDaysLimit((prev) => prev + 14)}
                className="text-sm font-medium text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 dark:border dark:border-indigo-800/40 px-6 py-2.5 rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors"
              >
                Carregar mais antigos
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation dialog for closing past day */}
      {pendingClosureDate && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 dark:bg-black/75 p-4">
          <div className="bg-white dark:bg-[#141419] dark:border dark:border-white/[0.08] rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100 mb-2">
              Encerrar {formatFriendlyDate(pendingClosureDate)}?
            </h3>
            <p className="text-sm text-gray-500 dark:text-zinc-400 mb-4">
              Os registros preenchidos e eventuais atividades sem registro permanecerão exatamente como estão.
            </p>
            {actionError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 text-xs text-rose-700 dark:text-rose-300">
                {actionError}
              </div>
            )}
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                disabled={Boolean(closingDateStr)}
                onClick={() => {
                  setActionError(null);
                  setPendingClosureDate(null);
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-white/[0.08] rounded-xl transition-colors"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={Boolean(closingDateStr)}
                onClick={() => handleConfirmCloseDay(pendingClosureDate)}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50 transition-colors"
              >
                {closingDateStr ? 'Encerrando...' : 'Encerrar mesmo assim'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Meal edit modal */}
      {selectedMeal && patient && profile && (
        <MealModal
          isOpen={!!selectedMeal}
          onClose={() => setSelectedMeal(null)}
          event={toMealEvent(selectedMeal.meal)}
          patientId={patient.id}
          profileId={profile.id}
          eventDate={selectedMeal.dateStr}
          patientGender={patient.gender}
          isDayClosed={selectedMeal.isDayClosed}
          onSuccess={() => {
            loadData();
            setSelectedMeal(null);
          }}
        />
      )}

      {/* Medication edit modal */}
      {selectedMed && patient && profile && (
        <MedicationModal
          isOpen={!!selectedMed}
          onClose={() => setSelectedMed(null)}
          event={toMedEvent(selectedMed.med)}
          patientId={patient.id}
          profileId={profile.id}
          eventDate={selectedMed.dateStr}
          isDayClosed={selectedMed.isDayClosed}
          onSuccess={() => {
            loadData();
            setSelectedMed(null);
          }}
          onPartialSuccess={() => {
            loadData();
          }}
        />
      )}

      {/* Report modal */}
      {patient && (
        <ReportModal
          isOpen={showReportModal}
          onClose={() => setShowReportModal(false)}
          patientId={patient.id}
          patientName={patient.name}
        />
      )}
    </MainLayout>
  );
}
