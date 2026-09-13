// @ts-nocheck

import React, { useEffect, useState } from 'react';
import { MainLayout } from '../layouts/MainLayout';
import {
  getCurrentProfile,
  getPatient,
  getHistoricalMealLogs,
  getHistoricalMedicationLogs,
  getMealPhotoUrl,
  getHistoricalDailyClosures,
  createDailyClosure
} from '../services/api';
import { getLocalDateString, formatDateToTime, formatFriendlyDate, formatTime } from '../utils/date';
import { Spinner } from '../components/ui/Spinner';
import { UserProfile } from '../components/ui/UserProfile';
import { ChevronDown, ChevronUp, Coffee, Pill, CheckCircle2, Circle } from 'lucide-react';
import { MealModal } from '../components/meals/MealModal';
import { MedicationModal } from '../components/medications/MedicationModal';
import type { MealEventData, MedicationEventData } from '../types/timeline';

// ─── Types ───────────────────────────────────────────────────────────────────

interface HistoryMealEntry {
  id: string;
  logId: string;
  mealConfigId: string;
  title: string;
  time: string;         // meal_time or scheduled_time
  consumption_status: 'normal' | 'partial' | 'none';
  description: string | null;
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
  time: string;           // period scheduled_time
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

function MealRow({ meal, onEdit, profileId }: { meal: HistoryMealEntry; onEdit: () => void; profileId?: string }) {
  const consumptionLabel =
    meal.consumption_status === 'normal' ? 'Comeu normalmente' :
    meal.consumption_status === 'partial' ? 'Comeu parcialmente' :
    'Não comeu';

  const consumptionColor =
    meal.consumption_status === 'normal' ? 'text-green-700' :
    meal.consumption_status === 'partial' ? 'text-yellow-700' :
    'text-red-700';

  return (
    <button
      onClick={onEdit}
      className="w-full text-left bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:border-gray-200 active:scale-[0.99] transition-all"
    >
      {meal.photoSignedUrl && (
        <div className="w-full aspect-[4/3] bg-gray-100">
          <img src={meal.photoSignedUrl} alt={meal.title} className="w-full h-full object-cover" />
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <Coffee className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
            <span className="font-semibold text-gray-900 text-sm">{meal.title}</span>
          </div>
          <span className={`text-xs font-medium shrink-0 ${consumptionColor}`}>{consumptionLabel}</span>
        </div>

        {meal.time && (
          <p className="text-xs text-gray-400 ml-6 mb-2">
            {formatTime(meal.time)} · Refeição realizada
          </p>
        )}

        {meal.description && (
          <p className="text-sm text-gray-600 ml-6 mb-2 italic">"{meal.description}"</p>
        )}

        <div className="ml-6 pt-2 border-t border-gray-50 flex items-center gap-1.5 mt-2">
          {profileId && meal.created_at === profileId ? null : (
            <>
              <span className="text-[11px] text-gray-400">👤</span>
              <span className="text-[11px] text-gray-500">
                Registrado por <span className="font-medium text-gray-700">{meal.creatorName}</span>
                {' '}às {formatDateToTime(meal.created_at)}
              </span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Sub-component: individual medication row ─────────────────────────────────

function MedRow({ med, onEdit, profileId }: { med: HistoryMedEntry; onEdit: () => void; profileId?: string }) {
  const isAdministered = med.status === 'administered';

  return (
    <button
      onClick={onEdit}
      className="w-full text-left bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:border-gray-200 active:scale-[0.99] transition-all p-4"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <Pill className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-gray-900 text-sm">{med.name}</span>
            {med.dosage && <span className="text-xs text-gray-400 ml-1.5">{med.dosage}</span>}
          </div>
        </div>
        <span className={`text-xs font-medium shrink-0 ${isAdministered ? 'text-green-700' : 'text-red-600'}`}>
          {isAdministered ? '✓ Administrado' : '✗ Não administrado'}
        </span>
      </div>

      <p className="text-xs text-gray-400 ml-6 mb-2">{med.periodName} · {formatTime(med.time)}</p>

      {!isAdministered && med.reason && (
        <p className="text-xs text-red-600 ml-6 mb-2">Motivo: {med.reason}</p>
      )}

      <div className="ml-6 pt-2 border-t border-gray-50 flex items-center gap-1.5 mt-2">
        {profileId && med.created_at === profileId ? null : (
          <>
            <span className="text-[11px] text-gray-400">👤</span>
            <span className="text-[11px] text-gray-500">
              Registrado por <span className="font-medium text-gray-700">{med.creatorName}</span>
              {' '}às {formatDateToTime(med.created_at)}
            </span>
          </>
        )}
      </div>
    </button>
  );
}

// ─── Sub-component: Day Accordion ─────────────────────────────────────────────

function HistoryDayGroup({
  profileId,
  day,
  onEditMeal,
  onEditMed,
  onCloseDay,
  isClosingDay,
  onOpenDayEdit,
}: {
  day: DayData;
  onOpenDayEdit: () => void;
  onEditMeal: (meal: HistoryMealEntry) => void;
  onEditMed: (med: HistoryMedEntry) => void;
  onCloseDay?: (date: string) => void;
  isClosingDay?: boolean;
  profileId?: string;
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
        onClick={() => setExpanded(!expanded)}
        className="w-full flex flex-col p-4 bg-white rounded-2xl border border-gray-100 shadow-sm hover:border-gray-200 transition-all active:scale-[0.995]"
      >
        <div className="w-full flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {closure ? (
              <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
            ) : (
              <Circle className="w-4 h-4 text-gray-300 shrink-0" />
            )}
            <span className="font-semibold text-gray-900 text-sm">
              {friendly}
            </span>
          </div>
          {expanded
            ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
            : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
          }
        </div>

        {/* Subtitle */}
        <div className="mt-1.5 ml-6.5 text-left pl-[26px]">
          {closure ? (
            <span className="text-[11px] text-gray-400">
              Encerrado por <span className="font-medium">{closure.closed_by_profile?.name || 'Familiar'}</span>
              {' '}às {formatDateToTime(closure.closed_at)}
            </span>
          ) : (
            <span className="text-[11px] text-gray-400">Dia em aberto</span>
          )}
        </div>
      </button>

      {/* Accordion body */}
      {expanded && (
        <div className="mt-2 bg-gray-50/80 rounded-2xl border border-gray-100 p-4 space-y-6">

          {/* Status banner */}
          {closure ? (
            <div className="flex items-center gap-2 text-xs font-semibold text-green-700 bg-green-50 border border-green-100 px-3 py-2.5 rounded-xl">
              <CheckCircle2 className="w-3.5 h-3.5" />
              DIA ENCERRADO
            </div>
          ) : (
            <div className="flex items-center justify-between text-xs font-semibold text-gray-500 bg-white border border-gray-100 px-3 py-2.5 rounded-xl shadow-sm">
              <div className="flex items-center gap-2">
                <Circle className="w-3.5 h-3.5" />
                DIA EM ABERTO
              </div>
              {onCloseDay && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseDay(day.dateStr);
                  }}
                  disabled={isClosingDay}
                  className="px-3 py-1.5 bg-black text-white rounded-lg active:scale-95 transition-all disabled:opacity-50 font-medium tracking-wide flex items-center gap-1.5"
                >
                  {isClosingDay ? (
                    <>
                      <Spinner className="w-3 h-3 text-white" />
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
            onClick={(e) => {
              e.stopPropagation();
              onOpenDayEdit();
            }}
            className="w-full flex items-center justify-center gap-2 py-2.5 mt-2 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 active:bg-gray-100 rounded-xl text-sm font-medium transition-all shadow-sm"
          >
            Editar registros deste dia
          </button>

          {/* Meals section */}
          {meals.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                🍽 Refeições
              </h4>
              <div className="space-y-3">
                {meals.map(meal => (
                  <MealRow profileId={profileId}
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
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                💊 Medicamentos
              </h4>
              <div className="space-y-3">
                {meds.map(med => (
                  <MedRow profileId={profileId}
                    key={med.logId}
                    med={med}
                    onEdit={() => onEditMed(med)}
                  />
                ))}
              </div>
            </div>
          )}

          {meals.length === 0 && meds.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">Nenhum registro neste dia.</p>
          )}

          {/* Day summary */}
          <div className="border-t border-gray-100 pt-4">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">
              Resumo do dia
            </h4>
            <div className="space-y-1.5 text-xs text-gray-600">
              <div className="flex justify-between">
                <span>Refeições registradas</span>
                <span className="font-semibold text-gray-900">{totalMeals}</span>
              </div>
              <div className="flex justify-between">
                <span>Medicamentos registrados</span>
                <span className="font-semibold text-gray-900">{totalMeds}</span>
              </div>
              <div className="flex justify-between mt-2 pt-2 border-t border-gray-100">
                <span>Status</span>
                <span className={`font-semibold ${closure ? 'text-green-700' : 'text-gray-500'}`}>
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

export function HistoryScreen({ onTabChange, onEditPastDay }: { onTabChange?: (tab: 'today' | 'history' | 'routine') => void, onEditPastDay?: (dateStr: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [patient, setPatient] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [days, setDays] = useState<DayData[]>([]);

  // Modal state — meal editing
  const [selectedMeal, setSelectedMeal] = useState<{ meal: HistoryMealEntry; dateStr: string } | null>(null);
  // Modal state — med editing
  const [selectedMed, setSelectedMed] = useState<{ med: HistoryMedEntry; dateStr: string } | null>(null);
  const [closingDateStr, setClosingDateStr] = useState<string | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [daysLimit, setDaysLimit] = useState(14);
  const [filterCategory, setFilterCategory] = useState<'all' | 'meals' | 'meds'>('all');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  
  // All hooks declared before any conditional return ✓
  useEffect(() => {
    loadData();
  }, [daysLimit, filterCategory, filterStartDate, filterEndDate]);

  async function handleCloseDay(dateStr: string) {
    if (!profile || !patient) return;
    setClosingDateStr(dateStr);
    try {
      await createDailyClosure(profile.family_id, patient.id, dateStr, profile.id);
      await loadData();
    } catch (err) {
      console.error(err);
      console.error('Erro ao encerrar o dia.');
    } finally {
      setClosingDateStr(null);
    }
  }

  async function loadData() {
    setLoading(true);
    try {
      const prof = await getCurrentProfile();
      if (!prof) return;
      setProfile(prof);

      const pat = await getPatient(prof.family_id);
      if (!pat) return;
      setPatient(pat);

      // calculate upper bound
      let upperLimit = getLocalDateString();
      if (filterEndDate) {
        const endD = new Date(filterEndDate + 'T12:00:00');
        endD.setDate(endD.getDate() + 1);
        upperLimit = endD.toISOString().split('T')[0];
      }

      let lowerLimit = '';
      if (filterStartDate) {
        lowerLimit = filterStartDate;
      } else {
        const startDateObj = new Date();
        startDateObj.setDate(startDateObj.getDate() - daysLimit);
        lowerLimit = startDateObj.toISOString().split('T')[0];
      }

      const [rawMealLogs, rawMedLogs, rawClosures] = await Promise.all([
        getHistoricalMealLogs(pat.id, upperLimit, lowerLimit),
        getHistoricalMedicationLogs(pat.id, upperLimit, lowerLimit),
        getHistoricalDailyClosures(pat.id, upperLimit, lowerLimit),
      ]);

      
      if (filterCategory === 'meals') {
        rawMedLogs.length = 0;
      } else if (filterCategory === 'meds') {
        rawMealLogs.length = 0;
      }
      
      // Build closures map: date → closure object
      const closuresMap: Record<string, any> = {};
      for (const c of rawClosures) {
        // date comes back as "2026-08-15" string from Supabase DATE column
        closuresMap[c.date] = c;
      }

      // Collect all unique dates from logs
      const dateSet = new Set<string>();
      for (const log of rawMealLogs) {
        if (log.event_date) dateSet.add(log.event_date);
      }
      for (const log of rawMedLogs) {
        if (log.event_date) dateSet.add(log.event_date);
      }
      // Also include dates with closure but no logs (edge case)
      if (filterCategory === 'all') {
        for (const c of rawClosures) {
          if (c.date) dateSet.add(c.date);
        }
      }

      // Sort dates descending (newest first) — pure string comparison works for ISO dates
      const sortedDates = Array.from(dateSet).sort((a, b) => b.localeCompare(a));

      // Build meal entries per date
      const mealsByDate: Record<string, HistoryMealEntry[]> = {};
      for (const log of rawMealLogs) {
        const d = log.event_date;
        if (!d) continue;
        if (!mealsByDate[d]) mealsByDate[d] = [];

        // Fetch signed URL only if photo_url exists
        let photoSignedUrl: string | null = null;
        if (log.photo_url) {
          photoSignedUrl = await getMealPhotoUrl(log.photo_url);
        }

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
          notes: log.notes ?? null,
          photo_url: log.photo_url ?? null,
          photoSignedUrl,
          creatorName: log.creator?.name || 'Familiar',
          created_at: log.created_at,
          mealConfig,
          log,
        });
      }

      // Sort meals within each date by time
      for (const d of Object.keys(mealsByDate)) {
        mealsByDate[d].sort((a, b) => a.time.localeCompare(b.time));
      }

      // Build medication entries per date
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

      // Sort meds within each date by period time
      for (const d of Object.keys(medsByDate)) {
        medsByDate[d].sort((a, b) => a.time.localeCompare(b.time));
      }

      // Assemble final DayData array
      const assembled: DayData[] = sortedDates.map(dateStr => ({
        dateStr,
        meals: mealsByDate[dateStr] ?? [],
        meds: medsByDate[dateStr] ?? [],
        closure: closuresMap[dateStr] ?? null,
      }));

      setDays(assembled);
    } catch (err) {
      console.error('[HistoryScreen] loadData error:', err);
    } finally {
      setLoading(false);
    }
  }

  // ── Conditional returns — AFTER all hooks ──

  if (loading) {
    return (
      <MainLayout activeTab="history" onTabChange={onTabChange}>
        <div className="flex h-[80vh] items-center justify-center">
          <Spinner />
        </div>
      
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

  if (!patient) {
    return (
      <MainLayout activeTab="history" onTabChange={onTabChange}>
        <div className="flex h-[80vh] items-center justify-center flex-col text-center px-6">
          <p className="text-gray-500">Paciente não encontrado.</p>
        </div>
      </MainLayout>
    );
  }

  // Convert HistoryMealEntry → MealEventData shape expected by MealModal
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

  // Convert HistoryMedEntry → MedicationEventData shape expected by MedicationModal
  function toMedEvent(med: HistoryMedEntry): MedicationEventData {
    return {
      id: med.periodId,
      type: 'medication_period',
      time: med.time,
      title: med.periodName,
      status: med.status === 'administered' ? 'confirmed' : 'attention',
      period: med.medication?.period || { id: med.periodId, scheduled_time: med.time, name: med.periodName },
      medications: med.medication ? [med.medication] : [],
      logs: [med.log],
    };
  }

  return (
    <MainLayout activeTab="history" onTabChange={onTabChange}>
      <div className="max-w-md mx-auto w-full">

        {/* Header */}
        <div className="bg-white px-6 pt-12 pb-6 sticky top-0 z-30 border-b border-gray-100/50 backdrop-blur-xl">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Histórico</h1>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowReportModal(true)}
                className="p-2 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-full transition-colors"
                title="Gerar Relatório"
              >
                <FileText className="w-5 h-5" />
              </button>
              <UserProfile />
            </div>
          </div>
          <p className="text-sm text-gray-500">
            Registros anteriores de {patient.name}
          </p>
        </div>

        
        {/* Filters */}
        <div className="px-6 pb-2">
          <div className="flex flex-wrap gap-2">
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value as any)}
              className="bg-gray-50 border border-gray-200 text-gray-700 text-sm rounded-xl px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
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
                className="bg-gray-50 border border-gray-200 text-gray-700 text-sm rounded-xl px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                title="Data inicial"
              />
              <span className="text-gray-400 text-sm">até</span>
              <input
                type="date"
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
                className="bg-gray-50 border border-gray-200 text-gray-700 text-sm rounded-xl px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                title="Data final"
              />
            </div>
            
            {(filterStartDate || filterEndDate || filterCategory !== 'all') && (
              <button
                onClick={() => {
                  setFilterStartDate('');
                  setFilterEndDate('');
                  setFilterCategory('all');
                }}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800 self-center px-2 py-2"
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
              <p className="text-gray-400 text-sm">Nenhum registro histórico encontrado nos últimos {daysLimit} dias.</p>
              <p className="text-gray-300 text-xs mt-1">Os registros dos dias anteriores aparecerão aqui.</p>
            </div>
          ) : (
            days.map(day => (
              <HistoryDayGroup profileId={profile?.id}
                key={day.dateStr}
                day={day}
                onEditMeal={(meal) => setSelectedMeal({ meal, dateStr: day.dateStr })}
                onEditMed={(med) => setSelectedMed({ med, dateStr: day.dateStr })}
                onCloseDay={handleCloseDay}
                isClosingDay={closingDateStr === day.dateStr}
                onOpenDayEdit={() => onEditPastDay?.(day.dateStr)}
              />
            ))
          )}
          
          {days.length > 0 && !filterStartDate && (
            <div className="flex justify-center pt-8 pb-4">
              <button 
                onClick={() => setDaysLimit(prev => prev + 14)}
                className="text-sm font-medium text-indigo-600 bg-indigo-50 px-6 py-2.5 rounded-xl hover:bg-indigo-100 transition-colors"
              >
                Carregar mais antigos
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Meal edit modal */}
      {selectedMeal && patient && profile && (
        <MealModal
          isOpen={!!selectedMeal}
          onClose={() => setSelectedMeal(null)}
          event={toMealEvent(selectedMeal.meal)}
          patientId={patient.id}
          profileId={profile.id}
          eventDate={selectedMeal.dateStr}
          onSuccess={() => { loadData(); setSelectedMeal(null); }}
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
          onSuccess={() => { loadData(); setSelectedMed(null); }}
        />
      )}
      
    </MainLayout>
  );
}
