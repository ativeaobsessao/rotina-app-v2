import { DEFAULT_TIMEZONE, formatTime, getLocalDateString } from '../utils/date';
import {
  formatMedicationScheduleSummary,
  hasCustomDailyDosages,
  getMedicationWeekdays,
  WEEKDAY_OPTIONS,
} from '../utils/medicationSchedule';
import {
  formatActivityScheduleSummary,
  getActivityCategoryLabel,
  isExpiredOneTimeActivity,
} from '../utils/activitySchedule';
import React, { useEffect, useRef, useState } from 'react';
import { Plus, Edit2, Camera, AlertCircle, RotateCcw, CalendarClock, Repeat } from 'lucide-react';
import { MainLayout } from '../layouts/MainLayout';
import { 
  getCurrentProfile, 
  getPatient, 
  getMyFamilyPermissions,
  getPatientPhotoUrl,
  getMealConfigs, 
  getMedicationPeriods, 
  getMedications,
  getActivities,
} from '../services/api';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';
import { UserProfile } from '../components/ui/UserProfile';
import { NotificationBell } from '../components/notifications/NotificationBell';
import { PatientEditModal } from '../components/routine/PatientEditModal';
import { TimeEditModal } from '../components/routine/TimeEditModal';
import { MedicationFormModal } from '../components/routine/MedicationFormModal';
import { ActivityFormModal } from '../components/routine/ActivityFormModal';

interface RoutineScreenProps {
  onTabChange?: (tab: 'today' | 'history' | 'routine') => void;
}

