import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Lock, Clock } from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { cn } from '../../utils/cn';
import { createMedicationLog, updateMedicationLog } from '../../services/api';
import { formatDateToTime } from '../../utils/date';
import { getMedicationDosageForDate } from '../../utils/medicationSchedule';
import { triggerHapticFeedback } from '../../utils/haptics';
import { dismissMobileKeyboard, handleEnterKeySubmit } from '../../utils/keyboardSubmit';
import type { MedicationEventData } from '../../types/timeline';

interface MedicationModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: MedicationEventData;
  patientId: string;
  profileId: string;
  eventDate: string;
  isDayClosed?: boolean;
  canEdit?: boolean;
  onSuccess: () => void;
  onPartialSuccess?: () => void;
}

export function MedicationModal({
  isOpen,
  onClose,
  event,
  patientId,
  profileId,
  eventDate,
  isDayClosed = false,
  canEdit = true,
  onSuccess,
  onPartialSuccess,
}: MedicationModalProps) {
  const allowEdit = canEdit && !isDayClosed;
  const [mode, setMode] = useState<'view' | 'edit'>(() =>
    !canEdit || event.logs.length > 0 ? 'view' : 'edit'
  );
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    event.logs.forEach((log) => {
      if (log.status === 'administered') initial.add(log.medication_id);
    });
    return initial;
  });
  const [savedMedIds, setSavedMedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    event.logs.forEach((log) => initial.add(log.medication_id));
    return initial;
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [partialSummary, setPartialSummary] = useState<string | null>(null);
  const [confirmIncompletePending, setConfirmIncompletePending] = useState(false);

  // State for the "Not Administered" sub-flow
  const [notAdministeredMedId, setNotAdministeredMedId] = useState<string | null>(null);
  const [notAdminReason, setNotAdminReason] = useState('Recusou');
  const [notAdminNotes, setNotAdminNotes] = useState('');

  const isSubmittingRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Sync local state whenever the opened medication period or logs refresh
  useEffect(() => {
    if (!isOpen) return;

    const initialChecked = new Set<string>();
    const initialSaved = new Set<string>();
    event.logs.forEach((log) => {
      initialSaved.add(log.medication_id);
      if (log.status === 'administered') {
        initialChecked.add(log.medication_id);
      }
    });

    setMode(!canEdit || event.logs.length > 0 ? 'view' : 'edit');
    setCheckedIds(initialChecked);
    setSavedMedIds(initialSaved);
    setNotAdministeredMedId(null);
    setNotAdminReason('Recusou');
    setNotAdminNotes('');
    setError('');
    setPartialSummary(null);
    setConfirmIncompletePending(false);
  }, [isOpen, event.id, eventDate, event.logs, canEdit]);

  const handleToggleCheck = (medId: string) => {
    if (loading || !allowEdit) return;
    setConfirmIncompletePending(false);
    const next = new Set(checkedIds);
    if (next.has(medId)) {
      next.delete(medId);
    } else {
      next.add(medId);
    }
    setCheckedIds(next);
  };

  const executeBatchConfirm = async () => {
    if (isSubmittingRef.current || loading) return;
    if (!canEdit) {
      setError('Sua conta não possui permissão ativa nesta família para registrar ou editar medicamentos.');
      return;
    }
    if (isDayClosed) {
      setError('Este dia está encerrado. Reabra o dia antes de fazer alterações.');
      return;
    }

    isSubmittingRef.current = true;
    setLoading(true);
    setError('');
    setPartialSummary(null);
    setConfirmIncompletePending(false);

    const targets = event.medications.filter((med) => {
      if (!checkedIds.has(med.id)) return false;
      const existingLog = event.logs.find((l) => l.medication_id === med.id);
      if (existingLog?.status === 'administered' || savedMedIds.has(med.id) && existingLog?.status === 'administered') {
        return false;
      }
      // If previously saved in a retry loop during this modal session, skip re-sending
      if (!existingLog && savedMedIds.has(med.id)) {
        return false;
      }
      return true;
    });

    if (targets.length === 0) {
      isSubmittingRef.current = false;
      setLoading(false);
      onSuccess();
      return;
    }

    const succeededNames: string[] = [];
    const succeededMedIds: string[] = [];
    const failedItems: { medId: string; name: string; reason: string }[] = [];

    for (const med of targets) {
      try {
        const existingLog = event.logs.find((l) => l.medication_id === med.id);
        const dayDosage = getMedicationDosageForDate(med, eventDate) || med.dosage || null;
        if (existingLog) {
          await updateMedicationLog(
            existingLog.id,
            {
              patient_id: patientId,
              event_date: eventDate,
              status: 'administered',
              reason: null,
              notes: null,
              applied_dosage: dayDosage,
              updated_by: profileId,
              administered_at: new Date().toISOString(),
            },
            { expectedUpdatedAt: existingLog.updated_at || null }
          );
        } else {
          await createMedicationLog({
            medication_id: med.id,
            patient_id: patientId,
            event_date: eventDate,
            status: 'administered',
            applied_dosage: dayDosage,
            created_by: profileId,
            updated_by: profileId,
            administered_at: new Date().toISOString(),
          });
        }
        succeededNames.push(med.name);
        succeededMedIds.push(med.id);
      } catch (err: any) {
        const msg = String(err?.message || 'Erro de conexão');
        failedItems.push({
          medId: med.id,
          name: med.name,
          reason: msg.toLowerCase().includes('já foi encerrado')
            ? 'Dia encerrado no servidor.'
            : msg,
        });
      }
    }

    isSubmittingRef.current = false;
    if (!isMountedRef.current) return;
    setLoading(false);

    if (succeededMedIds.length > 0) {
      setSavedMedIds((prev) => {
        const next = new Set(prev);
        succeededMedIds.forEach((id) => next.add(id));
        return next;
      });
    }

    if (failedItems.length === 0) {
      triggerHapticFeedback([40, 60, 40]);
      onSuccess();
      return;
    }

    // Partial or full failure: never show generic confirmation; keep modal open with exact breakdown
    if (succeededNames.length > 0) {
      onPartialSuccess?.();
      setPartialSummary(
        `Confirmados neste envio: ${succeededNames.join(', ')}.`
      );
    }

    const failedList = failedItems.map((f) => `${f.name} (${f.reason})`).join('; ');
    setError(`Não foi possível salvar: ${failedList}. Toque no botão para tentar novamente os pendentes.`);
  };

  const handleConfirmAllClick = () => {
    if (isSubmittingRef.current || loading) return;
    if (!canEdit) {
      setError('Sua conta não possui permissão ativa nesta família para registrar ou editar medicamentos.');
      return;
    }
    if (isDayClosed) {
      setError('Este dia está encerrado. Reabra o dia antes de fazer alterações.');
      return;
    }

    const notAdministeredCount = event.logs.filter((l) => l.status === 'not_administered').length;
    const totalPendingToResolve = event.medications.filter((m) => {
      const hasNotAdminLog = event.logs.some(
        (l) => l.medication_id === m.id && l.status === 'not_administered'
      );
      return !checkedIds.has(m.id) && !hasNotAdminLog;
    }).length;

    if (totalPendingToResolve > 0 && checkedIds.size + notAdministeredCount < event.medications.length) {
      setConfirmIncompletePending(true);
      return;
    }

    executeBatchConfirm();
  };

  const handleSaveNotAdministered = async () => {
    if (!notAdministeredMedId || isSubmittingRef.current || loading) return;
    if (!canEdit) {
      setError('Sua conta não possui permissão ativa nesta família para registrar ou editar medicamentos.');
      return;
    }
    if (isDayClosed) {
      setError('Este dia está encerrado. Reabra o dia antes de fazer alterações.');
      return;
    }

    isSubmittingRef.current = true;
    setLoading(true);
    setError('');

    try {
      const existingLog = event.logs.find((l) => l.medication_id === notAdministeredMedId);
      const targetMed = event.medications.find((m) => m.id === notAdministeredMedId);
      const dayDosage = targetMed
        ? getMedicationDosageForDate(targetMed, eventDate) || targetMed.dosage || null
        : null;

      const logData = {
        status: 'not_administered' as const,
        reason: notAdminReason,
        notes: notAdminNotes.trim() || null,
        applied_dosage: dayDosage,
        updated_by: profileId,
      };

      if (existingLog) {
        await updateMedicationLog(
          existingLog.id,
          {
            ...logData,
            patient_id: patientId,
            event_date: eventDate,
          },
          { expectedUpdatedAt: existingLog.updated_at || null }
        );
      } else {
        await createMedicationLog({
          medication_id: notAdministeredMedId,
          patient_id: patientId,
          event_date: eventDate,
          ...logData,
          created_by: profileId,
        });
      }

      triggerHapticFeedback(50);
      onSuccess();
    } catch (err: any) {
      console.error(err);
      if (!isMountedRef.current) return;
      const msg = String(err?.message || '');
      if (msg.toLowerCase().includes('já foi encerrado')) {
        setError('Este dia está encerrado. Reabra o dia antes de salvar.');
      } else {
        setError(msg || 'Não foi possível salvar. Verifique sua conexão e tente novamente.');
      }
    } finally {
      isSubmittingRef.current = false;
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  const safeClose = () => {
    if (loading || isSubmittingRef.current) return;
    onClose();
  };

  if (notAdministeredMedId) {
    const med = event.medications.find((m) => m.id === notAdministeredMedId);
    return (
      <BottomSheet
        isOpen={isOpen}
        onClose={() => {
          if (!loading) setNotAdministeredMedId(null);
        }}
        title="Não administrado"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            dismissMobileKeyboard();
            void handleSaveNotAdministered();
          }}
          className="space-y-6"
        >
          {error && (
            <div className="p-3 bg-red-50 dark:bg-rose-950/40 dark:border dark:border-rose-800/50 text-red-700 dark:text-rose-300 rounded-xl text-sm">
              {error}
            </div>
          )}

          <div>
            <p className="text-gray-900 dark:text-zinc-100 font-medium mb-1">{med?.name}</p>
            <p className="text-gray-500 dark:text-zinc-400 text-sm">
              {med ? getMedicationDosageForDate(med, eventDate) : ''}
            </p>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Motivo</label>
            <select
              disabled={loading}
              className="flex h-12 w-full rounded-xl border border-gray-200 dark:border-white/[0.1] bg-white dark:bg-[#1c1c22] text-gray-900 dark:text-zinc-100 px-4 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 dark:focus-visible:ring-zinc-400"
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
            <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
              Observação <span className="text-gray-400 dark:text-zinc-500 font-normal">(Opcional)</span>
            </label>
            <input
              type="text"
              enterKeyHint="done"
              disabled={loading}
              className="flex h-12 w-full rounded-xl border border-gray-200 dark:border-white/[0.1] bg-white dark:bg-[#1c1c22] text-gray-900 dark:text-zinc-100 placeholder:text-gray-400 dark:placeholder:text-zinc-500 px-4 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 dark:focus-visible:ring-zinc-400"
              placeholder="Detalhes..."
              value={notAdminNotes}
              onChange={(e) => setNotAdminNotes(e.target.value)}
              onKeyDown={(e) => handleEnterKeySubmit(e, handleSaveNotAdministered)}
            />
          </div>

          <div className="pt-4 flex space-x-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={loading}
              onClick={() => {
                setError('');
                setNotAdministeredMedId(null);
              }}
            >
              Voltar
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-red-600 hover:bg-red-700 dark:bg-rose-600 dark:hover:bg-rose-500 text-white"
              disabled={loading || isDayClosed}
            >
              {loading ? <Spinner className="text-white" /> : 'Confirmar'}
            </Button>
          </div>
        </form>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={safeClose} title={`Medicamentos - ${event.title}`}>
      <div className="space-y-6">
        {isDayClosed && (
          <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-200 text-xs">
            <Lock className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Dia encerrado — visualização protegida. Para alterar medicamentos, reabra o dia primeiro.
            </span>
          </div>
        )}

        {!canEdit && event.logs.length === 0 ? (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div className="p-4 rounded-2xl bg-gray-50 dark:bg-[#1c1c22] border border-gray-100 dark:border-white/[0.08] flex items-start gap-3">
              <Clock className="w-4 h-4 text-indigo-500 dark:text-indigo-400 shrink-0 mt-0.5" />
              <p className="text-xs text-gray-600 dark:text-zinc-300 leading-relaxed">
                Aguardando confirmação da cuidadora ou responsável para este horário.
              </p>
            </div>
            <div className="space-y-2.5">
              {event.medications.map((med) => (
                <div
                  key={med.id}
                  className="bg-white dark:bg-[#1c1c22] border border-gray-100 dark:border-white/[0.08] rounded-2xl p-4 flex items-center justify-between"
                >
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-zinc-100">{med.name}</h4>
                    <p className="text-sm text-gray-500 dark:text-zinc-400">
                      {getMedicationDosageForDate(med, eventDate)}
                    </p>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-gray-100 dark:bg-white/[0.08] text-gray-500 dark:text-zinc-400">
                    Pendente
                  </span>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={safeClose}
              className="w-full py-3.5 text-sm font-semibold text-gray-700 dark:text-zinc-200 bg-gray-100 dark:bg-[#1c1c22] hover:bg-gray-200 dark:hover:bg-[#26262f] rounded-2xl"
            >
              Fechar
            </Button>
          </div>
        ) : mode === 'view' && event.logs.length > 0 ? (
          <div className="space-y-6">
            <div className="space-y-3">
              {event.medications.map((med) => {
                const log = event.logs.find((l) => l.medication_id === med.id);
                const dayDosage = log?.applied_dosage || getMedicationDosageForDate(med, eventDate);

                if (!log) {
                  return (
                    <div
                      key={med.id}
                      className="bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-800/40 rounded-2xl p-4 flex flex-col gap-2"
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <h4 className="font-medium text-gray-900 dark:text-zinc-100">{med.name}</h4>
                          <p className="text-sm text-gray-600 dark:text-zinc-300">{dayDosage}</p>
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 whitespace-nowrap shrink-0">
                          Pendente
                        </span>
                      </div>
                      <p className="text-xs text-amber-800/80 dark:text-amber-300/80">
                        Aguardando confirmação neste horário.
                      </p>
                    </div>
                  );
                }

                const isNotAdministered = log.status === 'not_administered';
                return (
                  <div
                    key={med.id}
                    className="bg-gray-50 dark:bg-[#1c1c22] dark:border dark:border-white/[0.08] rounded-2xl p-4 flex flex-col gap-3"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <h4
                          className={cn(
                            'font-medium',
                            isNotAdministered
                              ? 'text-gray-500 dark:text-zinc-500 line-through'
                              : 'text-gray-900 dark:text-zinc-100'
                          )}
                        >
                          {med.name}
                        </h4>
                        <p className="text-sm text-gray-500 dark:text-zinc-400">{dayDosage}</p>
                      </div>
                      <span
                        className={cn(
                          'text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full whitespace-nowrap shrink-0',
                          isNotAdministered
                            ? 'bg-red-100 text-red-700 dark:bg-rose-950/60 dark:text-rose-300'
                            : 'bg-green-100 text-green-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                        )}
                      >
                        {isNotAdministered ? 'Não Admin' : 'Confirmado'}
                      </span>
                    </div>
                    {isNotAdministered && log.reason && (
                      <div className="text-sm text-red-700 dark:text-rose-300">
                        <span className="font-semibold">Motivo:</span> {log.reason}
                        {log.notes && <span className="block text-xs mt-0.5">{log.notes}</span>}
                      </div>
                    )}

                    <div className="border-t border-gray-200/50 dark:border-white/[0.08] pt-3 mt-1 flex flex-col gap-2">
                      <div className="flex flex-col text-xs text-gray-500 dark:text-zinc-400">
                        <span className="font-medium text-gray-700 dark:text-zinc-300 flex items-center gap-1">
                          <span className="opacity-70">👤</span> Registrado por{' '}
                          {log.creator?.name || 'Familiar'}
                        </span>
                        {log.created_at && (
                          <span className="pl-5 text-[11px] text-gray-400 dark:text-zinc-500">
                            Registrado às {formatDateToTime(log.created_at)}
                          </span>
                        )}
                      </div>

                      {log.updated_by && log.updated_by !== log.created_by && (
                        <div className="flex flex-col text-xs text-gray-500 dark:text-zinc-400">
                          <span className="font-medium text-gray-700 dark:text-zinc-300 flex items-center gap-1">
                            <span className="opacity-70">👤</span> Alterado por{' '}
                            {log.updater?.name || 'Familiar'}
                          </span>
                          {log.updated_at && (
                            <span className="pl-5 text-[11px] text-gray-400 dark:text-zinc-500">
                              Alterado às {formatDateToTime(log.updated_at)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {allowEdit && (
              <div className="pt-2">
                {(() => {
                  const pendingCount = event.medications.filter(
                    (m) => !event.logs.some((l) => l.medication_id === m.id)
                  ).length;
                  if (pendingCount > 0) {
                    return (
                      <Button
                        type="button"
                        onClick={() => setMode('edit')}
                        className="w-full font-semibold"
                        size="lg"
                      >
                        {pendingCount === 1 ? 'Registrar medicamento pendente' : `Registrar ${pendingCount} pendentes`}
                      </Button>
                    );
                  }
                  return (
                    <Button
                      type="button"
                      onClick={() => setMode('edit')}
                      className="w-full font-medium"
                      variant="outline"
                    >
                      EDITAR REGISTRO
                    </Button>
                  );
                })()}
              </div>
            )}
          </div>
        ) : (
          <>
            {partialSummary && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-200 rounded-xl text-sm">
                {partialSummary}
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-50 dark:bg-rose-950/40 dark:border dark:border-rose-800/50 text-red-700 dark:text-rose-300 rounded-xl text-sm">
                {error}
              </div>
            )}

            <div className="space-y-3">
              {event.medications.map((med) => {
                const isChecked = checkedIds.has(med.id);
                const log = event.logs.find((l) => l.medication_id === med.id);
                const isNotAdministered = log?.status === 'not_administered';
                const dayDosage = log?.applied_dosage || getMedicationDosageForDate(med, eventDate);

                return (
                  <div
                    key={med.id}
                    className="flex items-center justify-between p-4 rounded-xl border border-gray-100 dark:border-white/[0.08] bg-white dark:bg-[#1c1c22] shadow-sm"
                  >
                    <button
                      type="button"
                      disabled={loading || isDayClosed}
                      onClick={() => {
                        if (isNotAdministered) return;
                        handleToggleCheck(med.id);
                      }}
                      className="flex items-start space-x-4 flex-1 text-left"
                    >
                      <div
                        className={cn(
                          'w-6 h-6 rounded-md border-2 mt-0.5 flex items-center justify-center shrink-0 transition-colors',
                          isChecked
                            ? 'bg-green-500 border-green-500 dark:bg-emerald-500 dark:border-emerald-500'
                            : isNotAdministered
                            ? 'bg-red-100 border-red-300 dark:bg-rose-950/60 dark:border-rose-700'
                            : 'bg-white border-gray-300 dark:bg-[#121216] dark:border-zinc-600'
                        )}
                      >
                        {isChecked && <Check className="w-4 h-4 text-white" />}
                        {isNotAdministered && (
                          <AlertTriangle className="w-4 h-4 text-red-500 dark:text-rose-400" />
                        )}
                      </div>
                      <div>
                        <h4
                          className={cn(
                            'font-medium text-gray-900 dark:text-zinc-100',
                            isNotAdministered && 'line-through text-gray-500 dark:text-zinc-500'
                          )}
                        >
                          {med.name}
                        </h4>
                        <p className="text-sm text-gray-500 dark:text-zinc-400">{dayDosage}</p>
                        {isNotAdministered && log.reason && (
                          <p className="text-xs text-red-600 dark:text-rose-400 mt-1 font-medium">
                            Não administrado: {log.reason}
                          </p>
                        )}
                      </div>
                    </button>

                    {!isChecked && !isNotAdministered && (
                      <button
                        type="button"
                        disabled={loading || isDayClosed}
                        onClick={() => {
                          setError('');
                          setNotAdminReason('Recusou');
                          setNotAdminNotes('');
                          setNotAdministeredMedId(med.id);
                        }}
                        className="ml-4 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-rose-300 bg-red-50 dark:bg-rose-950/40 rounded-lg hover:bg-red-100 dark:hover:bg-rose-950/60 transition-colors disabled:opacity-50"
                      >
                        Não tomou
                      </button>
                    )}

                    {isNotAdministered && (
                      <button
                        type="button"
                        disabled={loading || isDayClosed}
                        onClick={() => {
                          setError('');
                          setNotAdministeredMedId(med.id);
                          setNotAdminReason(log.reason || 'Recusou');
                          setNotAdminNotes(log.notes || '');
                        }}
                        className="ml-4 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-zinc-300 bg-gray-100 dark:bg-white/[0.08] rounded-lg hover:bg-gray-200 dark:hover:bg-white/[0.12] transition-colors disabled:opacity-50"
                      >
                        Editar
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {confirmIncompletePending ? (
              <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 space-y-3">
                <p className="text-sm text-amber-900 dark:text-amber-200 font-medium">
                  Ainda existem medicamentos sem confirmação neste horário. Deseja salvar apenas os selecionados?
                </p>
                <div className="flex gap-2.5">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    disabled={loading}
                    onClick={() => setConfirmIncompletePending(false)}
                  >
                    Voltar
                  </Button>
                  <Button
                    type="button"
                    className="flex-1"
                    disabled={loading}
                    onClick={executeBatchConfirm}
                  >
                    {loading ? <Spinner className="text-white dark:text-zinc-950" /> : 'Confirmar mesmo assim'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="pt-4">
                <Button
                  type="button"
                  className="w-full"
                  size="lg"
                  onClick={handleConfirmAllClick}
                  disabled={loading || isDayClosed}
                >
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <Spinner className="text-white dark:text-zinc-950" />
                      <span>Salvando...</span>
                    </span>
                  ) : (
                    'Confirmar Medicamentos'
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
