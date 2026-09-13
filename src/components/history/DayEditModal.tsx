import { useState, useEffect } from 'react';
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
} from '../../services/api';
import { getWeekdayName } from '../../utils/date';
import { Spinner } from '../ui/Spinner';
import type { TimelineEvent, MealEventData, MedicationEventData } from '../../types/timeline';

interface DayEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  dateStr: string; // '2026-08-24'
  friendlyDate: string; // 'Segunda-feira, 24 de agosto'
  patientId: string;
  profileId: string;
  onSuccess: () => void; // Triggered when a child edit succeeds
}

export function DayEditModal({ 
  isOpen, 
  onClose, 
  dateStr, 
  friendlyDate,
  patientId, 
  profileId,
  onSuccess
}: DayEditModalProps) {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<TimelineEvent[]>([]);

  // Modals state
  const [selectedMealEvent, setSelectedMealEvent] = useState<MealEventData | null>(null);
  const [selectedMedEvent, setSelectedMedEvent] = useState<MedicationEventData | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadTimeline();
    }
  }, [isOpen, dateStr]);

  async function loadTimeline() {
    setLoading(true);
    try {
      const [meals, medPeriods, allMeds, mealLogs, medLogs] = await Promise.all([
        getMealConfigs(patientId),
        getMedicationPeriods(patientId),
        getMedications(patientId),
        getMealLogs(patientId, dateStr),
        getMedicationLogs(patientId, dateStr)
      ]);

      const currentWeekday = getWeekdayName(dateStr);
      const timeline: TimelineEvent[] = [];

      // 1. Process Meals
      for (const meal of meals) {
        const log = mealLogs.find(l => l.meal_config_id === meal.id);
        let status: 'waiting' | 'pending' | 'confirmed' = 'waiting';
        
        let photoSignedUrl = null;

        if (log) {
          status = 'confirmed';
        } else {
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
        const periodMeds = allMeds.filter(m => {
          if (m.medication_period_id !== period.id) return false;
          if (m.frequency === 'daily') return true;
          if (m.frequency === 'weekly') return m.weekday === currentWeekday;
          return false;
        });

        if (periodMeds.length === 0) continue; 

        const periodLogs = medLogs.filter(l => periodMeds.some(m => m.id === l.medication_id));
        
        let status: 'waiting' | 'pending' | 'confirmed' | 'attention' = 'waiting';
        
        if (periodLogs.length === periodMeds.length) {
          const anyNotAdministered = periodLogs.some(l => l.status === 'not_administered');
          status = anyNotAdministered ? 'attention' : 'confirmed';
        } else if (periodLogs.length > 0) {
          status = 'attention'; 
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
          logs: periodLogs
        });
      }

      timeline.sort((a, b) => a.time.localeCompare(b.time));
      setEvents(timeline);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm sm:items-center sm:justify-center p-0 sm:p-4 animate-in fade-in duration-200">
        <div className="bg-gray-50 w-full sm:max-w-md h-[90vh] sm:h-auto sm:max-h-[85vh] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-300">
          
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-100">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">
                Editando o dia
              </p>
              <h2 className="text-lg font-bold text-gray-900">{friendlyDate}</h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 -mr-2 text-gray-400 hover:text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Spinner className="w-8 h-8 text-indigo-600" />
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-500 mb-6">
                  Toque em um registro abaixo para editá-lo ou adicionar os dados deste dia.
                </p>
                <div className="relative border-l-2 border-gray-100 pl-4 space-y-6 pb-6">
                  {events.map((event, index) => (
                    <TimelineItem
                      profileId={profileId}
                      key={event.id + index}
                      event={event}
                      onClick={() => {
                        if (event.type === 'meal') setSelectedMealEvent(event as MealEventData);
                        else setSelectedMedEvent(event as MedicationEventData);
                      }}
                    />
                  ))}
                  
                  {events.length === 0 && (
                    <div className="text-center py-12">
                      <p className="text-gray-500">Nenhum evento configurado.</p>
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
          onSuccess={() => {
            loadTimeline();
            onSuccess();
            setSelectedMedEvent(null);
          }}
        />
      )}
    </>
  );
}
