import React, { useState, useEffect } from 'react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { updateMealConfig, updateMedicationPeriod, createMealConfig, createMedicationPeriod } from '../../services/api';

interface TimeEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  entity: any | null; // null for creation
  patientId?: string; // required for creation
  type: 'meal' | 'period';
  onSuccess: () => void;
}

export function TimeEditModal({ isOpen, onClose, entity, patientId, type, onSuccess }: TimeEditModalProps) {
  const [name, setName] = useState('');
  const [time, setTime] = useState('');
  const [active, setActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (entity) {
        setName(entity.name || '');
        setTime(entity.scheduled_time.slice(0, 5));
        setActive(entity.active);
      } else {
        setName('');
        setTime('08:00');
        setActive(true);
      }
      setError('');
    }
  }, [isOpen, entity]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('O nome é obrigatório.');
      return;
    }
    if (!time) {
      setError('O horário é obrigatório.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const scheduled_time = `${time}:00`;

      if (entity) {
        if (type === 'meal') {
          await updateMealConfig(entity.id, { name: name.trim(), scheduled_time, active });
        } else {
          await updateMedicationPeriod(entity.id, { name: name.trim(), scheduled_time, active });
        }
      } else {
        if (!patientId) throw new Error("Patient ID missing for creation");
        if (type === 'meal') {
          await createMealConfig({ patient_id: patientId, name: name.trim(), type: 'custom', scheduled_time, active, display_order: 99 });
        } else {
          await createMedicationPeriod({ patient_id: patientId, name: name.trim(), scheduled_time, active, display_order: 99 });
        }
      }

      onSuccess();
    } catch (err) {
      console.error(err);
      setError('Não foi possível salvar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={entity ? "Editar Horário" : "Novo Horário"}>
      <div className="space-y-6">
        {error && <div className="p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>}

        <div className="space-y-3">
          <label className="text-sm font-semibold text-gray-900">Nome</label>
          <input 
            type="text" 
            placeholder={type === 'meal' ? "Ex: Almoço" : "Ex: Manhã"}
            className="flex h-12 w-full rounded-xl border border-gray-200 bg-white px-4 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-3">
          <label className="text-sm font-semibold text-gray-900">Horário</label>
          <input 
            type="time" 
            className="flex h-12 w-full rounded-xl border border-gray-200 bg-white px-4 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between p-4 rounded-xl border border-gray-100 bg-gray-50">
          <div>
            <h4 className="font-medium text-gray-900">Status</h4>
            <p className="text-sm text-gray-500">{active ? 'Ativo' : 'Inativo'}</p>
          </div>
          <button 
            onClick={() => setActive(!active)}
            className={`w-12 h-6 rounded-full transition-colors relative ${active ? 'bg-green-500' : 'bg-gray-300'}`}
          >
            <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${active ? 'translate-x-6' : 'translate-x-0'}`} />
          </button>
        </div>

        <div className="pt-4">
          <Button className="w-full" size="lg" onClick={handleSave} disabled={loading || !time}>
            {loading ? <Spinner className="text-white" /> : 'Salvar Alterações'}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
