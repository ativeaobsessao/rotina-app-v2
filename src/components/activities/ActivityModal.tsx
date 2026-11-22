import React, { useEffect, useRef, useState } from 'react';
import { Check, Clock, Lock, XCircle } from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { cn } from '../../utils/cn';
import { createActivityLog, updateActivityLog } from '../../services/api';
import { formatDateToTime, formatTime } from '../../utils/date';
import { getActivityCategoryLabel } from '../../utils/activitySchedule';
import { triggerHapticFeedback } from '../../utils/haptics';
import { dismissMobileKeyboard, handleEnterKeySubmit } from '../../utils/keyboardSubmit';
import type { ActivityEventData } from '../../types/timeline';

interface ActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: ActivityEventData;
  patientId: string;
  profileId: string;
  eventDate: string;
  isDayClosed?: boolean;
  canEdit?: boolean;
  onSuccess: () => void;
}

export function ActivityModal({
  isOpen,
  onClose,
  event,
  patientId,
  profileId,
  eventDate,
  isDayClosed = false,
  canEdit = true,
  onSuccess,
}: ActivityModalProps) {
  const allowEdit = canEdit && !isDayClosed;
  const [mode, setMode] = useState<'view' | 'edit'>(() =>
    !canEdit || event.log ? 'view' : 'edit'
  );
  const [showNotCompletedForm, setShowNotCompletedForm] = useState(false);
  const [reason, setReason] = useState('Reagendada');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isSubmittingRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setMode(!canEdit || event.log ? 'view' : 'edit');
    setShowNotCompletedForm(false);
    setReason(event.log?.reason || 'Reagendada');
    setNotes(event.log?.notes || '');
    setError('');
  }, [isOpen, event.id, event.log, eventDate, canEdit]);

  const safeClose = () => {
    if (loading || isSubmittingRef.current) return;
    onClose();
  };

  const handleSaveStatus = async (status: 'completed' | 'not_completed') => {
    if (isSubmittingRef.current || loading) return;
    if (!canEdit) {
      setError('Sua conta não possui permissão ativa nesta família para registrar atividades.');
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
      const payloadNotes = notes.trim() || null;
      const nowIso = new Date().toISOString();

      if (event.log) {
        await updateActivityLog(
          event.log.id,
          {
            patient_id: patientId,
            event_date: eventDate,
            status,
            reason: status === 'not_completed' ? reason : null,
            notes: payloadNotes,
            completed_at: status === 'completed' ? nowIso : null,
            updated_by: profileId,
            updated_at: nowIso,
          },
          { expectedUpdatedAt: event.log.updated_at || null }
        );
      } else {
        await createActivityLog({
          activity_id: event.activity.id,
          patient_id: patientId,
          event_date: eventDate,
          status,
          reason: status === 'not_completed' ? reason : null,
          notes: payloadNotes,
          completed_at: status === 'completed' ? nowIso : null,
          created_by: profileId,
          updated_by: profileId,
        });
      }

      triggerHapticFeedback(status === 'completed' ? [40, 60, 40] : 50);
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

  const categoryLabel = getActivityCategoryLabel(event.activity?.category);

  return (
    <BottomSheet isOpen={isOpen} onClose={safeClose} title={event.title}>
      <div className="space-y-5">
        {isDayClosed && (
          <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-200 text-xs">
            <Lock className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Dia encerrado — visualização protegida. Para alterar atividades, reabra o dia primeiro.
            </span>
          </div>
        )}

        <div className="rounded-2xl bg-gray-50 dark:bg-[#1c1c22] border border-gray-100 dark:border-white/[0.08] p-4 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
              {categoryLabel}
            </span>
            <span className="text-xs font-semibold text-gray-500 dark:text-zinc-400 tabular-nums">
              {formatTime(event.time)}
            </span>
          </div>
          {event.activity?.notes && (
            <p className="text-sm text-gray-600 dark:text-zinc-300 pt-1">
              {event.activity.notes}
            </p>
          )}
        </div>

        {!canEdit && !event.log ? (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-gray-50 dark:bg-[#1c1c22] border border-gray-100 dark:border-white/[0.08] flex items-start gap-3">
              <Clock className="w-4 h-4 text-indigo-500 dark:text-indigo-400 shrink-0 mt-0.5" />
              <p className="text-xs text-gray-600 dark:text-zinc-300 leading-relaxed">
                Aguardando confirmação da cuidadora ou responsável para este horário.
              </p>
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
        ) : mode === 'view' && event.log ? (
          <div className="space-y-5">
            <div className="bg-gray-50 dark:bg-[#1c1c22] dark:border dark:border-white/[0.08] rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-gray-500 dark:text-zinc-400">
                  Situação registrada
                </span>
                <span
                  className={cn(
                    'text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap shrink-0',
                    event.log.status === 'completed'
                      ? 'bg-green-100 text-green-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : 'bg-red-100 text-red-700 dark:bg-rose-950/60 dark:text-rose-300'
                  )}
                >
                  {event.log.status === 'completed' ? 'Realizada' : 'Não realizada'}
                </span>
              </div>

              {event.log.status === 'not_completed' && event.log.reason && (
                <p className="text-sm text-red-700 dark:text-rose-300">
                  <span className="font-semibold">Motivo:</span> {event.log.reason}
                </p>
              )}

              {event.log.notes && (
                <p className="text-sm text-gray-700 dark:text-zinc-300">
                  <span className="font-semibold">Observação:</span> {event.log.notes}
                </p>
              )}

              <div className="border-t border-gray-200/50 dark:border-white/[0.08] pt-3 flex flex-col gap-2">
                <div className="flex flex-col text-xs text-gray-500 dark:text-zinc-400">
                  <span className="font-medium text-gray-700 dark:text-zinc-300 flex items-center gap-1">
                    <span className="opacity-70">👤</span> Registrado por{' '}
                    {event.log.creator?.name || 'Familiar'}
                  </span>
                  {event.log.created_at && (
                    <span className="pl-5 text-[11px] text-gray-400 dark:text-zinc-500">
                      Registrado às {formatDateToTime(event.log.created_at)}
                    </span>
                  )}
                </div>

                {event.log.updated_by && event.log.updated_by !== event.log.created_by && (
                  <div className="flex flex-col text-xs text-gray-500 dark:text-zinc-400">
                    <span className="font-medium text-gray-700 dark:text-zinc-300 flex items-center gap-1">
                      <span className="opacity-70">👤</span> Alterado por{' '}
                      {event.log.updater?.name || 'Familiar'}
                    </span>
                    {event.log.updated_at && (
                      <span className="pl-5 text-[11px] text-gray-400 dark:text-zinc-500">
                        Alterado às {formatDateToTime(event.log.updated_at)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {allowEdit && (
              <Button
                type="button"
                variant="outline"
                className="w-full min-h-[46px] font-medium"
                onClick={() => setMode('edit')}
              >
                EDITAR REGISTRO
              </Button>
            )}
          </div>
        ) : showNotCompletedForm ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              dismissMobileKeyboard();
              void handleSaveStatus('not_completed');
            }}
            className="space-y-5"
          >
            {error && (
              <div className="p-3 bg-red-50 dark:bg-rose-950/40 dark:border dark:border-rose-800/50 text-red-700 dark:text-rose-300 rounded-xl text-sm">
                {error}
              </div>
            )}

            <div className="space-y-2.5">
              <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                Motivo de não ter sido realizada
              </label>
              <select
                disabled={loading}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="flex h-12 w-full rounded-xl border border-gray-200 dark:border-white/[0.1] bg-white dark:bg-[#1c1c22] text-gray-900 dark:text-zinc-100 px-4 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 dark:focus-visible:ring-zinc-400"
              >
                <option value="Reagendada">Reagendada</option>
                <option value="Indisposição">Indisposição</option>
                <option value="Cancelada">Cancelada</option>
                <option value="Falta de transporte">Falta de transporte</option>
                <option value="Outro">Outro</option>
              </select>
            </div>

            <div className="space-y-2.5">
              <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                Observação <span className="text-gray-400 dark:text-zinc-500 font-normal">(Opcional)</span>
              </label>
              <input
                type="text"
                enterKeyHint="done"
                disabled={loading}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onKeyDown={(e) => handleEnterKeySubmit(e, () => handleSaveStatus('not_completed'))}
                placeholder="Detalhes..."
                className="flex h-12 w-full rounded-xl border border-gray-200 dark:border-white/[0.1] bg-white dark:bg-[#1c1c22] text-gray-900 dark:text-zinc-100 placeholder:text-gray-400 dark:placeholder:text-zinc-500 px-4 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 dark:focus-visible:ring-zinc-400"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1 min-h-[46px]"
                disabled={loading}
                onClick={() => {
                  setError('');
                  setShowNotCompletedForm(false);
                }}
              >
                Voltar
              </Button>
              <Button
                type="submit"
                className="flex-1 min-h-[46px] bg-red-600 hover:bg-red-700 dark:bg-rose-600 dark:hover:bg-rose-500 text-white"
                disabled={loading || isDayClosed}
              >
                {loading ? <Spinner className="text-white" /> : 'Confirmar'}
              </Button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              dismissMobileKeyboard();
              void handleSaveStatus('completed');
            }}
            className="space-y-5"
          >
            {error && (
              <div className="p-3 bg-red-50 dark:bg-rose-950/40 dark:border dark:border-rose-800/50 text-red-700 dark:text-rose-300 rounded-xl text-sm">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                Observação <span className="text-gray-400 dark:text-zinc-500 font-normal">(Opcional)</span>
              </label>
              <input
                type="text"
                enterKeyHint="done"
                disabled={loading || isDayClosed}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onKeyDown={(e) => handleEnterKeySubmit(e, () => handleSaveStatus('completed'))}
                placeholder="Como foi a atividade ou recado importante..."
                className="flex h-12 w-full rounded-xl border border-gray-200 dark:border-white/[0.1] bg-white dark:bg-[#1c1c22] text-gray-900 dark:text-zinc-100 placeholder:text-gray-400 dark:placeholder:text-zinc-500 px-4 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 dark:focus-visible:ring-zinc-400"
              />
            </div>

            <div className="space-y-2.5 pt-1">
              <Button
                type="submit"
                size="lg"
                disabled={loading || isDayClosed}
                className="w-full min-h-[48px] bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white font-semibold"
              >
                {loading ? (
                  <Spinner className="text-white" />
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Atividade realizada
                  </>
                )}
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={loading || isDayClosed}
                onClick={() => {
                  setError('');
                  setShowNotCompletedForm(true);
                }}
                className="w-full min-h-[46px] text-red-600 dark:text-rose-300 border-red-200 dark:border-rose-900/50 hover:bg-red-50 dark:hover:bg-rose-950/30"
              >
                <XCircle className="w-4 h-4 mr-2" />
                Não realizada
              </Button>
            </div>
          </form>
        )}
      </div>
    </BottomSheet>
  );
}
