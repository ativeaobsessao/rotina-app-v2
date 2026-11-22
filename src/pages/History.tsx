import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MainLayout } from '../layouts/MainLayout';
import {
  getCurrentProfile,
  getPatient,
  getMyFamilyPermissions,
  getHistoricalMealLogs,
  getHistoricalMedicationLogs,
  getHistoricalActivityLogs,
  getMealPhotoUrl,
  getHistoricalDailyClosures,
  createDailyClosure,
  getPurchasedShoppingItems,
  revertShoppingItemToPending,
  deleteShoppingItem,
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
import { getMedicationDosageForDate } from '../utils/medicationSchedule';
import { getActivityCategoryLabel } from '../utils/activitySchedule';
import { Spinner } from '../components/ui/Spinner';
import { UserProfile } from '../components/ui/UserProfile';
import {
  ChevronDown,
  ChevronUp,
  Coffee,
  Pill,
  CalendarCheck2,
  CheckCircle2,
  Circle,
  FileText,
  AlertCircle,
  RefreshCw,
  X,
} from 'lucide-react';
import { MealModal } from '../components/meals/MealModal';
import { MedicationModal } from '../components/medications/MedicationModal';
import { ActivityModal } from '../components/activities/ActivityModal';
import { ReportModal } from '../components/history/ReportModal';
import { ShoppingHistoryCard } from '../components/history/ShoppingHistoryCard';
import { ShoppingHistoryPanel } from '../components/history/ShoppingHistoryPanel';
import { ShoppingReportModal } from '../components/history/ShoppingReportModal';
import { ShoppingItemEditModal } from '../components/shopping/ShoppingItemEditModal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import {
  filterShoppingHistoryItems,
  summarizeShoppingExpenses,
  type ShoppingItemRecord,
} from '../utils/shopping';
import { readActiveMealRecovery, getMealDraft } from '../services/mealDrafts';
import type { MealEventData, MedicationEventData, ActivityEventData } from '../types/timeline';

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

interface HistoryActivityEntry {
  id: string;
  logId: string;
  activityId: string;
  title: string;
  category: string;
  status: 'completed' | 'not_completed';
  reason: string | null;
  notes: string | null;
  time: string;
  creatorName: string;
  created_at: string;
  log: any;
  activity: any;
}

interface DayData {
  dateStr: string;
  meals: HistoryMealEntry[];
  meds: HistoryMedEntry[];
  activities: HistoryActivityEntry[];
  closure: any | null;
}

// ─── Sub-component: individual meal row ──────────────────────────────────────

