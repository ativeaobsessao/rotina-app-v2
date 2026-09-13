import React, { useState, useEffect } from 'react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { formatTime } from '../../utils/date';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';
import { createMedication, updateMedication } from '../../services/api';

interface MedicationFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  medication: any | null; // if editing
  periods: any[];
  defaultPeriodId?: string;
  onSuccess: () => void;
}

export function MedicationFormModal({ isOpen, onClose, patientId, medication, periods, defaultPeriodId, onSuccess }: MedicationFormModalProps) {
  const [name, setName] = useState('');
  const [dosage, setDosage] = useState('');
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily');
  const [weekday, setWeekday] = useState('Monday');
  const [periodId, setPeriodId] = useState('');
  const [active, setActive] = useState(true);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (medication) {
        setName(medication.name);
        setDosage(medication.dosage);
        setFrequency(medication.frequency);
        setWeekday(medication.weekday || 'Monday');
        setPeriodId(medication.medication_period_id);
        setActive(medication.active);
      } else {
        setName('');
        setDosage('');
        setFrequency('daily');
        setWeekday('Monday');
        setPeriodId(defaultPeriodId || (periods[0]?.id || ''));
        setActive(true);
      }
      setError('');
    }
  }, [isOpen, medication, defaultPeriodId, periods]);

  const handleSave = async () => {
    if (!name.trim()) return setError('Nome do medicamento é obrigatório.');
    if (!dosage.trim()) return setError('Dose é obrigatória.');
    if (!periodId) return setError('Período é obrigatório.');

    setLoading(true);
    setError('');

    const medData: any = {
      patient_id: patientId,
      medication_period_id: periodId,
      name: name.trim(),
      dosage: dosage.trim(),
      frequency,
      weekday: frequency === 'weekly' ? weekday : null,
      active,
    };

    try {
      if (medication) {
        await updateMedication(medication.id, medData);
      } else {
        await createMedication(medData);
      }
      onSuccess();
    } catch (err) {
      console.error(err);
      setError('Erro ao salvar o medicamento.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={medication ? 'Editar Medicamento' : 'Novo Medicamento'}>
      <div className="space-y-6">
        {error && <div className="p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>}

        <div className="space-y-3">
          <label className="text-sm font-semibold text-gray-900">Nome</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Losartana" />
        </div>

        <div className="space-y-3">
          <label className="text-sm font-semibold text-gray-900">Dose / Instrução</label>
          <Input value={dosage} onChange={(e) => setDosage(e.target.value)} placeholder="Ex: 1 comprimido 50mg" />
        </div>

        <div className="space-y-3">
          <label className="text-sm font-semibold text-gray-900">Período</label>
          <select 
            className="flex h-12 w-full rounded-xl border border-gray-200 bg-white px-4 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
          >
            {periods.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({formatTime(p.scheduled_time)})</option>
            ))}
          </select>
        </div>

        <div className="space-y-3">
          <label className="text-sm font-semibold text-gray-900">Frequência</label>
          <select 
            className="flex h-12 w-full rounded-xl border border-gray-200 bg-white px-4 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as 'daily' | 'weekly')}
          >
            <option value="daily">Diário</option>
            <option value="weekly">Semanal</option>
          </select>
        </div>

        {frequency === 'weekly' && (
          <div className="space-y-3">
            <label className="text-sm font-semibold text-gray-900">Dia da semana</label>
            <select 
              className="flex h-12 w-full rounded-xl border border-gray-200 bg-white px-4 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
              value={weekday}
              onChange={(e) => setWeekday(e.target.value)}
            >
              <option value="Monday">Segunda-feira</option>
              <option value="Tuesday">Terça-feira</option>
              <option value="Wednesday">Quarta-feira</option>
              <option value="Thursday">Quinta-feira</option>
              <option value="Friday">Sexta-feira</option>
              <option value="Saturday">Sábado</option>
              <option value="Sunday">Domingo</option>
            </select>
          </div>
        )}

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
          <Button className="w-full" size="lg" onClick={handleSave} disabled={loading || !name.trim() || !dosage.trim()}>
            {loading ? <Spinner className="text-white" /> : 'Salvar Medicamento'}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
