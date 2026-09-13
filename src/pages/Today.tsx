import React, { useEffect, useState } from 'react';
import { MainLayout } from '../layouts/MainLayout';
import { 
  getCurrentProfile, 
  getPatient, 
  getMealConfigs, 
  getMedicationPeriods, 
  getMedications,
  getMealLogs,
  getMedicationLogs,
  getPatientPhotoUrl,
  getMealPhotoUrl,
  getDailyClosure,
  createDailyClosure,
  deleteDailyClosure
} from '../services/api';
import { supabase } from '../services/supabase';
import { getLocalDateString, getCurrentLocalTime, formatFriendlyDate, getWeekdayName, formatDateToTime } from '../utils/date';
import { Spinner } from '../components/ui/Spinner';

import { TimelineItem } from '../components/timeline/TimelineItem';
import { MealModal } from '../components/meals/MealModal';
import { UserProfile } from '../components/ui/UserProfile';
import { MedicationModal } from '../components/medications/MedicationModal';
import type { TimelineEvent, MealEventData, MedicationEventData } from '../types/timeline';
import { Unlock } from 'lucide-react';

export function TodayScreen({ onTabChange, editingDateStr, onClearEditDate }: { onTabChange?: (tab: 'today' | 'history' | 'routine') => void, editingDateStr?: string | null, onClearEditDate?: () => void }) {
  const [loading, setLoading] = useState(true);
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
  
  // Modals state
  const [selectedMealEvent, setSelectedMealEvent] = useState<MealEventData | null>(null);
  const [selectedMedEvent, setSelectedMedEvent] = useState<MedicationEventData | null>(null);

  const localDate = editingDateStr || getLocalDateString();
  const friendlyDate = formatFriendlyDate(localDate);

    async function loadData() {
    if (!patient) setLoading(true);
    else setIsTransitioning(true);
    try {
      const prof = await getCurrentProfile();
      if (!prof) return;
      setProfile(prof);

      const pat = await getPatient(prof.family_id);
      if (!pat) return;
      setPatient(pat);

      if (pat.photo_url) {
        const url = await getPatientPhotoUrl(pat.id, pat.photo_url);
        setPatientPhoto(url);
      }

      await refreshTimeline(pat.id, localDate);
    } catch (err) {
      console.error("Error loading data:", err);
    } finally {
      setLoading(false);
      setIsTransitioning(false);
    }
  }

  async function refreshTimeline(patientId: string, dateStr: string) {
    try {
      // Fetch configs and logs
      const [meals, medPeriods, allMeds, mealLogs, medLogs] = await Promise.all([
        getMealConfigs(patientId),
        getMedicationPeriods(patientId),
        getMedications(patientId),
        getMealLogs(patientId, dateStr),
        getMedicationLogs(patientId, dateStr)
      ]);

      const currentTime = getCurrentLocalTime();
      
      const closure = await getDailyClosure(patientId, localDate);
      setDailyClosure(closure);
      const currentWeekday = getWeekdayName(dateStr);

      const timeline: TimelineEvent[] = [];

      // 1. Process Meals
      for (const meal of meals) {
        const log = mealLogs.find(l => l.meal_config_id === meal.id);
        let status: 'waiting' | 'pending' | 'confirmed' = 'waiting';
        
        let photoSignedUrl = null;

        if (log) {
          status = 'confirmed';
          if (log.photo_url) {
            photoSignedUrl = await getMealPhotoUrl(log.photo_url);
          }
        } else if (meal.scheduled_time <= currentTime) {
          status = 'pending';
        }

        timeline.push({
          id: meal.id,
          type: 'meal',
          time: meal.scheduled_time,
          title: meal.name,
          status,
          mealConfig: meal,
          log,
          photoSignedUrl
        });
      }

      // 2. Process Medication Periods
      for (const period of medPeriods) {
        // Find meds for this period that should appear today
        const periodMeds = allMeds.filter(m => {
          if (m.medication_period_id !== period.id) return false;
          if (m.frequency === 'daily') return true;
          if (m.frequency === 'weekly') return m.weekday === currentWeekday;
          return false;
        });

        if (periodMeds.length === 0) continue; // Skip period if no meds today

        const periodLogs = medLogs.filter(l => periodMeds.some(m => m.id === l.medication_id));
        
        let status: 'waiting' | 'pending' | 'confirmed' | 'attention' = 'waiting';
        
        const allResolved = periodMeds.every(m => periodLogs.some(l => l.medication_id === m.id));
        const hasNotAdministered = periodLogs.some(l => l.status === 'not_administered');
        
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
          period,
          medications: periodMeds,
          logs: periodLogs
        });
      }

      // Sort timeline by time
      timeline.sort((a, b) => a.time.localeCompare(b.time));
      setEvents(timeline);
      setLoadedDate(dateStr);
    } catch (error) {
      console.error("Error refreshing timeline:", error);
    }
  }

  useEffect(() => {
    loadData();
  }, [localDate]);

  useEffect(() => {
    if (!patient) return;

    // Realtime setup
    const mealSub = supabase
      .channel('public:meal_logs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meal_logs' }, () => {
        refreshTimeline(patient.id, localDate);
      })
      .subscribe();

    const medSub = supabase
      .channel('public:medication_logs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'medication_logs' }, () => {
        refreshTimeline(patient.id, localDate);
      })
      .subscribe();

    // Focus setup
    const handleFocus = () => {
      refreshTimeline(patient.id, localDate);
    };
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleFocus();
      }
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      supabase.removeChannel(mealSub);
      supabase.removeChannel(medSub);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [patient?.id, localDate]);

  const handleMealRefresh = () => {
    if (patient) refreshTimeline(patient.id, localDate);
    setSelectedMealEvent(null);
  };

  const handleMedRefresh = () => {
    if (patient) refreshTimeline(patient.id, localDate);
    setSelectedMedEvent(null);
  };

  if (loading || isTransitioning || loadedDate !== localDate) {
    return (
      <MainLayout activeTab={editingDateStr ? "history" : "today"} onTabChange={onTabChange}>
        <div className="flex h-[80vh] items-center justify-center">
          <Spinner />
        </div>
      </MainLayout>
    );
  }

  if (!patient) {
    return (
      <MainLayout activeTab={editingDateStr ? "history" : "today"} onTabChange={onTabChange}>
        <div className="flex h-[80vh] items-center justify-center flex-col text-center px-6">
          <p className="text-gray-500">Paciente não encontrado ou rotina não configurada.</p>
        </div>
      </MainLayout>
    );
  }

  // Group events by time of day

  const resolvedEventsCount = events.filter(e => e.status === 'confirmed' || e.status === 'attention').length;
  const isAllEventsCompleted = events.length > 0 && resolvedEventsCount === events.length;

  

  const handleReopenDay = async () => {
    if (!patient || reopeningDay) return;
    setReopeningDay(true);
    try {
      const success = await deleteDailyClosure(patient.id, localDate);
      if (success) {
        setDailyClosure(null);
        setHasReopened(true);
        refreshTimeline(patient.id, localDate);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setReopeningDay(false);
    }
  };

  const handleCloseDay = async () => {
    if (!patient || !profile) return;
    setClosingDay(true);
    try {
      const success = await createDailyClosure(profile.family_id, patient.id, localDate, profile.id);
      if (success) {
        setShowClosureModal(false);
        refreshTimeline(patient.id, localDate);
      } else {
        console.error("Erro ao encerrar o dia.");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setClosingDay(false);
    }
  };

  const morning = events.filter(e => e.time < '12:00:00');

  const afternoon = events.filter(e => e.time >= '12:00:00' && e.time < '18:00:00');
  const night = events.filter(e => e.time >= '18:00:00');

  return (
    <MainLayout activeTab={editingDateStr ? "history" : "today"} onTabChange={onTabChange}>
      <div className="max-w-md mx-auto w-full">
        {/* Header */}
        
        {/* Banner de Edição do Passado */}
        {editingDateStr && (
          <div className="bg-indigo-50 px-6 py-3 border-b border-indigo-100 flex items-center justify-between shadow-sm">
            <div>
              <p className="text-xs font-bold text-indigo-800 uppercase tracking-wider">Modo de Edição</p>
              <p className="text-sm font-medium text-indigo-900 mt-0.5">Editando o dia {friendlyDate}</p>
            </div>
            <button
              onClick={onClearEditDate}
              className="text-xs font-bold text-indigo-700 bg-indigo-100/50 hover:bg-indigo-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              Voltar a Hoje
            </button>
          </div>
        )}

        <div className="bg-white px-6 pt-12 pb-6 sticky top-0 z-30 border-b border-gray-100/50 backdrop-blur-xl">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">DUDE</h1>
            <UserProfile />
          </div>

          <div className="flex items-center space-x-4">
            <div className="w-16 h-16 rounded-full bg-gray-100 border border-gray-200 overflow-hidden flex items-center justify-center shrink-0">
              {patientPhoto ? (
                <img src={patientPhoto} alt={patient.name} className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl">👵</span>
              )}
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">{patient.name}</h2>
              <p className="text-sm text-gray-500">Hoje, {friendlyDate}</p>
            </div>
          </div>
        </div>


        {/* Banners */}
        {!dailyClosure && hasReopened && (
          <div className="mx-6 mt-6 bg-amber-50 border border-amber-100 rounded-2xl p-4 flex items-start gap-3 shadow-sm animate-in fade-in slide-in-from-top-2">
            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-amber-800">Dia reaberto para alterações.</p>
              <p className="text-xs text-amber-700/80 mt-0.5">Não esqueça de encerrá-lo novamente ao terminar.</p>
            </div>
          </div>
        )}

        {!dailyClosure && !hasReopened && isAllEventsCompleted && (
          <div className="mx-6 mt-6 bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-start gap-3 shadow-sm animate-in fade-in slide-in-from-top-2">
            <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-emerald-800">Tudo pronto!</p>
              <p className="text-xs text-emerald-700/80 mt-0.5">Todas as atividades foram registradas. Você já pode encerrar o dia.</p>
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="px-6 py-6 space-y-8 pb-32">
          
          {morning.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Manhã</h3>
              <div className="space-y-3 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gray-100">
                {morning.map(event => (
                  <TimelineItem profileId={profile?.id} 
                    key={event.id} 
                    event={event} 
                    onClick={() => event.type === 'meal' ? setSelectedMealEvent(event as MealEventData) : setSelectedMedEvent(event as MedicationEventData)} 
                  />
                ))}
              </div>
            </div>
          )}

          {afternoon.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Tarde</h3>
              <div className="space-y-3 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gray-100">
                {afternoon.map(event => (
                  <TimelineItem profileId={profile?.id} 
                    key={event.id} 
                    event={event} 
                    onClick={() => event.type === 'meal' ? setSelectedMealEvent(event as MealEventData) : setSelectedMedEvent(event as MedicationEventData)} 
                  />
                ))}
              </div>
            </div>
          )}

          {night.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Noite</h3>
              <div className="space-y-3 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gray-100">
                {night.map(event => (
                  <TimelineItem profileId={profile?.id} 
                    key={event.id} 
                    event={event} 
                    onClick={() => event.type === 'meal' ? setSelectedMealEvent(event as MealEventData) : setSelectedMedEvent(event as MedicationEventData)} 
                  />
                ))}
              </div>
            </div>
          )}
          
{/* Closure Area */}
        <div className="px-6 pb-6">
          {dailyClosure ? (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex flex-col items-center text-center">
              <div className="w-10 h-10 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-2">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900">Dia encerrado</h3>
              <p className="text-sm text-gray-500 mt-1">
                Encerrado por {dailyClosure.closed_by_profile?.name || 'Familiar'} às {formatDateToTime(dailyClosure.closed_at)}
              </p>
              
              <button
                onClick={handleReopenDay}
                disabled={reopeningDay}
                className="mt-6 inline-flex items-center justify-center text-sm font-medium text-gray-500 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 px-5 py-2.5 rounded-2xl transition-all active:scale-95 border border-gray-200 disabled:opacity-50 w-full sm:w-auto"
              >
                {reopeningDay ? (
                  <Spinner className="w-4 h-4 mr-2" />
                ) : (
                  <Unlock className="w-4 h-4 mr-2" />
                )}
                {reopeningDay ? 'Reabrindo...' : 'Desfazer e reabrir dia'}
              </button>
            </div>
          ) : null}
        </div>

        
          {events.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-500">Nenhum evento configurado para hoje.</p>
            </div>
          )}
        </div>
      </div>


      {showClosureModal && patient && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Encerrar o dia?</h3>
            <p className="text-sm text-gray-500 mb-6">
              Você está encerrando a rotina de {patient.name} de hoje. Depois disso, o dia aparecerá como concluído no Histórico.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowClosureModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCloseDay}
                disabled={closingDay}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50 transition-colors"
              >
                {closingDay ? 'Encerrando...' : 'Encerrar dia'}
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
          onSuccess={handleMedRefresh}
        />
      )}

      {/* Sticky Bottom Footer for Closing the Day */}
      {!dailyClosure && (hasReopened || isAllEventsCompleted) && (
        <div className="fixed bottom-[80px] left-0 right-0 z-40 px-4 sm:max-w-md mx-auto w-full pb-4 animate-in slide-in-from-bottom-6 fade-in duration-300">
          <div className="bg-white/80 backdrop-blur-md border border-gray-200 p-3 rounded-2xl shadow-lg flex items-center justify-between">
            <div className="pl-2 pr-4">
              <p className="text-sm font-bold text-gray-900">Encerrar Dia</p>
              <p className="text-[11px] font-medium text-gray-500">Confirme para salvar.</p>
            </div>
            <button
              onClick={() => setShowClosureModal(true)}
              className="bg-black hover:bg-gray-900 active:bg-gray-800 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-all shadow-md active:scale-95"
            >
              Encerrar
            </button>
          </div>
        </div>
      )}

    </MainLayout>
  );
}