export function MealRow({
  meal,
  onEdit,
  onViewPhoto,
  profileId,
  canEdit = true,
}: {
  meal: HistoryMealEntry;
  onEdit?: () => void;
  onViewPhoto?: (photoUrl: string, title: string) => void;
  profileId?: string;
  canEdit?: boolean;
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

  const detailsBody = (
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
      {meal.notes && (
        <p className="text-xs text-gray-500 dark:text-zinc-400 ml-6 mb-2">
          📝 {meal.notes}
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
  );

  if (!canEdit) {
    return (
      <div className="w-full text-left bg-white dark:bg-[#121216] rounded-2xl border border-gray-100 dark:border-white/[0.08] shadow-sm overflow-hidden">
        {meal.photoSignedUrl && (
          <button
            type="button"
            onClick={() => onViewPhoto?.(meal.photoSignedUrl!, meal.title)}
            className="w-full aspect-[4/3] bg-gray-100 dark:bg-[#1c1c22] relative block group focus:outline-none"
            title="Toque para ampliar a foto"
          >
            <img src={meal.photoSignedUrl} alt={meal.title} className="w-full h-full object-cover" />
            <span className="absolute bottom-2.5 right-2.5 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur-sm text-white text-[11px] font-medium">
              Toque para ampliar
            </span>
          </button>
        )}
        {detailsBody}
      </div>
    );
  }

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
      {detailsBody}
    </button>
  );
}

// ─── Sub-component: individual medication row ─────────────────────────────────

export function MedRow({
  med,
  onEdit,
  profileId,
  canEdit = true,
}: {
  med: HistoryMedEntry;
  onEdit?: () => void;
  profileId?: string;
  canEdit?: boolean;
  key?: React.Key;
}) {
  const isAdministered = med.status === 'administered';
  const hideCreator = profileId && med.log?.created_by === profileId;

  const content = (
    <>
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
    </>
  );

  if (!canEdit) {
    return (
      <div className="w-full text-left bg-white dark:bg-[#121216] rounded-2xl border border-gray-100 dark:border-white/[0.08] shadow-sm overflow-hidden p-4">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onEdit}
      className="w-full text-left bg-white dark:bg-[#121216] rounded-2xl border border-gray-100 dark:border-white/[0.08] shadow-sm overflow-hidden hover:border-gray-200 dark:hover:bg-[#18181d] active:scale-[0.99] transition-all p-4"
    >
      {content}
    </button>
  );
}

// ─── Sub-component: individual activity row ───────────────────────────────────

export function ActivityRow({
  activity,
  onEdit,
  profileId,
  canEdit = true,
}: {
  activity: HistoryActivityEntry;
  onEdit?: () => void;
  profileId?: string;
  canEdit?: boolean;
  key?: React.Key;
}) {
  const isCompleted = activity.status === 'completed';
  const hideCreator = profileId && activity.log?.created_by === profileId;

  const content = (
    <>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <CalendarCheck2 className="w-4 h-4 text-gray-400 dark:text-zinc-500 shrink-0 mt-0.5" />
          <span className="font-semibold text-gray-900 dark:text-zinc-100 text-sm truncate">
            {activity.title}
          </span>
        </div>
        <span
          className={`text-xs font-medium shrink-0 ${
            isCompleted ? 'text-green-700 dark:text-emerald-400' : 'text-red-600 dark:text-rose-400'
          }`}
        >
          {isCompleted ? '✓ Realizada' : '✗ Não realizada'}
        </span>
      </div>

      <p className="text-xs text-gray-400 dark:text-zinc-500 ml-6 mb-2 tabular-nums">
        {getActivityCategoryLabel(activity.category)} · {formatTime(activity.time)}
      </p>

      {!isCompleted && activity.reason && (
        <p className="text-xs text-red-600 dark:text-rose-400 ml-6 mb-1.5">
          Motivo: {activity.reason}
        </p>
      )}

      {activity.notes && (
        <p className="text-xs text-gray-500 dark:text-zinc-400 ml-6 mb-2">
          📝 {activity.notes}
        </p>
      )}

      {!hideCreator && (
        <div className="ml-6 pt-2 border-t border-gray-50 dark:border-white/[0.06] flex items-center gap-1.5 mt-2">
          <span className="text-[11px] text-gray-400 dark:text-zinc-500">👤</span>
          <span className="text-[11px] text-gray-500 dark:text-zinc-400">
            Registrado por{' '}
            <span className="font-medium text-gray-700 dark:text-zinc-300">
              {activity.creatorName}
            </span>{' '}
            às {formatDateToTime(activity.created_at)}
          </span>
        </div>
      )}
    </>
  );

  if (!canEdit) {
    return (
      <div className="w-full text-left bg-white dark:bg-[#121216] rounded-2xl border border-gray-100 dark:border-white/[0.08] shadow-sm overflow-hidden p-4">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onEdit}
      className="w-full text-left bg-white dark:bg-[#121216] rounded-2xl border border-gray-100 dark:border-white/[0.08] shadow-sm overflow-hidden hover:border-gray-200 dark:hover:bg-[#18181d] active:scale-[0.99] transition-all p-4"
    >
      {content}
    </button>
  );
}

// ─── Sub-component: Day Accordion ─────────────────────────────────────────────

export function HistoryDayGroup({
  profileId,
  day,
  onEditMeal,
  onEditMed,
  onEditActivity,
  onViewPhoto,
  onRequestCloseDay,
  isClosingDay,
  onOpenDayEdit,
  canEdit = true,
  canEditRecords,
  canCloseDay,
  canManageClosures,
}: {
  day: DayData;
  onOpenDayEdit?: () => void;
  onEditMeal?: (meal: HistoryMealEntry) => void;
  onEditMed?: (med: HistoryMedEntry) => void;
  onEditActivity?: (act: HistoryActivityEntry) => void;
  onViewPhoto?: (photoUrl: string, title: string) => void;
  onRequestCloseDay?: (date: string) => void;
  isClosingDay?: boolean;
  profileId?: string;
  canEdit?: boolean;
  canEditRecords?: boolean;
  canCloseDay?: boolean;
  canManageClosures?: boolean;
  key?: React.Key;
}) {
  const [expanded, setExpanded] = useState(false);
  const friendly = formatFriendlyDate(day.dateStr);
  const { closure, meals, meds, activities = [] } = day;

  const effectiveCanEditRecords = canEditRecords ?? canEdit;
  const effectiveCanManageClosures = canManageClosures ?? canEdit;
  const effectiveCanCloseDay = canCloseDay ?? effectiveCanEditRecords;
  const canOpenActivityForDay = closure ? effectiveCanManageClosures : effectiveCanEditRecords;
  const canOpenDayEditAction = closure ? effectiveCanManageClosures : effectiveCanEditRecords;

  const totalMeals = meals.length;
  const totalMeds = meds.length;
  const totalActivities = activities.length;

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
              {effectiveCanCloseDay && onRequestCloseDay && (
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

          {/* Open-day activity edit (active members) or closed-day reopen/view (exclusive to ADMIN) */}
          {canOpenDayEditAction && onOpenDayEdit && (
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
          )}

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
                    canEdit={canOpenActivityForDay}
                    onEdit={canOpenActivityForDay && onEditMeal ? () => onEditMeal(meal) : undefined}
                    onViewPhoto={onViewPhoto}
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
                    canEdit={canOpenActivityForDay}
                    onEdit={canOpenActivityForDay && onEditMed ? () => onEditMed(med) : undefined}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Activities section */}
          {activities.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500">
                🩺 Atividades
              </h4>
              <div className="space-y-3">
                {activities.map((activity) => (
                  <ActivityRow
                    profileId={profileId}
                    key={activity.logId}
                    activity={activity}
                    canEdit={canOpenActivityForDay}
                    onEdit={
                      canOpenActivityForDay && onEditActivity
                        ? () => onEditActivity(activity)
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {meals.length === 0 && meds.length === 0 && activities.length === 0 && (
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
              <div className="flex justify-between">
                <span>Atividades registradas</span>
                <span className="font-semibold text-gray-900 dark:text-zinc-100">{totalActivities}</span>
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
  const [isAdmin, setIsAdmin] = useState(false);
  const [canRecordDailyActivities, setCanRecordDailyActivities] = useState(false);
  const [days, setDays] = useState<DayData[]>([]);

  // Modal state — meal / med editing & read-only photo lightbox
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
  const [selectedActivity, setSelectedActivity] = useState<{
    activity: HistoryActivityEntry;
    dateStr: string;
    isDayClosed: boolean;
  } | null>(null);
  const [photoLightbox, setPhotoLightbox] = useState<{ url: string; title: string } | null>(null);

  const [pendingClosureDate, setPendingClosureDate] = useState<string | null>(null);
  const [closingDateStr, setClosingDateStr] = useState<string | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);

  const [daysLimit, setDaysLimit] = useState(14);
  const [filterCategory, setFilterCategory] = useState<
    'all' | 'meals' | 'meds' | 'activities' | 'shopping'
  >('all');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  // Shopping history state
  const [allPurchasedShopping, setAllPurchasedShopping] = useState<ShoppingItemRecord[]>([]);
  const [shoppingPanelExpanded, setShoppingPanelExpanded] = useState(false);
  const [shoppingSearchQuery, setShoppingSearchQuery] = useState('');
  const [shoppingStartDate, setShoppingStartDate] = useState('');
  const [shoppingEndDate, setShoppingEndDate] = useState('');
  const [shoppingUrgentOnly, setShoppingUrgentOnly] = useState(false);
  const [selectedShoppingItem, setSelectedShoppingItem] = useState<ShoppingItemRecord | null>(null);
  const [shoppingActionConfirm, setShoppingActionConfirm] = useState<{
    action: 'revert' | 'delete';
    item: ShoppingItemRecord;
  } | null>(null);
  const [shoppingActionLoading, setShoppingActionLoading] = useState(false);
  const [shoppingActionError, setShoppingActionError] = useState<string | null>(null);
  const [showShoppingReportModal, setShowShoppingReportModal] = useState(false);

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

      const [pat, perms] = await Promise.all([
        getPatient(prof.family_id),
        getMyFamilyPermissions(prof.family_id),
      ]);
      if (!isMountedRef.current || reqSeq !== loadSeqRef.current) return;
      setIsAdmin(perms.isAdmin);
      setCanRecordDailyActivities(perms.isMember);
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

      const isShoppingOnly = filterCategory === 'shopping';

      const [rawMealLogs, rawMedLogs, rawActivityLogs, rawClosures, rawShoppingPurchased] =
        await Promise.all([
          isShoppingOnly || filterCategory === 'meds' || filterCategory === 'activities'
            ? Promise.resolve([])
            : getHistoricalMealLogs(pat.id, upperLimit, lowerLimit),
          isShoppingOnly || filterCategory === 'meals' || filterCategory === 'activities'
            ? Promise.resolve([])
            : getHistoricalMedicationLogs(pat.id, upperLimit, lowerLimit),
          isShoppingOnly || filterCategory === 'meals' || filterCategory === 'meds'
            ? Promise.resolve([])
            : getHistoricalActivityLogs(pat.id, upperLimit, lowerLimit),
          isShoppingOnly
            ? Promise.resolve([])
            : getHistoricalDailyClosures(pat.id, upperLimit, lowerLimit),
          filterCategory === 'meals' || filterCategory === 'meds' || filterCategory === 'activities'
            ? Promise.resolve([])
            : getPurchasedShoppingItems(pat.id, { familyId: prof.family_id }).catch(() => []),
        ]);

      if (!isMountedRef.current || reqSeq !== loadSeqRef.current) return;

      setAllPurchasedShopping(rawShoppingPurchased);

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
      for (const log of rawActivityLogs) {
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
        const resolvedDosage =
          log.applied_dosage ||
          (medication
            ? getMedicationDosageForDate(medication, d)
            : '');

        medsByDate[d].push({
          id: log.medication_id,
          logId: log.id,
          medicationId: log.medication_id,
          name: medication?.name || 'Medicamento',
          dosage: resolvedDosage,
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

      const activitiesByDate: Record<string, HistoryActivityEntry[]> = {};
      for (const log of rawActivityLogs) {
        const d = log.event_date;
        if (!d) continue;
        if (!activitiesByDate[d]) activitiesByDate[d] = [];

        const act = log.activity || {
          id: log.activity_id,
          title: 'Atividade',
          category: 'medical',
          scheduled_time: '09:00:00',
        };

        activitiesByDate[d].push({
          id: log.activity_id,
          logId: log.id,
          activityId: log.activity_id,
          title: act.title || 'Atividade',
          category: act.category || 'medical',
          status: log.status,
          reason: log.reason ?? null,
          notes: log.notes ?? null,
          time: act.scheduled_time || '09:00:00',
          creatorName: log.creator?.name || 'Familiar',
          created_at: log.created_at,
          log,
          activity: act,
        });
      }

      for (const d of Object.keys(activitiesByDate)) {
        activitiesByDate[d].sort((a, b) => a.time.localeCompare(b.time));
      }

      const assembled: DayData[] = sortedDates.map((dateStr) => ({
        dateStr,
        meals: mealsByDate[dateStr] ?? [],
        meds: medsByDate[dateStr] ?? [],
        activities: activitiesByDate[dateStr] ?? [],
        closure: closuresMap[dateStr] ?? null,
      }));

      setDays(assembled);

      // Restore in-progress meal edit if PWA restarted while editing directly from History
      try {
        const pointer = readActiveMealRecovery(prof.id);
        if (pointer && pointer.tab === 'history' && pointer.patientId === pat.id) {
          const draft = await getMealDraft(pointer);
          if (draft && isMountedRef.current && reqSeq === loadSeqRef.current) {
            const matchedDay = assembled.find((d) => d.dateStr === pointer.eventDate);
            const matchedMeal = matchedDay?.meals.find(
              (m) => m.mealConfigId === pointer.mealId || m.id === pointer.mealId
            );
            if (matchedDay && matchedMeal) {
              setSelectedMeal(
                (prev) =>
                  prev || {
                    meal: matchedMeal,
                    dateStr: matchedDay.dateStr,
                    isDayClosed: Boolean(matchedDay.closure),
                  }
              );
            }
          }
        }
      } catch {}
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
    if (!canRecordDailyActivities) {
      setActionError('Sua conta não possui vínculo ativo com esta família para encerrar o dia.');
      return;
    }
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

  async function handleConfirmShoppingAction() {
    if (!shoppingActionConfirm || !patient || !profile || shoppingActionLoading) return;
    setShoppingActionLoading(true);
    setShoppingActionError(null);
    try {
      if (shoppingActionConfirm.action === 'revert') {
        await revertShoppingItemToPending(shoppingActionConfirm.item.id, patient.id, profile.id);
      } else {
        await deleteShoppingItem(shoppingActionConfirm.item.id, patient.id);
      }
      setShoppingActionConfirm(null);
      await loadData();
    } catch (err: any) {
      setShoppingActionError(
        err?.message ||
          (shoppingActionConfirm.action === 'revert'
            ? 'Não foi possível devolver o item para a Lista de Compras.'
            : 'Não foi possível apagar o registro.')
      );
    } finally {
      setShoppingActionLoading(false);
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
          <p className="text-gray-500 dark:text-zinc-400">Familiar não encontrado.</p>
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

  function toActivityEvent(activity: HistoryActivityEntry): ActivityEventData {
    return {
      id: activity.activityId || activity.id,
      type: 'activity',
      time: activity.time,
      title: activity.title,
      status: activity.status === 'completed' ? 'confirmed' : 'attention',
      activity: activity.activity,
      log: activity.log,
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
              onChange={(e) => {
                const nextCat = e.target.value as any;
                setFilterCategory(nextCat);
                if (nextCat === 'shopping') {
                  setShoppingPanelExpanded(true);
                }
              }}
              className="bg-gray-50 dark:bg-[#1c1c22] border border-gray-200 dark:border-white/[0.1] text-gray-700 dark:text-zinc-200 text-sm rounded-xl px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            >
              <option value="all">Todas as categorias</option>
              <option value="meals">Apenas Alimentação</option>
              <option value="meds">Apenas Medicamentos</option>
              <option value="activities">Apenas Atividades</option>
              <option value="shopping">Apenas Compras</option>
            </select>

            {filterCategory !== 'shopping' && (
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
            )}

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

        {/* Dedicated Shopping Search & Monthly/6-Month Expense Summary Panel */}
        {(filterCategory === 'all' || filterCategory === 'shopping') &&
          (() => {
            const effectiveShoppingStart =
              shoppingStartDate || (filterCategory !== 'shopping' ? filterStartDate : '');
            const effectiveShoppingEnd =
              shoppingEndDate || (filterCategory !== 'shopping' ? filterEndDate : '');

            const filteredShopping = filterShoppingHistoryItems(allPurchasedShopping, {
              query: shoppingSearchQuery,
              startDate: effectiveShoppingStart || undefined,
              endDate: effectiveShoppingEnd || undefined,
              urgentOnly: shoppingUrgentOnly,
            });
            const shoppingSummary = summarizeShoppingExpenses(
              filteredShopping,
              allPurchasedShopping
            );

            return (
              <ShoppingHistoryPanel
                expanded={filterCategory === 'shopping' ? true : shoppingPanelExpanded}
                onToggleExpanded={() => setShoppingPanelExpanded((prev) => !prev)}
                summary={shoppingSummary}
                searchQuery={shoppingSearchQuery}
                onSearchQueryChange={setShoppingSearchQuery}
                startDate={shoppingStartDate}
                endDate={shoppingEndDate}
                onDateRangeChange={(s, e) => {
                  setShoppingStartDate(s);
                  setShoppingEndDate(e);
                }}
                urgentOnly={shoppingUrgentOnly}
                onUrgentOnlyChange={setShoppingUrgentOnly}
                onOpenPdfModal={() => setShowShoppingReportModal(true)}
              />
            );
          })()}

        {/* List: Interleaves clinical Day cards and characteristic ShoppingHistoryCard entries */}
        <div className="p-4">
          {(() => {
            const todayStr = getLocalDateString();
            const showShoppingCards = filterCategory === 'all' || filterCategory === 'shopping';
            const lowerTimelineLimit = filterStartDate
              ? filterStartDate
              : shiftDateString(todayStr, -daysLimit);

            const hasShoppingSpecificFilter = Boolean(
              shoppingSearchQuery.trim() ||
                shoppingStartDate ||
                shoppingEndDate ||
                shoppingUrgentOnly
            );

            const visibleShopping = showShoppingCards
              ? filterShoppingHistoryItems(allPurchasedShopping, {
                  query: shoppingSearchQuery,
                  startDate:
                    shoppingStartDate ||
                    filterStartDate ||
                    (filterCategory === 'shopping' || hasShoppingSpecificFilter
                      ? undefined
                      : lowerTimelineLimit),
                  endDate: shoppingEndDate || filterEndDate || undefined,
                  urgentOnly: shoppingUrgentOnly,
                })
              : [];

            const shoppingByDate: Record<string, ShoppingItemRecord[]> = {};
            for (const item of visibleShopping) {
              const d =
                item.purchased_date ||
                (item.purchased_at ? item.purchased_at.slice(0, 10) : todayStr);
              if (!shoppingByDate[d]) shoppingByDate[d] = [];
              shoppingByDate[d].push(item);
            }

            type FeedEntry =
              | { kind: 'day'; dateStr: string; day: DayData }
              | { kind: 'shopping'; dateStr: string; items: ShoppingItemRecord[] };

            const feed: FeedEntry[] = [];
            if (filterCategory !== 'shopping') {
              for (const day of days) {
                feed.push({ kind: 'day', dateStr: day.dateStr, day });
              }
            }
            for (const [dateStr, items] of Object.entries(shoppingByDate)) {
              feed.push({ kind: 'shopping', dateStr, items });
            }

            feed.sort((a, b) => {
              const cmp = b.dateStr.localeCompare(a.dateStr);
              if (cmp !== 0) return cmp;
              if (a.kind === b.kind) return 0;
              return a.kind === 'shopping' ? -1 : 1;
            });

            if (feed.length === 0) {
              return (
                <div className="text-center py-16">
                  <p className="text-gray-400 dark:text-zinc-500 text-sm">
                    {filterCategory === 'shopping'
                      ? 'Nenhuma compra registrada para os filtros selecionados.'
                      : `Nenhum registro histórico encontrado nos últimos ${daysLimit} dias.`}
                  </p>
                  <p className="text-gray-300 dark:text-zinc-600 text-xs mt-1">
                    {filterCategory === 'shopping'
                      ? 'Quando itens da Lista de Compras forem marcados como comprados, eles aparecerão aqui.'
                      : 'Os registros dos dias anteriores aparecerão aqui.'}
                  </p>
                </div>
              );
            }

            return feed.map((entry) => {
              if (entry.kind === 'shopping') {
                return (
                  <ShoppingHistoryCard
                    key={`shopping-${entry.dateStr}`}
                    dateStr={entry.dateStr}
                    items={entry.items}
                    canEdit={canRecordDailyActivities}
                    defaultExpanded={filterCategory === 'shopping' || hasShoppingSpecificFilter}
                    onSelectItem={(item) => setSelectedShoppingItem(item)}
                    onRequestRevert={(item) => {
                      setShoppingActionError(null);
                      setShoppingActionConfirm({ action: 'revert', item });
                    }}
                    onRequestDelete={(item) => {
                      setShoppingActionError(null);
                      setShoppingActionConfirm({ action: 'delete', item });
                    }}
                  />
                );
              }

              const day = entry.day;
              const canEditThisDayActivities = day.closure ? isAdmin : canRecordDailyActivities;
              return (
                <HistoryDayGroup
                  profileId={profile?.id}
                  key={day.dateStr}
                  day={day}
                  canEdit={isAdmin}
                  canEditRecords={canRecordDailyActivities}
                  canCloseDay={canRecordDailyActivities}
                  canManageClosures={isAdmin}
                  onViewPhoto={(url, title) => setPhotoLightbox({ url, title })}
                  onEditMeal={
                    canEditThisDayActivities
                      ? (meal) =>
                          setSelectedMeal({
                            meal,
                            dateStr: day.dateStr,
                            isDayClosed: Boolean(day.closure),
                          })
                      : undefined
                  }
                  onEditMed={
                    canEditThisDayActivities
                      ? (med) =>
                          setSelectedMed({
                            med,
                            dateStr: day.dateStr,
                            isDayClosed: Boolean(day.closure),
                          })
                      : undefined
                  }
                  onEditActivity={
                    canEditThisDayActivities
                      ? (activity) =>
                          setSelectedActivity({
                            activity,
                            dateStr: day.dateStr,
                            isDayClosed: Boolean(day.closure),
                          })
                      : undefined
                  }
                  onRequestCloseDay={
                    canRecordDailyActivities
                      ? (date) => {
                          setActionError(null);
                          setPendingClosureDate(date);
                        }
                      : undefined
                  }
                  isClosingDay={closingDateStr === day.dateStr}
                  onOpenDayEdit={
                    canEditThisDayActivities ? () => onEditPastDay?.(day.dateStr) : undefined
                  }
                />
              );
            });
          })()}

          {filterCategory !== 'shopping' && days.length > 0 && !filterStartDate && (
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

      {/* Meal edit modal (any active family member on open days; view-only protected on closed days) */}
      {canRecordDailyActivities && selectedMeal && patient && profile && (
        <MealModal
          isOpen={!!selectedMeal}
          onClose={() => setSelectedMeal(null)}
          event={toMealEvent(selectedMeal.meal)}
          patientId={patient.id}
          profileId={profile.id}
          eventDate={selectedMeal.dateStr}
          patientGender={patient.gender}
          isDayClosed={selectedMeal.isDayClosed}
          canEdit={canRecordDailyActivities}
          recoveryTab="history"
          onSuccess={() => {
            loadData();
            setSelectedMeal(null);
          }}
        />
      )}

      {/* Medication edit modal (any active family member on open days; view-only protected on closed days) */}
      {canRecordDailyActivities && selectedMed && patient && profile && (
        <MedicationModal
          isOpen={!!selectedMed}
          onClose={() => setSelectedMed(null)}
          event={toMedEvent(selectedMed.med)}
          patientId={patient.id}
          profileId={profile.id}
          eventDate={selectedMed.dateStr}
          isDayClosed={selectedMed.isDayClosed}
          canEdit={canRecordDailyActivities}
          onSuccess={() => {
            loadData();
            setSelectedMed(null);
          }}
          onPartialSuccess={() => {
            loadData();
          }}
        />
      )}

      {/* Activity edit modal (any active family member on open days; view-only protected on closed days) */}
      {canRecordDailyActivities && selectedActivity && patient && profile && (
        <ActivityModal
          isOpen={!!selectedActivity}
          onClose={() => setSelectedActivity(null)}
          event={toActivityEvent(selectedActivity.activity)}
          patientId={patient.id}
          profileId={profile.id}
          eventDate={selectedActivity.dateStr}
          isDayClosed={selectedActivity.isDayClosed}
          canEdit={canRecordDailyActivities}
          onSuccess={() => {
            loadData();
            setSelectedActivity(null);
          }}
        />
      )}

      {/* Read-only photo lightbox (MEMBER & anyone inspecting history photos) */}
      {photoLightbox && (
        <div
          className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setPhotoLightbox(null)}
        >
          <button
            type="button"
            onClick={() => setPhotoLightbox(null)}
            className="absolute top-6 right-6 p-3 rounded-full bg-white/15 hover:bg-white/25 text-white transition-colors"
            aria-label="Fechar foto"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={photoLightbox.url}
            alt={photoLightbox.title}
            className="max-w-full max-h-[85dvh] object-contain rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
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

      {/* Shopping custom PDF report modal */}
      {patient && profile && (
        <ShoppingReportModal
          isOpen={showShoppingReportModal}
          onClose={() => setShowShoppingReportModal(false)}
          patientId={patient.id}
          familyId={profile.family_id}
          patientName={patient.name}
          initialStartDate={shoppingStartDate || filterStartDate || undefined}
          initialEndDate={shoppingEndDate || filterEndDate || undefined}
          initialUrgentOnly={shoppingUrgentOnly}
        />
      )}

      {/* Shopping purchased item edit sheet */}
      {patient && profile && (
        <ShoppingItemEditModal
          isOpen={Boolean(selectedShoppingItem)}
          item={selectedShoppingItem}
          onClose={() => setSelectedShoppingItem(null)}
          patientId={patient.id}
          profileId={profile.id}
          canEdit={canRecordDailyActivities}
          onChanged={() => loadData()}
        />
      )}

      {/* Shopping inline delete / revert confirmation dialog */}
      <ConfirmDialog
        isOpen={Boolean(shoppingActionConfirm)}
        title={
          shoppingActionConfirm?.action === 'revert'
            ? 'Voltar item para a Lista de Compras?'
            : 'Apagar registro de compra?'
        }
        description={
          shoppingActionConfirm?.action === 'revert' ? (
            <>
              <strong className="text-gray-700 dark:text-zinc-200">
                {shoppingActionConfirm.item.name}
              </strong>{' '}
              sairá do Histórico de compras e voltará imediatamente como pendente na tela Inicial.
            </>
          ) : (
            <>
              Tem certeza que deseja excluir definitivamente{' '}
              <strong className="text-gray-700 dark:text-zinc-200">
                {shoppingActionConfirm?.item.name}
              </strong>{' '}
              do Histórico de compras? Esta ação não pode ser desfeita.
            </>
          )
        }
        confirmLabel={
          shoppingActionConfirm?.action === 'revert'
            ? 'Voltar para a lista'
            : 'Apagar definitivamente'
        }
        cancelLabel="Cancelar"
        tone={shoppingActionConfirm?.action === 'revert' ? 'neutral' : 'danger'}
        icon={shoppingActionConfirm?.action === 'revert' ? 'revert' : 'trash'}
        loading={shoppingActionLoading}
        error={shoppingActionError}
        onConfirm={handleConfirmShoppingAction}
        onCancel={() => {
          setShoppingActionError(null);
          setShoppingActionConfirm(null);
        }}
      />
    </MainLayout>
  );
}
