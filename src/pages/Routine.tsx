import { formatTime } from '../utils/date';
import React, { useEffect, useState } from 'react';
import { Plus, Edit2, Camera } from 'lucide-react';
import { MainLayout } from '../layouts/MainLayout';
import { 
  getCurrentProfile, 
  getPatient, 
  getPatientPhotoUrl,
  getMealConfigs, 
  getMedicationPeriods, 
  getMedications 
} from '../services/api';
import { Spinner } from '../components/ui/Spinner';
import { UserProfile } from '../components/ui/UserProfile';
import { PatientEditModal } from '../components/routine/PatientEditModal';
import { TimeEditModal } from '../components/routine/TimeEditModal';
import { MedicationFormModal } from '../components/routine/MedicationFormModal';

interface RoutineScreenProps {
  onTabChange?: (tab: 'today' | 'history' | 'routine') => void;
}

export function RoutineScreen({ onTabChange }: RoutineScreenProps) {
  const [loading, setLoading] = useState(true);
  const [patient, setPatient] = useState<any>(null);
  const [patientPhoto, setPatientPhoto] = useState<string | null>(null);
  const [meals, setMeals] = useState<any[]>([]);
  const [periods, setPeriods] = useState<any[]>([]);
  const [medications, setMedications] = useState<any[]>([]);

  // Modals state
  const [isPatientModalOpen, setIsPatientModalOpen] = useState(false);
  
  const [editingTimeEntity, setEditingTimeEntity] = useState<any | undefined>(undefined);
  const [editingTimeType, setEditingTimeType] = useState<'meal' | 'period' | undefined>(undefined);
  
  const [editingMedication, setEditingMedication] = useState<any | null>(null);
  const [defaultPeriodForMed, setDefaultPeriodForMed] = useState<string>('');
  const [isMedicationModalOpen, setIsMedicationModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const prof = await getCurrentProfile();
      if (!prof) return;

      const pat = await getPatient(prof.family_id);
      if (!pat) return;
      setPatient(pat);

      if (pat.photo_url) {
        const url = await getPatientPhotoUrl(pat.id, pat.photo_url);
        setPatientPhoto(url);
      } else {
        setPatientPhoto(null);
      }

      const [loadedMeals, loadedPeriods, loadedMeds] = await Promise.all([
        getMealConfigs(pat.id),
        getMedicationPeriods(pat.id),
        getMedications(pat.id)
      ]);

      setMeals(loadedMeals.sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time)));
      setPeriods(loadedPeriods.sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time)));
      setMedications(loadedMeds);

    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
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

  if (loading && !patient) {
    return (
      <MainLayout activeTab="routine" onTabChange={onTabChange}>
        <div className="flex h-[80vh] items-center justify-center">
          <Spinner />
        </div>
      </MainLayout>
    );
  }

  const translateWeekday = (day: string) => {
    const map: Record<string, string> = {
      Monday: 'Segunda-feira', Tuesday: 'Terça-feira', Wednesday: 'Quarta-feira',
      Thursday: 'Quinta-feira', Friday: 'Sexta-feira', Saturday: 'Sábado', Sunday: 'Domingo'
    };
    return map[day] || day;
  };

  return (
    <MainLayout activeTab="routine" onTabChange={onTabChange}>
      {toastMessage && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white px-6 py-3 rounded-full shadow-lg text-sm font-medium animate-in slide-in-from-top-4 fade-in">
          {toastMessage}
        </div>
      )}
      <div className="max-w-md mx-auto w-full px-6 py-12 space-y-12">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Rotina</h1>
          <UserProfile />
        </div>
        <div>
          
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 flex flex-col items-center text-center">
            <div className="relative mb-4">
              <div className="w-24 h-24 rounded-full bg-gray-100 border border-gray-200 overflow-hidden flex items-center justify-center">
                {patientPhoto ? (
                  <img src={patientPhoto} alt={patient?.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-4xl">👵</span>
                )}
              </div>
              <button 
                onClick={() => setIsPatientModalOpen(true)}
                className="absolute bottom-0 right-0 w-8 h-8 bg-gray-900 rounded-full text-white flex items-center justify-center shadow-sm border-2 border-white"
              >
                <Camera className="w-4 h-4" />
              </button>
            </div>
            <h2 className="text-xl font-bold text-gray-900">{patient?.name}</h2>
            <button onClick={() => setIsPatientModalOpen(true)} className="text-sm font-medium text-gray-500 mt-2 hover:text-gray-900">
              Editar perfil
            </button>
          </div>
        </div>

        {/* Meals Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between ml-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Refeições</h3>
            <button 
              onClick={() => {
                setEditingTimeType('meal');
                setEditingTimeEntity(null);
              }}
              className="text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors flex items-center"
            >
              <Plus className="w-3 h-3 mr-1" /> Adicionar
            </button>
          </div>
          <div className="space-y-3">
            {meals.map(meal => (
              <button 
                key={meal.id}
                onClick={() => {
                  setEditingTimeType('meal');
                  setEditingTimeEntity(meal);
                }}
                className={`w-full flex items-center justify-between p-4 rounded-2xl border bg-white shadow-sm transition-all active:scale-[0.98] ${!meal.active ? 'opacity-60 border-gray-100' : 'border-gray-200'}`}
              >
                <div className="text-left">
                  <h4 className={`font-semibold ${!meal.active ? 'text-gray-500 line-through' : 'text-gray-900'}`}>{meal.name}</h4>
                  <p className="text-sm text-gray-500">{formatTime(meal.scheduled_time)}</p>
                </div>
                <Edit2 className="w-4 h-4 text-gray-300" />
              </button>
            ))}
          </div>
        </section>

        {/* Medication Periods Section */}
        <section className="space-y-8">
          <div className="flex items-center justify-between ml-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Medicamentos</h3>
            <button 
              onClick={() => {
                setEditingTimeType('period');
                setEditingTimeEntity(null);
              }}
              className="text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors flex items-center"
            >
              <Plus className="w-3 h-3 mr-1" /> Adicionar Período
            </button>
          </div>
          
          <div className="space-y-6">
            {periods.map(period => {
              const periodMeds = medications.filter(m => m.medication_period_id === period.id);
              
              return (
                <div key={period.id} className="bg-white rounded-3xl p-5 border border-gray-100 shadow-sm">
                  <div className="flex items-center justify-between mb-4 border-b border-gray-50 pb-4">
                    <div className="text-left">
                      <h4 className={`font-bold ${!period.active ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{period.name}</h4>
                      <p className="text-sm text-gray-500">{formatTime(period.scheduled_time)}</p>
                    </div>
                    <button 
                      onClick={() => {
                        setEditingTimeType('period');
                        setEditingTimeEntity(period);
                      }}
                      className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      Editar horário
                    </button>
                  </div>

                  <div className="space-y-2 mb-4">
                    {periodMeds.map(med => (
                      <button
                        key={med.id}
                        onClick={() => {
                          setEditingMedication(med);
                          setIsMedicationModalOpen(true);
                        }}
                        className={`w-full flex items-center justify-between p-3 rounded-xl border transition-colors text-left ${!med.active ? 'bg-gray-50 border-gray-100' : 'bg-white border-gray-100 hover:border-gray-200'}`}
                      >
                        <div>
                          <p className={`font-medium ${!med.active ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{med.name}</p>
                          <p className="text-xs text-gray-500">
                            {med.dosage} • {med.frequency === 'daily' ? 'Diário' : `Semanal (${translateWeekday(med.weekday || '')})`}
                          </p>
                        </div>
                        <Edit2 className="w-4 h-4 text-gray-300" />
                      </button>
                    ))}
                    {periodMeds.length === 0 && (
                      <p className="text-sm text-gray-400 text-center py-2">Nenhum medicamento configurado.</p>
                    )}
                  </div>

                  <button 
                    onClick={() => {
                      setDefaultPeriodForMed(period.id);
                      setEditingMedication(null);
                      setIsMedicationModalOpen(true);
                    }}
                    className="w-full flex items-center justify-center p-3 text-sm font-medium text-gray-600 border border-dashed border-gray-300 rounded-xl hover:bg-gray-50 hover:border-gray-400 transition-all active:scale-[0.98]"
                  >
                    <Plus className="w-4 h-4 mr-2" /> Adicionar medicamento
                  </button>
                </div>
              );
            })}
          </div>
        </section>

      </div>

      {/* Modals */}
      <PatientEditModal 
        isOpen={isPatientModalOpen} 
        onClose={() => setIsPatientModalOpen(false)} 
        patient={patient} 
        currentPhotoUrl={patientPhoto}
        onSuccess={handlePatientSuccess} 
      />

      <TimeEditModal 
        isOpen={editingTimeType !== undefined}
        onClose={() => {
          setEditingTimeEntity(undefined);
          setEditingTimeType(undefined);
        }}
        entity={editingTimeEntity}
        patientId={patient?.id}
        type={editingTimeType as 'meal' | 'period'}
        onSuccess={handleTimeSuccess}
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

    </MainLayout>
  );
}