export function RoutineScreen({ onTabChange }: RoutineScreenProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [canManageActivities, setCanManageActivities] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [patient, setPatient] = useState<any>(null);
  const [patientPhoto, setPatientPhoto] = useState<string | null>(null);
  const [meals, setMeals] = useState<any[]>([]);
  const [periods, setPeriods] = useState<any[]>([]);
  const [medications, setMedications] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);

  // Modals state
  const [isPatientModalOpen, setIsPatientModalOpen] = useState(false);
  
  const [editingTimeEntity, setEditingTimeEntity] = useState<any | undefined>(undefined);
  const [editingTimeType, setEditingTimeType] = useState<'meal' | 'period' | undefined>(undefined);
  
  const [editingMedication, setEditingMedication] = useState<any | null>(null);
  const [defaultPeriodForMed, setDefaultPeriodForMed] = useState<string>('');
  const [isMedicationModalOpen, setIsMedicationModalOpen] = useState(false);

  const [editingActivity, setEditingActivity] = useState<any | null>(null);
  const [defaultActivityScheduleType, setDefaultActivityScheduleType] = useState<'one_time' | 'weekly'>('one_time');
  const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);

  const [toastMessage, setToastMessage] = useState('');

  const isMountedRef = useRef(true);
  const loadSeqRef = useRef(0);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      if (isMountedRef.current) setToastMessage('');
    }, 3000);
  };

  const loadData = async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const prof = await getCurrentProfile();
      if (!isMountedRef.current || seq !== loadSeqRef.current) return;
      if (!prof) {
        setLoadError('Não foi possível identificar sua conta no momento.');
        return;
      }
      setProfile(prof);

      const [pat, perms] = await Promise.all([
        getPatient(prof.family_id),
        getMyFamilyPermissions(prof.family_id),
      ]);
      if (!isMountedRef.current || seq !== loadSeqRef.current) return;
      setIsAdmin(perms.isAdmin);
      setCanManageActivities(perms.isMember);
      if (!pat) {
        setLoadError('Não foi possível carregar os dados do familiar.');
        return;
      }
      setPatient(pat);

      const [photoUrl, loadedMeals, loadedPeriods, loadedMeds, loadedActivities] = await Promise.all([
        pat.photo_url ? getPatientPhotoUrl(pat.id, pat.photo_url) : Promise.resolve(null),
        getMealConfigs(pat.id),
        getMedicationPeriods(pat.id),
        getMedications(pat.id),
        getActivities(pat.id),
      ]);
      if (!isMountedRef.current || seq !== loadSeqRef.current) return;

      setPatientPhoto(photoUrl);
      setMeals(loadedMeals.sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time)));
      setPeriods(loadedPeriods.sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time)));
      setMedications(loadedMeds);
      setActivities(loadedActivities);

    } catch (err: any) {
      console.error('[Routine] Erro ao carregar rotina:', err);
      if (isMountedRef.current && seq === loadSeqRef.current) {
        setLoadError(err?.message || 'Não foi possível carregar a rotina. Verifique sua conexão.');
      }
    } finally {
      if (isMountedRef.current && seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handlePatientSuccess = () => {
    setIsPatientModalOpen(false);
    showToast('Alterações salvas.');
    loadData();
  };

  const handleTimeSuccess = () => {
    setEditingTimeEntity(undefined);
    setEditingTimeType(undefined);
    showToast('Alterações salvas.');
    loadData();
  };

  const handleMedicationSuccess = () => {
    setIsMedicationModalOpen(false);
    setEditingMedication(null);
    showToast('Medicamento adicionado/atualizado.');
    loadData();
  };

  const handleActivitySuccess = () => {
    setIsActivityModalOpen(false);
    setEditingActivity(null);
    showToast('Atividade salva.');
    loadData();
  };

  if (loadError && !patient) {
    return (
      <MainLayout activeTab="routine" onTabChange={onTabChange}>
        <div className="flex flex-col h-[75vh] items-center justify-center px-6 text-center max-w-md mx-auto">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/50 flex items-center justify-center mb-4">
            <AlertCircle className="w-6 h-6 text-rose-500" />
          </div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-zinc-100 mb-2">
            Não foi possível carregar a rotina
          </h2>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mb-6 leading-relaxed">
            {loadError}
          </p>
          <Button onClick={loadData} className="rounded-2xl px-6 py-3">
            <RotateCcw className="w-4 h-4 mr-2" /> Tentar novamente
          </Button>
        </div>
      </MainLayout>
    );
  }

  if (loading && !patient) {
    return (
      <MainLayout activeTab="routine" onTabChange={onTabChange}>
        <div className="flex h-[80vh] items-center justify-center">
          <Spinner />
        </div>
      </MainLayout>
    );
  }


  const todayStr = getLocalDateString(DEFAULT_TIMEZONE);
  const scheduledActivities = activities
    .filter((a) => a.schedule_type === 'one_time' && !isExpiredOneTimeActivity(a, todayStr))
    .sort((a, b) => {
      const dateCmp = String(a.scheduled_date || '').localeCompare(String(b.scheduled_date || ''));
      if (dateCmp !== 0) return dateCmp;
      return String(a.scheduled_time || '').localeCompare(String(b.scheduled_time || ''));
    });

  const weeklyActivities = activities
    .filter((a) => a.schedule_type === 'weekly')
    .sort((a, b) => String(a.scheduled_time || '').localeCompare(String(b.scheduled_time || '')));

  return (
    <MainLayout activeTab="routine" onTabChange={onTabChange}>
      {toastMessage && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-6 py-3 rounded-full shadow-lg text-sm font-medium animate-in slide-in-from-top-4 fade-in">
          {toastMessage}
        </div>
      )}
      <div className="max-w-md mx-auto w-full px-6 py-12 space-y-12">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">Rotina</h1>
          <div className="flex items-center gap-2 shrink-0">
            <NotificationBell
              familyId={profile?.family_id}
              patientId={patient?.id}
              patientName={patient?.name}
              userId={profile?.id}
              activities={activities}
              todayDateStr={todayStr}
            />
            <UserProfile />
          </div>
        </div>
        <div>
          
          <div className="bg-white dark:bg-[#121216] rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-white/[0.08] flex flex-col items-center text-center">
            <div className="relative mb-4">
              <div className="w-24 h-24 rounded-full bg-gray-100 dark:bg-[#1c1c22] border border-gray-200 dark:border-white/[0.1] overflow-hidden flex items-center justify-center">
                {patientPhoto ? (
                  <img src={patientPhoto} alt={patient?.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-4xl">👵</span>
                )}
              </div>
              {isAdmin && (
                <button 
                  onClick={() => setIsPatientModalOpen(true)}
                  className="absolute bottom-0 right-0 w-8 h-8 bg-gray-900 dark:bg-zinc-100 rounded-full text-white dark:text-zinc-950 flex items-center justify-center shadow-sm border-2 border-white dark:border-[#121216]"
                >
                  <Camera className="w-4 h-4" />
                </button>
              )}
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100">{patient?.name}</h2>
            {isAdmin && (
              <button onClick={() => setIsPatientModalOpen(true)} className="text-sm font-medium text-gray-500 dark:text-zinc-400 mt-2 hover:text-gray-900 dark:hover:text-zinc-100">
                Editar perfil
              </button>
            )}
          </div>
        </div>

        {/* Meals Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between ml-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">Refeições</h3>
            {isAdmin && (
              <button 
                onClick={() => {
                  setEditingTimeType('meal');
                  setEditingTimeEntity(null);
                }}
                className="text-xs font-medium text-gray-600 dark:text-zinc-200 bg-gray-100 dark:bg-[#1c1c22] hover:bg-gray-200 dark:hover:bg-[#222229] dark:border dark:border-white/[0.08] px-3 py-1.5 rounded-lg transition-colors flex items-center"
              >
                <Plus className="w-3 h-3 mr-1" /> Adicionar
              </button>
            )}
          </div>
          <div className="space-y-3">
            {meals.map((meal) => {
              const plannedDesc = meal.default_description?.trim();
              const plannedDrink = meal.default_drink_description?.trim();
              const canConfigureMeal = isAdmin || canManageActivities;

              return canConfigureMeal ? (
                <button
                  key={meal.id}
                  type="button"
                  onClick={() => {
                    setEditingTimeType('meal');
                    setEditingTimeEntity(meal);
                  }}
                  className={`w-full flex items-center justify-between p-4 rounded-2xl border bg-white dark:bg-[#121216] shadow-sm transition-all active:scale-[0.98] ${
                    !meal.active
                      ? 'opacity-60 border-gray-100 dark:border-white/[0.05]'
                      : 'border-gray-200 dark:border-white/[0.08] dark:hover:bg-[#18181d]'
                  }`}
                >
                  <div className="text-left min-w-0 pr-3">
                    <h4
                      className={`font-semibold ${
                        !meal.active
                          ? 'text-gray-500 dark:text-zinc-500 line-through'
                          : 'text-gray-900 dark:text-zinc-100'
                      }`}
                    >
                      {meal.name}
                    </h4>
                    <p className="text-sm text-gray-500 dark:text-zinc-400">
                      {formatTime(meal.scheduled_time)}
                    </p>
                    {plannedDesc && (
                      <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1 truncate">
                        🍽️ {plannedDesc}
                      </p>
                    )}
                    {plannedDrink && (
                      <p className="text-xs text-sky-700/80 dark:text-sky-300/90 mt-0.5 truncate">
                        🥤 {plannedDrink}
                      </p>
                    )}
                    {!plannedDesc && !plannedDrink && (
                      <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-1">
                        Toque para definir o cardápio
                      </p>
                    )}
                  </div>
                  <Edit2 className="w-4 h-4 text-gray-300 dark:text-zinc-600 shrink-0" />
                </button>
              ) : (
                <div
                  key={meal.id}
                  className={`w-full flex items-center justify-between p-4 rounded-2xl border bg-white dark:bg-[#121216] shadow-sm ${
                    !meal.active
                      ? 'opacity-60 border-gray-100 dark:border-white/[0.05]'
                      : 'border-gray-200 dark:border-white/[0.08]'
                  }`}
                >
                  <div className="text-left min-w-0">
                    <h4
                      className={`font-semibold ${
                        !meal.active
                          ? 'text-gray-500 dark:text-zinc-500 line-through'
                          : 'text-gray-900 dark:text-zinc-100'
                      }`}
                    >
                      {meal.name}
                    </h4>
                    <p className="text-sm text-gray-500 dark:text-zinc-400">
                      {formatTime(meal.scheduled_time)}
                    </p>
                    {plannedDesc && (
                      <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1 truncate">
                        🍽️ {plannedDesc}
                      </p>
                    )}
                    {plannedDrink && (
                      <p className="text-xs text-sky-700/80 dark:text-sky-300/90 mt-0.5 truncate">
                        🥤 {plannedDrink}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Medication Periods Section */}
        <section className="space-y-8">
          <div className="flex items-center justify-between ml-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">Medicamentos</h3>
            {isAdmin && (
              <button 
                onClick={() => {
                  setEditingTimeType('period');
                  setEditingTimeEntity(null);
                }}
                className="text-xs font-medium text-gray-600 dark:text-zinc-200 bg-gray-100 dark:bg-[#1c1c22] hover:bg-gray-200 dark:hover:bg-[#222229] dark:border dark:border-white/[0.08] px-3 py-1.5 rounded-lg transition-colors flex items-center"
              >
                <Plus className="w-3 h-3 mr-1" /> Adicionar Período
              </button>
            )}
          </div>
          
          <div className="space-y-6">
            {periods.map(period => {
              const periodMeds = medications.filter(m => m.medication_period_id === period.id);
              
              return (
                <div key={period.id} className="bg-white dark:bg-[#121216] rounded-3xl p-5 border border-gray-100 dark:border-white/[0.08] shadow-sm">
                  <div className="flex items-center justify-between mb-4 border-b border-gray-50 dark:border-white/[0.06] pb-4">
                    <div className="text-left">
                      <h4 className={`font-bold ${!period.active ? 'text-gray-400 dark:text-zinc-500 line-through' : 'text-gray-900 dark:text-zinc-100'}`}>{period.name}</h4>
                      <p className="text-sm text-gray-500 dark:text-zinc-400">{formatTime(period.scheduled_time)}</p>
                    </div>
                    {isAdmin && (
                      <button 
                        onClick={() => {
                          setEditingTimeType('period');
                          setEditingTimeEntity(period);
                        }}
                        className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-zinc-200 bg-gray-100 dark:bg-[#1c1c22] dark:border dark:border-white/[0.08] rounded-lg hover:bg-gray-200 dark:hover:bg-[#222229] transition-colors"
                      >
                        Editar horário
                      </button>
                    )}
                  </div>

                  <div className="space-y-2 mb-4">
                    {periodMeds.map((med) => {
                      const summaryText = formatMedicationScheduleSummary(med);
                      const customDetails = hasCustomDailyDosages(med)
                        ? getMedicationWeekdays(med)
                            .map((dayKey) => {
                              const opt = WEEKDAY_OPTIONS.find((w) => w.key === dayKey);
                              const d = med.daily_dosages?.[dayKey] || med.dosage;
                              return `${opt?.abbr || dayKey}: ${d}`;
                            })
                            .join(' · ')
                        : null;

                      return isAdmin ? (
                        <button
                          key={med.id}
                          onClick={() => {
                            setEditingMedication(med);
                            setIsMedicationModalOpen(true);
                          }}
                          className={`w-full flex items-center justify-between p-3 rounded-xl border transition-colors text-left ${!med.active ? 'bg-gray-50 dark:bg-[#16161b] border-gray-100 dark:border-white/[0.05] opacity-70' : 'bg-white dark:bg-[#1c1c22] border-gray-100 dark:border-white/[0.08] hover:border-gray-200 dark:hover:bg-[#222229]'}`}
                        >
                          <div className="min-w-0 pr-2">
                            <p className={`font-medium ${!med.active ? 'text-gray-400 dark:text-zinc-500 line-through' : 'text-gray-900 dark:text-zinc-100'}`}>{med.name}</p>
                            <p className="text-xs text-gray-500 dark:text-zinc-400">{summaryText}</p>
                            {customDetails && (
                              <p className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-0.5 leading-snug">
                                {customDetails}
                              </p>
                            )}
                          </div>
                          <Edit2 className="w-4 h-4 text-gray-300 dark:text-zinc-600 shrink-0" />
                        </button>
                      ) : (
                        <div
                          key={med.id}
                          className={`w-full flex items-center justify-between p-3 rounded-xl border text-left ${!med.active ? 'bg-gray-50 dark:bg-[#16161b] border-gray-100 dark:border-white/[0.05] opacity-70' : 'bg-white dark:bg-[#1c1c22] border-gray-100 dark:border-white/[0.08]'}`}
                        >
                          <div className="min-w-0">
                            <p className={`font-medium ${!med.active ? 'text-gray-400 dark:text-zinc-500 line-through' : 'text-gray-900 dark:text-zinc-100'}`}>{med.name}</p>
                            <p className="text-xs text-gray-500 dark:text-zinc-400">{summaryText}</p>
                            {customDetails && (
                              <p className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-0.5 leading-snug">
                                {customDetails}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {periodMeds.length === 0 && (
                      <p className="text-sm text-gray-400 dark:text-zinc-500 text-center py-2">Nenhum medicamento configurado.</p>
                    )}
                  </div>

                  {isAdmin && (
                    <button 
                      onClick={() => {
                        setDefaultPeriodForMed(period.id);
                        setEditingMedication(null);
                        setIsMedicationModalOpen(true);
                      }}
                      className="w-full flex items-center justify-center p-3 text-sm font-medium text-gray-600 dark:text-zinc-300 border border-dashed border-gray-300 dark:border-white/[0.14] rounded-xl hover:bg-gray-50 dark:hover:bg-white/[0.04] hover:border-gray-400 dark:hover:border-white/[0.25] transition-all active:scale-[0.98]"
                    >
                      <Plus className="w-4 h-4 mr-2" /> Adicionar medicamento
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Activities Section (Available for all active family accounts) */}
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-2 ml-1">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
                Atividades
              </h3>
              <p className="text-[11px] text-gray-500 dark:text-zinc-400 mt-0.5">
                Consultas médicas, exames e atividades físicas
              </p>
            </div>
            {canManageActivities && (
              <button
                type="button"
                onClick={() => {
                  setEditingActivity(null);
                  setDefaultActivityScheduleType('one_time');
                  setIsActivityModalOpen(true);
                }}
                className="min-h-[44px] text-xs font-medium text-gray-600 dark:text-zinc-200 bg-gray-100 dark:bg-[#1c1c22] hover:bg-gray-200 dark:hover:bg-[#222229] dark:border dark:border-white/[0.08] px-3.5 py-2 rounded-xl transition-colors flex items-center whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Adicionar
              </button>
            )}
          </div>

          {scheduledActivities.length === 0 && weeklyActivities.length === 0 ? (
            <div className="bg-white dark:bg-[#121216] rounded-3xl p-5 border border-gray-100 dark:border-white/[0.08] shadow-sm text-center space-y-3">
              <p className="text-sm text-gray-500 dark:text-zinc-400 leading-relaxed">
                Nenhuma atividade configurada. Adicione consultas médicas com data marcada ou práticas semanais como fisioterapia e yoga.
              </p>
              {canManageActivities && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingActivity(null);
                    setDefaultActivityScheduleType('one_time');
                    setIsActivityModalOpen(true);
                  }}
                  className="w-full min-h-[44px] flex items-center justify-center p-3 text-sm font-medium text-gray-600 dark:text-zinc-300 border border-dashed border-gray-300 dark:border-white/[0.14] rounded-xl hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-all active:scale-[0.98]"
                >
                  <Plus className="w-4 h-4 mr-2" /> Adicionar atividade
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {scheduledActivities.length > 0 && (
                <div className="bg-white dark:bg-[#121216] rounded-3xl p-5 border border-gray-100 dark:border-white/[0.08] shadow-sm space-y-3">
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-gray-50 dark:border-white/[0.06]">
                    <div className="flex items-center gap-2">
                      <CalendarClock className="w-4 h-4 text-indigo-500 dark:text-indigo-400 shrink-0" />
                      <h4 className="font-bold text-sm text-gray-900 dark:text-zinc-100">
                        Agendadas (data marcada)
                      </h4>
                    </div>
                    <span className="text-xs font-medium text-gray-400 dark:text-zinc-500 tabular-nums">
                      {scheduledActivities.length}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {scheduledActivities.map((act) => {
                      const summaryText = formatActivityScheduleSummary(act, todayStr);
                      const catLabel = getActivityCategoryLabel(act.category);
                      return canManageActivities ? (
                        <button
                          key={act.id}
                          type="button"
                          onClick={() => {
                            setEditingActivity(act);
                            setIsActivityModalOpen(true);
                          }}
                          className={`w-full min-h-[44px] flex items-center justify-between p-3 rounded-xl border transition-colors text-left ${
                            !act.active
                              ? 'bg-gray-50 dark:bg-[#16161b] border-gray-100 dark:border-white/[0.05] opacity-70'
                              : 'bg-white dark:bg-[#1c1c22] border-gray-100 dark:border-white/[0.08] hover:border-gray-200 dark:hover:bg-[#222229]'
                          }`}
                        >
                          <div className="min-w-0 pr-2">
                            <p
                              className={`font-medium ${
                                !act.active
                                  ? 'text-gray-400 dark:text-zinc-500 line-through'
                                  : 'text-gray-900 dark:text-zinc-100'
                              }`}
                            >
                              {act.title}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-zinc-400 tabular-nums">
                              {catLabel} · {summaryText}
                            </p>
                            {act.notes && (
                              <p className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-0.5 truncate">
                                {act.notes}
                              </p>
                            )}
                          </div>
                          <Edit2 className="w-4 h-4 text-gray-300 dark:text-zinc-600 shrink-0" />
                        </button>
                      ) : (
                        <div
                          key={act.id}
                          className={`w-full flex items-center justify-between p-3 rounded-xl border text-left ${
                            !act.active
                              ? 'bg-gray-50 dark:bg-[#16161b] border-gray-100 dark:border-white/[0.05] opacity-70'
                              : 'bg-white dark:bg-[#1c1c22] border-gray-100 dark:border-white/[0.08]'
                          }`}
                        >
                          <div className="min-w-0">
                            <p
                              className={`font-medium ${
                                !act.active
                                  ? 'text-gray-400 dark:text-zinc-500 line-through'
                                  : 'text-gray-900 dark:text-zinc-100'
                              }`}
                            >
                              {act.title}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-zinc-400 tabular-nums">
                              {catLabel} · {summaryText}
                            </p>
                            {act.notes && (
                              <p className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-0.5 truncate">
                                {act.notes}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {weeklyActivities.length > 0 && (
                <div className="bg-white dark:bg-[#121216] rounded-3xl p-5 border border-gray-100 dark:border-white/[0.08] shadow-sm space-y-3">
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-gray-50 dark:border-white/[0.06]">
                    <div className="flex items-center gap-2">
                      <Repeat className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
                      <h4 className="font-bold text-sm text-gray-900 dark:text-zinc-100">
                        Recorrentes (toda semana)
                      </h4>
                    </div>
                    <span className="text-xs font-medium text-gray-400 dark:text-zinc-500 tabular-nums">
                      {weeklyActivities.length}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {weeklyActivities.map((act) => {
                      const summaryText = formatActivityScheduleSummary(act, todayStr);
                      const catLabel = getActivityCategoryLabel(act.category);
                      return canManageActivities ? (
                        <button
                          key={act.id}
                          type="button"
                          onClick={() => {
                            setEditingActivity(act);
                            setIsActivityModalOpen(true);
                          }}
                          className={`w-full min-h-[44px] flex items-center justify-between p-3 rounded-xl border transition-colors text-left ${
                            !act.active
                              ? 'bg-gray-50 dark:bg-[#16161b] border-gray-100 dark:border-white/[0.05] opacity-70'
                              : 'bg-white dark:bg-[#1c1c22] border-gray-100 dark:border-white/[0.08] hover:border-gray-200 dark:hover:bg-[#222229]'
                          }`}
                        >
                          <div className="min-w-0 pr-2">
                            <p
                              className={`font-medium ${
                                !act.active
                                  ? 'text-gray-400 dark:text-zinc-500 line-through'
                                  : 'text-gray-900 dark:text-zinc-100'
                              }`}
                            >
                              {act.title}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-zinc-400 tabular-nums">
                              {catLabel} · {summaryText}
                            </p>
                            {act.notes && (
                              <p className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-0.5 truncate">
                                {act.notes}
                              </p>
                            )}
                          </div>
                          <Edit2 className="w-4 h-4 text-gray-300 dark:text-zinc-600 shrink-0" />
                        </button>
                      ) : (
                        <div
                          key={act.id}
                          className={`w-full flex items-center justify-between p-3 rounded-xl border text-left ${
                            !act.active
                              ? 'bg-gray-50 dark:bg-[#16161b] border-gray-100 dark:border-white/[0.05] opacity-70'
                              : 'bg-white dark:bg-[#1c1c22] border-gray-100 dark:border-white/[0.08]'
                          }`}
                        >
                          <div className="min-w-0">
                            <p
                              className={`font-medium ${
                                !act.active
                                  ? 'text-gray-400 dark:text-zinc-500 line-through'
                                  : 'text-gray-900 dark:text-zinc-100'
                              }`}
                            >
                              {act.title}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-zinc-400 tabular-nums">
                              {catLabel} · {summaryText}
                            </p>
                            {act.notes && (
                              <p className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-0.5 truncate">
                                {act.notes}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

      </div>

      {/* Modals (ADMIN only) */}
      {isAdmin && (
        <>
          <PatientEditModal 
            isOpen={isPatientModalOpen} 
            onClose={() => setIsPatientModalOpen(false)} 
            patient={patient} 
            currentPhotoUrl={patientPhoto}
            onSuccess={handlePatientSuccess} 
          />

          <MedicationFormModal 
            isOpen={isMedicationModalOpen}
            onClose={() => setIsMedicationModalOpen(false)}
            patientId={patient?.id}
            medication={editingMedication}
            periods={periods}
            defaultPeriodId={defaultPeriodForMed}
            onSuccess={handleMedicationSuccess}
          />
        </>
      )}

      {/* Time / Meal Menu Modal (ADM edits all; any active member configures existing meal menu) */}
      {(isAdmin || (canManageActivities && editingTimeType === 'meal' && Boolean(editingTimeEntity))) && (
        <TimeEditModal
          isOpen={editingTimeType !== undefined}
          onClose={() => {
            setEditingTimeEntity(undefined);
            setEditingTimeType(undefined);
          }}
          entity={editingTimeEntity}
          patientId={patient?.id}
          type={(editingTimeType || 'meal') as 'meal' | 'period'}
          isAdmin={isAdmin}
          onSuccess={handleTimeSuccess}
        />
      )}

      {/* Activity Modal (all active family accounts) */}
      {canManageActivities && patient && profile && (
        <ActivityFormModal
          isOpen={isActivityModalOpen}
          onClose={() => {
            setIsActivityModalOpen(false);
            setEditingActivity(null);
          }}
          patientId={patient.id}
          profileId={profile.id}
          activity={editingActivity}
          defaultScheduleType={defaultActivityScheduleType}
          onSuccess={handleActivitySuccess}
        />
      )}

    </MainLayout>
  );
}
