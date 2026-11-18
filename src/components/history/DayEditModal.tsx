import { useState, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { TimelineItem } from '../timeline/TimelineItem';
import { MealModal } from '../meals/MealModal';
import { MedicationModal } from '../medications/MedicationModal';
import {
  getMealConfigs,
  getMedicationPeriods,
  getMedications,
  getMealLogs,
  getMedicationLogs,
  getDailyClosure,
  getMealPhotoUrl,
  mapWithConcurrency,
} from '../../services/api';
import { isMedicationScheduledForDate } from '../../utils/medicationSchedule';
import { Spinner } from '../ui/Spinner';
import type { TimelineEvent, MealEventData, MedicationEventData } from '../../types/timeline';

interface DayEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  dateStr: string;
  friendlyDate: string;
  patientId: string;
  profileId: string;
  patientGender?: string | null;
  canEdit?: boolean;
  onSuccess: () => void;
}

export function DayEditModal({
  isOpen,
  onClose,
  dateStr,
  friendlyDate,
  patientId,
  profileId,
  patientGender,
  canEdit = true,
  onSuccess,
}: DayEditModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [isDayClosed, setIsDayClosed] = useState(false);

  const [selectedMealEvent, setSelectedMealEvent] = useState<MealEventData | null>(null);
  const [selectedMedEvent, setSelectedMedEvent] = useState<MedicationEventData | null>(null);

  const reqSeqRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadTimeline = useCallback(async () => {
    const seq = ++reqSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const [meals, medPeriods, allMeds, mealLogs, medLogs, closure] = await Promise.all([
        getMealConfigs(patientId),
        getMedicationPeriods(patientId),
        getMedications(patientId),
        getMealLogs(patientId, dateStr),
        getMedicationLogs(patientId, dateStr),
        getDailyClosure(patientId, dateStr),
      ]);

      if (!isMountedRef.current || seq !== reqSeqRef.current) return;
      setIsDayClosed(Boolean(closure));

      const resolvedMeals: MealEventData[] = await mapWithConcurrency(meals, 5, async (meal) => {
        const log = mealLogs.find((l) => l.meal_config_id === meal.id);
        const photoSignedUrl = log?.photo_url ? await getMealPhotoUrl(log.photo_url) : null;
        return {
          id: meal.id,
          type: 'meal',
          time: meal.scheduled_time,
          title: meal.name,
          status: log ? 'confirmed' : 'pending',
          mealConfig: meal,
          log,
          photoSignedUrl,
        };
      });

      if (!isMountedRef.current || seq !== reqSeqRef.current) return;

      const timeline: TimelineEvent[] = [...resolvedMeals];
      const loggedMedIdsOnDate = new Set(medLogs.map((l) => l.medication_id));

      for (const period of medPeriods) {
        const periodMeds = allMeds.filter((m) => {
          if (m.medication_period_id !== period.id) return false;
          return isMedicationScheduledForDate(m, dateStr) || loggedMedIdsOnDate.has(m.id);
        });

        if (periodMeds.length === 0) continue;

        const periodLogs = medLogs.filter((l) =>
          periodMeds.some((m) => m.id === l.medication_id)
        );

        let status: 'waiting' | 'pending' | 'confirmed' | 'attention' = 'waiting';
        const anyNotAdministered = periodLogs.some((l) => l.status === 'not_administered');

        if (periodLogs.length === periodMeds.length) {
          status = anyNotAdministered ? 'attention' : 'confirmed';
        } else if (periodLogs.length > 0) {
          status = anyNotAdministered ? 'attention' : 'pending';
        } else {
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
          logs: periodLogs,
        });
      }

      timeline.sort((a, b) => a.time.localeCompare(b.time));
      setEvents(timeline);
    } catch (err: any) {
      if (!isMountedRef.current || seq !== reqSeqRef.current) return;
      console.error(err);
      setError(err?.message || 'Não foi possível carregar os registros deste dia.');
    } finally {
      if (isMountedRef.current && seq === reqSeqRef.current) {
        setLoading(false);
      }
    }
  }, [patientId, dateStr]);

  useEffect(() => {
    if (isOpen) {
      loadTimeline();
    }
  }, [isOpen, loadTimeline]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 dark:bg-black/75 backdrop-blur-sm sm:items-center sm:justify-center p-0 sm:p-4 animate-in fade-in duration-200">
        <div className="bg-gray-50 dark:bg-[#09090b] w-full sm:max-w-md h-[90dvh] sm:h-auto sm:max-h-[85dvh] rounded-t-3xl sm:rounded-3xl shadow-2xl border border-transparent dark:border-white/[0.08] flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-300">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 bg-white dark:bg-[#121216] border-b border-gray-100 dark:border-white/[0.08]">
            <div>
              <p className="text-xs font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-0.5">
                Editando o dia
              </p>
              <h2 className="text-lg font-bold text-gray-900 dark:text-zinc-100">{friendlyDate}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 -mr-2 text-gray-400 dark:text-zinc-400 hover:text-gray-600 dark:hover:text-zinc-200 bg-gray-50 dark:bg-[#1c1c22] hover:bg-gray-100 dark:hover:bg-white/[0.08] rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 overscroll-contain">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Spinner className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
              </div>
            ) : error ? (
              <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 text-sm text-rose-700 dark:text-rose-300 text-center space-y-3">
                <p>{error}</p>
                <button
                  type="button"
                  onClick={loadTimeline}
                  className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold"
                >
                  Tentar novamente
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-500 dark:text-zinc-400 mb-6">
                  Toque em um registro abaixo para editá-lo ou adicionar os dados deste dia.
                </p>
                <div className="relative border-l-2 border-gray-100 dark:border-white/[0.08] pl-4 space-y-6 pb-6">
                  {events.map((event) => (
                    <TimelineItem
                      profileId={profileId}
                      key={event.id}
                      event={event}
                      onClick={() => {
                        if (event.type === 'meal') setSelectedMealEvent(event as MealEventData);
                        else setSelectedMedEvent(event as MedicationEventData);
                      }}
                    />
                  ))}

                  {events.length === 0 && (
                    <div className="text-center py-12">
                      <p className="text-gray-500 dark:text-zinc-400">Nenhum evento configurado.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sub-modals */}
      {selectedMealEvent && (
        <MealModal
          isOpen={!!selectedMealEvent}
          onClose={() => setSelectedMealEvent(null)}
          event={selectedMealEvent}
          patientId={patientId}
          profileId={profileId}
          eventDate={dateStr}
          patientGender={patientGender}
          isDayClosed={isDayClosed}
          canEdit={canEdit}
          onSuccess={() => {
            loadTimeline();
            onSuccess();
            setSelectedMealEvent(null);
          }}
        />
      )}

      {selectedMedEvent && (
        <MedicationModal
          isOpen={!!selectedMedEvent}
          onClose={() => setSelectedMedEvent(null)}
          event={selectedMedEvent}
          patientId={patientId}
          profileId={profileId}
          eventDate={dateStr}
          isDayClosed={isDayClosed}
          canEdit={canEdit}
          onSuccess={() => {
            loadTimeline();
            onSuccess();
            setSelectedMedEvent(null);
          }}
          onPartialSuccess={() => {
            loadTimeline();
            onSuccess();
          }}
        />
      )}
    </>
  );
}
