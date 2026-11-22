import React, { useState, useEffect, useRef } from 'react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { updateMealConfig, updateMedicationPeriod, createMealConfig, createMedicationPeriod } from '../../services/api';
import { formatTime } from '../../utils/date';
import { dismissMobileKeyboard, handleEnterKeySubmit } from '../../utils/keyboardSubmit';

interface TimeEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  entity: any | null; // null for creation
  patientId?: string; // required for creation
  type: 'meal' | 'period';
  isAdmin?: boolean;
  onSuccess: () => void;
}

export function TimeEditModal({
  isOpen,
  onClose,
  entity,
  patientId,
  type,
  isAdmin = true,
  onSuccess,
}: TimeEditModalProps) {
  const [name, setName] = useState('');
  const [time, setTime] = useState('');
  const [active, setActive] = useState(true);
  const [defaultDescription, setDefaultDescription] = useState('');
  const [defaultDrinkDescription, setDefaultDrinkDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isSavingRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      if (entity) {
        setName(entity.name || '');
        setTime((entity.scheduled_time || '08:00').slice(0, 5));
        setActive(entity.active ?? true);
        setDefaultDescription(entity.default_description || '');
        setDefaultDrinkDescription(entity.default_drink_description || '');
      } else {
        setName('');
        setTime('08:00');
        setActive(true);
        setDefaultDescription('');
        setDefaultDrinkDescription('');
      }
      setError('');
    }
  }, [isOpen, entity]);

  const isMenuOnlyMode = type === 'meal' && Boolean(entity) && !isAdmin;

  const handleSave = async () => {
    if (isSavingRef.current || loading) return;

    if (!isMenuOnlyMode) {
      if (!name.trim()) {
        setError('O nome é obrigatório.');
        return;
      }
      if (!time) {
        setError('O horário é obrigatório.');
        return;
      }
    }

    isSavingRef.current = true;
    setLoading(true);
    setError('');

    try {
      const scheduled_time = `${time}:00`;
      const normalizedDefaultDescription = defaultDescription.trim() || null;
      const normalizedDefaultDrinkDescription = defaultDrinkDescription.trim() || null;

      if (entity) {
        if (type === 'meal') {
          if (isMenuOnlyMode) {
            await updateMealConfig(entity.id, {
              default_description: normalizedDefaultDescription,
              default_drink_description: normalizedDefaultDrinkDescription,
            });
          } else {
            await updateMealConfig(entity.id, {
              name: name.trim(),
              scheduled_time,
              active,
              default_description: normalizedDefaultDescription,
              default_drink_description: normalizedDefaultDrinkDescription,
            });
          }
        } else {
          await updateMedicationPeriod(entity.id, { name: name.trim(), scheduled_time, active });
        }
      } else {
        if (!patientId) throw new Error('Patient ID missing for creation');
        if (type === 'meal') {
          await createMealConfig({
            patient_id: patientId,
            name: name.trim(),
            type: 'custom',
            scheduled_time,
            active,
            display_order: 99,
            default_description: normalizedDefaultDescription,
            default_drink_description: normalizedDefaultDrinkDescription,
          });
        } else {
          await createMedicationPeriod({
            patient_id: patientId,
            name: name.trim(),
            scheduled_time,
            active,
            display_order: 99,
          });
        }
      }

      onSuccess();
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Não foi possível salvar.');
    } finally {
      isSavingRef.current = false;
      setLoading(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    dismissMobileKeyboard();
    void handleSave();
  };

  const modalTitle = isMenuOnlyMode
    ? 'Configurar Cardápio'
    : entity
    ? 'Editar Horário'
    : 'Novo Horário';

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={() => {
        if (!loading) onClose();
      }}
      title={modalTitle}
    >
      <form onSubmit={handleFormSubmit} className="space-y-5">
        {error && (
          <div className="p-3 bg-red-50 dark:bg-rose-950/40 dark:border dark:border-rose-800/50 text-red-700 dark:text-rose-300 rounded-xl text-sm">
            {error}
          </div>
        )}

        {isMenuOnlyMode && entity ? (
          <div className="rounded-2xl border border-gray-100 dark:border-white/[0.08] bg-gray-50 dark:bg-[#1c1c22] p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
                Refeição
              </p>
              <h4 className="font-bold text-gray-900 dark:text-zinc-100 mt-0.5">{entity.name}</h4>
            </div>
            <span className="text-sm font-semibold text-gray-600 dark:text-zinc-300 tabular-nums">
              {formatTime(entity.scheduled_time)}
            </span>
          </div>
        ) : (
          <>
            <div className="space-y-2.5">
              <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Nome</label>
              <input
                type="text"
                enterKeyHint="done"
                disabled={loading}
                placeholder={type === 'meal' ? 'Ex: Almoço' : 'Ex: Manhã'}
                className="flex h-12 w-full rounded-xl border border-gray-200 dark:border-white/[0.1] bg-white dark:bg-[#1c1c22] text-gray-900 dark:text-zinc-100 placeholder:text-gray-400 dark:placeholder:text-zinc-500 px-4 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 dark:focus-visible:ring-zinc-400"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => handleEnterKeySubmit(e, handleSave)}
              />
            </div>

            <div className="space-y-2.5">
              <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Horário</label>
              <input
                type="time"
                disabled={loading}
                className="flex h-12 w-full rounded-xl border border-gray-200 dark:border-white/[0.1] bg-white dark:bg-[#1c1c22] text-gray-900 dark:text-zinc-100 px-4 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 dark:focus-visible:ring-zinc-400"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </>
        )}

        {type === 'meal' && (
          <div className="rounded-2xl border border-indigo-100/90 dark:border-indigo-900/40 bg-indigo-50/40 dark:bg-indigo-950/20 p-4 space-y-4">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                Cardápio programado (Opcional)
              </h4>
              <p className="text-xs text-gray-600 dark:text-zinc-400 mt-1 leading-relaxed">
                Aparece direto na tela de Hoje e já deixa o registro pré-preenchido para quem for servir.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                O que deve ser servido?
              </label>
              <input
                type="text"
                enterKeyHint="done"
                disabled={loading}
                placeholder="Ex: Iogurte com Nutren e Creatina"
                className="flex h-12 w-full rounded-xl border border-gray-200 dark:border-white/[0.1] bg-white dark:bg-[#1c1c22] text-gray-900 dark:text-zinc-100 placeholder:text-gray-400 dark:placeholder:text-zinc-500 px-4 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 dark:focus-visible:ring-zinc-400"
                value={defaultDescription}
                onChange={(e) => setDefaultDescription(e.target.value)}
                onKeyDown={(e) => handleEnterKeySubmit(e, handleSave)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                Bebida sugerida{' '}
                <span className="text-gray-400 dark:text-zinc-500 font-normal">(Opcional)</span>
              </label>
              <input
                type="text"
                enterKeyHint="done"
                disabled={loading}
                placeholder="Ex: 200ml de água ou chá"
                className="flex h-12 w-full rounded-xl border border-gray-200 dark:border-white/[0.1] bg-white dark:bg-[#1c1c22] text-gray-900 dark:text-zinc-100 placeholder:text-gray-400 dark:placeholder:text-zinc-500 px-4 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 dark:focus-visible:ring-zinc-400"
                value={defaultDrinkDescription}
                onChange={(e) => setDefaultDrinkDescription(e.target.value)}
                onKeyDown={(e) => handleEnterKeySubmit(e, handleSave)}
              />
            </div>
          </div>
        )}

        {!isMenuOnlyMode && (
          <div className="flex items-center justify-between p-4 rounded-xl border border-gray-100 dark:border-white/[0.08] bg-gray-50 dark:bg-[#1c1c22]">
            <div>
              <h4 className="font-medium text-gray-900 dark:text-zinc-100">Status</h4>
              <p className="text-sm text-gray-500 dark:text-zinc-400">
                {active ? 'Ativo' : 'Inativo'}
              </p>
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={() => setActive(!active)}
              className={`w-12 h-6 rounded-full transition-colors relative ${
                active ? 'bg-green-500 dark:bg-emerald-500' : 'bg-gray-300 dark:bg-zinc-700'
              }`}
            >
              <div
                className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${
                  active ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        )}

        <div className="pt-2">
          <Button
            type="submit"
            className="w-full min-h-[48px]"
            size="lg"
            disabled={loading || (!isMenuOnlyMode && (!time || !name.trim()))}
          >
            {loading ? (
              <Spinner className="text-white dark:text-zinc-950" />
            ) : isMenuOnlyMode ? (
              'Salvar Cardápio'
            ) : (
              'Salvar Alterações'
            )}
          </Button>
        </div>
      </form>
    </BottomSheet>
  );
}

