import React, { useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { cn } from '../../utils/cn';
import { createMedicationLog, updateMedicationLog } from '../../services/api';
import type { MedicationEventData } from '../../types/timeline';

interface MedicationModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: MedicationEventData;
  patientId: string;
  profileId: string;
  eventDate: string;
  onSuccess: () => void;
}

export function MedicationModal({ isOpen, onClose, event, patientId, profileId, eventDate, onSuccess }: MedicationModalProps) {
  // Local state for checkboxes
  const [mode, setMode] = useState<'view' | 'edit'>(event.logs.length > 0 ? 'view' : 'edit');
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    event.logs.forEach(log => {
      if (log.status === 'administered') {
        initial.add(log.medication_id);
      }
    });
    return initial;
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // State for the "Not Administered" sub-flow
  const [notAdministeredMedId, setNotAdministeredMedId] = useState<string | null>(null);
  const [notAdminReason, setNotAdminReason] = useState('Recusou');
  const [notAdminNotes, setNotAdminNotes] = useState('');

  const handleToggleCheck = (medId: string) => {
    const next = new Set(checkedIds);
    if (next.has(medId)) {
      next.delete(medId);
    } else {
      next.add(medId);
    }
    setCheckedIds(next);
  };

  const handleConfirmAll = async () => {
    // If not all are checked, show a warning
    if (checkedIds.size < event.medications.length) {
      if (!window.confirm("Ainda existem medicamentos não confirmados. Deseja continuar?")) {
        return;
      }
    }

    setLoading(true);
    setError('');

    try {
      // For each checked medication, ensure there's an 'administered' log
      for (const medId of checkedIds) {
        const existingLog = event.logs.find(l => l.medication_id === medId);
        if (existingLog) {
          if (existingLog.status !== 'administered') {
            await updateMedicationLog(existingLog.id, {
              status: 'administered',
              reason: null,
              notes: null,
              updated_by: profileId,
              administered_at: new Date().toISOString()
            });
          }
        } else {
          await createMedicationLog({
            medication_id: medId,
            patient_id: patientId,
            event_date: eventDate,
            status: 'administered',
            created_by: profileId,
            updated_by: profileId,
            administered_at: new Date().toISOString()
          });
        }
      }

      onSuccess();
    } catch (err) {
      console.error(err);
      setError("Não foi possível salvar. Verifique sua conexão.");
      setLoading(false);
    }
  };

  const handleSaveNotAdministered = async () => {
    if (!notAdministeredMedId) return;
    setLoading(true);
    setError('');

    try {
      const existingLog = event.logs.find(l => l.medication_id === notAdministeredMedId);
      
      const logData = {
        status: 'not_administered' as const,
        reason: notAdminReason,
        notes: notAdminNotes || null,
        updated_by: profileId,
      };

      if (existingLog) {
        await updateMedicationLog(existingLog.id, logData);
      } else {
        await createMedicationLog({
          medication_id: notAdministeredMedId,
          patient_id: patientId,
          event_date: eventDate,
          ...logData,
          created_by: profileId,
        });
      }
      
      onSuccess();
    } catch (err) {
      console.error(err);
      setError("Não foi possível salvar. Verifique sua conexão.");
      setLoading(false);
    }
  };

  if (notAdministeredMedId) {
    const med = event.medications.find(m => m.id === notAdministeredMedId);
    return (
      <BottomSheet isOpen={isOpen} onClose={() => setNotAdministeredMedId(null)} title="Não administrado">
        <div className="space-y-6">
          {error && <div className="p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>}
          
          <div>
            <p className="text-gray-900 font-medium mb-1">{med?.name}</p>
            <p className="text-gray-500 text-sm">{med?.dosage}</p>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-semibold text-gray-900">Motivo</label>
            <select 
              className="flex h-12 w-full rounded-xl border border-gray-200 bg-white px-4 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
              value={notAdminReason}
              onChange={(e) => setNotAdminReason(e.target.value)}
            >
              <option value="Recusou">Recusou</option>
              <option value="Medicamento indisponível">Medicamento indisponível</option>
              <option value="Esquecimento">Esquecimento</option>
              <option value="Outro">Outro</option>
            </select>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-semibold text-gray-900">Observação <span className="text-gray-400 font-normal">(Opcional)</span></label>
            <input 
              className="flex h-12 w-full rounded-xl border border-gray-200 bg-white px-4 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
              placeholder="Detalhes..." 
              value={notAdminNotes}
              onChange={(e) => setNotAdminNotes(e.target.value)}
            />
          </div>

          <div className="pt-4 flex space-x-3">
            <Button variant="outline" className="flex-1" onClick={() => setNotAdministeredMedId(null)}>Voltar</Button>
            <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white" onClick={handleSaveNotAdministered} disabled={loading}>
              {loading ? <Spinner className="text-white" /> : 'Confirmar'}
            </Button>
          </div>
        </div>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={`Medicamentos - ${event.title}`}>
      <div className="space-y-6">

        {mode === 'view' && event.logs.length > 0 ? (
          <div className="space-y-6">
            <div className="space-y-3">
              {event.medications.map(med => {
                const log = event.logs.find(l => l.medication_id === med.id);
                if (!log) return null;
                const isNotAdministered = log.status === 'not_administered';
                return (
                  <div key={med.id} className="bg-gray-50 rounded-2xl p-4 flex flex-col gap-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className={cn("font-medium", isNotAdministered ? "text-gray-500 line-through" : "text-gray-900")}>{med.name}</h4>
                        <p className="text-sm text-gray-500">{med.dosage}</p>
                      </div>
                      <span className={cn(
                        "text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full",
                        isNotAdministered ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                      )}>
                        {isNotAdministered ? 'Não Admin' : 'Confirmado'}
                      </span>
                    </div>
                    {isNotAdministered && log.reason && (
                      <div className="text-sm text-red-700">
                        <span className="font-semibold">Motivo:</span> {log.reason}
                        {log.notes && <span className="block text-xs mt-0.5">{log.notes}</span>}
                      </div>
                    )}
                    
                    <div className="border-t border-gray-200/50 pt-3 mt-1 flex flex-col gap-2">
                      <div className="flex flex-col text-xs text-gray-500">
                        <span className="font-medium text-gray-700 flex items-center gap-1"><span className="opacity-70">👤</span> Registrado por {log.creator?.name || 'Familiar'}</span>
                        <span className="pl-5 text-[11px] text-gray-400">Registrado às {new Date(log.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      
                      {log.updated_by !== log.created_by && (
                        <div className="flex flex-col text-xs text-gray-500">
                          <span className="font-medium text-gray-700 flex items-center gap-1"><span className="opacity-70">👤</span> Alterado por {log.updater?.name || 'Familiar'}</span>
                          <span className="pl-5 text-[11px] text-gray-400">Alterado às {new Date(log.updated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            
            <div className="pt-2">
              <Button onClick={() => setMode('edit')} className="w-full font-medium" variant="outline">
                EDITAR REGISTRO
              </Button>
            </div>
          </div>
        ) : (
          <>

        {error && <div className="p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>}

        <div className="space-y-3">
          {event.medications.map(med => {
            const isChecked = checkedIds.has(med.id);
            const log = event.logs.find(l => l.medication_id === med.id);
            const isNotAdministered = log?.status === 'not_administered';
            
            return (
              <div key={med.id} className="flex items-center justify-between p-4 rounded-xl border border-gray-100 bg-white shadow-sm">
                
                {/* Left side: Checkbox and Info */}
                <button 
                  onClick={() => {
                    if (isNotAdministered) return; // Prevent checking if explicitly not administered
                    handleToggleCheck(med.id);
                  }}
                  className="flex items-start space-x-4 flex-1 text-left"
                >
                  <div className={cn(
                    "w-6 h-6 rounded-md border-2 mt-0.5 flex items-center justify-center shrink-0 transition-colors",
                    isChecked ? "bg-green-500 border-green-500" : (isNotAdministered ? "bg-red-100 border-red-300" : "bg-white border-gray-300")
                  )}>
                    {isChecked && <Check className="w-4 h-4 text-white" />}
                    {isNotAdministered && <AlertTriangle className="w-4 h-4 text-red-500" />}
                  </div>
                  <div>
                    <h4 className={cn("font-medium text-gray-900", isNotAdministered && "line-through text-gray-500")}>{med.name}</h4>
                    <p className="text-sm text-gray-500">{med.dosage}</p>
                    {isNotAdministered && log.reason && (
                      <p className="text-xs text-red-600 mt-1 font-medium">Não administrado: {log.reason}</p>
                    )}
                  </div>
                </button>

                {/* Right side: Actions */}
                {!isChecked && !isNotAdministered && (
                  <button 
                    onClick={() => setNotAdministeredMedId(med.id)}
                    className="ml-4 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                  >
                    Não tomou
                  </button>
                )}
                
                {isNotAdministered && (
                  <button 
                    onClick={() => {
                      // Allow removing the "not_administered" status by simply setting it back
                      // For MVP, we can just open the reason modal again to change it, or allow clearing.
                      // Let's just open the modal to edit.
                      setNotAdministeredMedId(med.id);
                      setNotAdminReason(log.reason || 'Recusou');
                      setNotAdminNotes(log.notes || '');
                    }}
                    className="ml-4 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Editar
                  </button>
                )}

              </div>
            );
          })}
        </div>

        <div className="pt-4">
          <Button 
            className="w-full" 
            size="lg" 
            onClick={handleConfirmAll}
            disabled={loading}
          >
            {loading ? <Spinner className="text-white" /> : 'Confirmar Medicamentos'}
          </Button>
        </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
