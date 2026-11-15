import React, { useEffect, useState, useRef } from 'react';
import { Camera, Image as ImageIcon, X, Lock } from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';
import { cn } from '../../utils/cn';
import { compressImage } from '../../utils/image';
import { getCurrentLocalTime, formatDateToTime } from '../../utils/date';
import {
  createMealLog,
  updateMealLog,
  uploadMealPhoto,
  deleteStorageFile,
  getMealPhotoUrl,
  isTransientNetworkError,
} from '../../services/api';
import { triggerHapticFeedback } from '../../utils/haptics';
import type { MealEventData } from '../../types/timeline';

export const MEAL_DRAFT_KEY = 'duca_meal_draft';

interface MealModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: MealEventData;
  patientId: string;
  profileId: string;
  eventDate: string;
  patientGender?: string | null;
  isDayClosed?: boolean;
  onSuccess: () => void;
}

function readMatchingDraft(mealId: string, patientId: string, eventDate: string) {
  try {
    const raw = sessionStorage.getItem(MEAL_DRAFT_KEY) || localStorage.getItem(MEAL_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      parsed.mealId === mealId &&
      parsed.patientId === patientId &&
      parsed.eventDate === eventDate &&
      Date.now() - (parsed.ts || 0) < 15 * 60 * 1000
    ) {
      return parsed;
    }
  } catch {}
  return null;
}

export function MealModal({
  isOpen,
  onClose,
  event,
  patientId,
  profileId,
  eventDate,
  patientGender,
  isDayClosed = false,
  onSuccess,
}: MealModalProps) {
  const isEditing = !!event.log;
  const pronoun = patientGender === 'F' ? 'ela' : patientGender === 'M' ? 'ele' : 'ela(e)';

  const [mode, setMode] = useState<'view' | 'edit'>(() => {
    const draft = readMatchingDraft(event.id, patientId, eventDate);
    if (draft && !isDayClosed) return 'edit';
    return isEditing ? 'view' : 'edit';
  });
  const [consumption, setConsumption] = useState<'normal' | 'partial' | 'none'>(
    () => event.log?.consumption_status || 'normal'
  );
  const [description, setDescription] = useState<string>(() => event.log?.description || '');
  const [drinkDescription, setDrinkDescription] = useState<string>(
    () => event.log?.drink_description || ''
  );
  const [notes, setNotes] = useState<string>(() => event.log?.notes || '');
  const [mealTime, setMealTime] = useState<string>(() =>
    event.log?.meal_time ? event.log.meal_time.substring(0, 5) : getCurrentLocalTime().slice(0, 5)
  );

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(event.photoSignedUrl || null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [isPhotoZoomed, setIsPhotoZoomed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingStatus, setSavingStatus] = useState('Salvando...');
  const [error, setError] = useState('');

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const isSavingRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  // Re-sync modal state cleanly whenever the opened meal or its saved log changes
  useEffect(() => {
    if (!isOpen) return;

    const draft = readMatchingDraft(event.id, patientId, eventDate);
    const defaultTime = event.log?.meal_time
      ? event.log.meal_time.substring(0, 5)
      : getCurrentLocalTime().slice(0, 5);

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    setMode(draft && !isDayClosed ? 'edit' : event.log ? 'view' : 'edit');
    setConsumption(draft?.consumption || event.log?.consumption_status || 'normal');
    setDescription(draft?.description ?? (event.log?.description || ''));
    setDrinkDescription(draft?.drinkDescription ?? (event.log?.drink_description || ''));
    setNotes(draft?.notes ?? (event.log?.notes || ''));
    setMealTime(draft?.mealTime || defaultTime);
    setPhotoFile(null);
    setPhotoPreview(event.photoSignedUrl || null);
    setPhotoRemoved(false);
    setIsPhotoZoomed(false);
    setError('');
  }, [isOpen, event.id, eventDate, patientId, event.log?.id, event.log?.updated_at, isDayClosed]);

  // Ensure persisted storage photo resolves cleanly without stalling if already present
  useEffect(() => {
    let cancelled = false;
    if (!isOpen || photoFile || photoRemoved) return;

    if (event.photoSignedUrl) {
      setPhotoPreview(event.photoSignedUrl);
      return;
    }

    if (event.log?.photo_url) {
      getMealPhotoUrl(event.log.photo_url).then((url) => {
        if (!cancelled && url) {
          setPhotoPreview(url);
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [isOpen, event.photoSignedUrl, event.log?.photo_url, photoFile, photoRemoved]);

  const clearDraft = () => {
    try {
      sessionStorage.removeItem(MEAL_DRAFT_KEY);
      localStorage.removeItem(MEAL_DRAFT_KEY);
    } catch {}
  };

  const persistDraftForCamera = () => {
    try {
      const payload = JSON.stringify({
        mealId: event.id,
        patientId,
        eventDate,
        consumption,
        description,
        drinkDescription,
        notes,
        mealTime,
        ts: Date.now(),
      });
      sessionStorage.setItem(MEAL_DRAFT_KEY, payload);
      localStorage.setItem(MEAL_DRAFT_KEY, payload);
      localStorage.setItem('duca_active_flow_until', String(Date.now() + 10 * 60 * 1000));
      sessionStorage.setItem('duca_context_selected', '1');
    } catch {}
  };

  const handleClose = () => {
    if (loading || isSavingRef.current) return;
    clearDraft();
    onClose();
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      localStorage.setItem('duca_active_flow_until', String(Date.now() + 10 * 60 * 1000));
      sessionStorage.setItem('duca_context_selected', '1');
    } catch {}

    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    const objectUrl = URL.createObjectURL(file);
    objectUrlRef.current = objectUrl;
    setPhotoFile(file);
    setPhotoPreview(objectUrl);
    setPhotoRemoved(false);
    setError('');
  };

  const handleSave = async () => {
    if (isSavingRef.current || loading) return;
    if (isDayClosed) {
      setError('Este dia está encerrado. Reabra o dia antes de fazer alterações.');
      return;
    }

    isSavingRef.current = true;
    setLoading(true);
    setError('');

    const oldPhotoPath: string | null = event.log?.photo_url || null;
    let newlyUploadedPath: string | null = null;
    let dbConfirmed = false;

    try {
      let nextPhotoPath: string | null = oldPhotoPath;
      let offlinePhoto: {
        bucket: 'meal-records';
        patientId: string;
        fileName: string;
        blob: Blob;
      } | null = null;
      let oldPhotoPathToDeleteOffline: string | null = null;

      if (photoFile) {
        setSavingStatus('Preparando foto...');
        const compressed = await compressImage(photoFile, 1280);
        const fileName = `${eventDate}_${event.id}_${Date.now()}.jpg`;

        const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
        if (!isOnline) {
          offlinePhoto = {
            bucket: 'meal-records',
            patientId,
            fileName,
            blob: compressed,
          };
          oldPhotoPathToDeleteOffline = oldPhotoPath;
        } else {
          setSavingStatus('Enviando foto...');
          try {
            const uploadData = await uploadMealPhoto(patientId, compressed, fileName);
            newlyUploadedPath = (uploadData as any)?.path || `${patientId}/${fileName}`;
            nextPhotoPath = newlyUploadedPath;
          } catch (uploadErr: any) {
            if (isTransientNetworkError(uploadErr)) {
              offlinePhoto = {
                bucket: 'meal-records',
                patientId,
                fileName,
                blob: compressed,
              };
              oldPhotoPathToDeleteOffline = oldPhotoPath;
            } else {
              throw new Error(
                uploadErr?.message ||
                  'Não foi possível enviar a foto da refeição. Tente novamente.'
              );
            }
          }
        }
      } else if (photoRemoved) {
        nextPhotoPath = null;
        oldPhotoPathToDeleteOffline = oldPhotoPath;
      }

      setSavingStatus('Salvando registro...');
      const logData: any = {
        meal_config_id: event.id,
        patient_id: patientId,
        event_date: eventDate,
        consumption_status: consumption,
        description: description.trim() || null,
        drink_description: drinkDescription.trim() || null,
        notes: notes.trim() || null,
        photo_url: nextPhotoPath,
        meal_time: mealTime ? `${mealTime}:00` : null,
        updated_by: profileId,
      };

      const saved = isEditing
        ? await updateMealLog(event.log.id, logData, {
            offlinePhoto,
            oldPhotoPathToDelete: oldPhotoPathToDeleteOffline,
          })
        : await createMealLog(
            {
              ...logData,
              created_by: profileId,
            },
            {
              offlinePhoto,
              oldPhotoPathToDelete: oldPhotoPathToDeleteOffline,
            }
          );

      dbConfirmed = true;

      // Delete old Storage photo ONLY AFTER DB mutation succeeds (and not deferred to offline queue)
      const isQueuedOffline = Boolean(saved?._syncPending);
      if (!isQueuedOffline) {
        if (newlyUploadedPath) {
          // Warm signed URL cache silently
          getMealPhotoUrl(newlyUploadedPath).catch(() => {});
          if (oldPhotoPath && oldPhotoPath !== newlyUploadedPath) {
            deleteStorageFile('meal-records', oldPhotoPath).catch((cleanupErr) =>
              console.warn('Recoverable cleanup warning (old photo):', cleanupErr)
            );
          }
        } else if (photoRemoved && oldPhotoPath) {
          deleteStorageFile('meal-records', oldPhotoPath).catch((cleanupErr) =>
            console.warn('Recoverable cleanup warning (removed photo):', cleanupErr)
          );
        }
      }

      clearDraft();
      triggerHapticFeedback([40, 60, 40]);
      onSuccess();
    } catch (err: any) {
      console.error('MealModal save error:', err);

      // Rollback newly uploaded orphan photo if DB rejected the mutation
      if (!dbConfirmed && newlyUploadedPath) {
        deleteStorageFile('meal-records', newlyUploadedPath).catch((cleanupErr) =>
          console.warn('Recoverable rollback cleanup warning (orphan photo):', cleanupErr)
        );
      }

      const rawMsg = String(err?.message || '');
      if (!isMountedRef.current) return;

      if (rawMsg.toLowerCase().includes('já foi encerrado')) {
        setError('Este dia foi encerrado. Reabra o dia antes de salvar alterações.');
      } else if (err?.code === '42703' || rawMsg.includes('drink_description')) {
        setError('Banco de dados desatualizado (drink_description). Execute a migration pendente.');
      } else {
        setError(
          rawMsg || 'Não foi possível salvar. Seus dados foram mantidos; tente novamente.'
        );
      }
    } finally {
      isSavingRef.current = false;
      if (isMountedRef.current) {
        setLoading(false);
        setSavingStatus('Salvando...');
      }
    }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={handleClose} title={event.title}>
      <div className="space-y-6">
        {isDayClosed && (
          <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-200 text-xs">
            <Lock className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Dia encerrado — visualização protegida. Para alterar este registro, reabra o dia primeiro.
            </span>
          </div>
        )}

        {mode === 'view' && event.log ? (
          <div className="space-y-6">
            {photoPreview && (
              <button
                type="button"
                onClick={() => setIsPhotoZoomed(true)}
                className="w-full aspect-[4/3] bg-gray-100 dark:bg-[#1c1c22] rounded-2xl overflow-hidden relative block group focus:outline-none border border-transparent dark:border-white/[0.08]"
                title="Toque para ampliar a foto"
              >
                <img src={photoPreview} alt={event.title} className="w-full h-full object-cover" />
                <span className="absolute bottom-2.5 right-2.5 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur-sm text-white text-[11px] font-medium">
                  Toque para ampliar
                </span>
              </button>
            )}

            <div className="bg-gray-50 dark:bg-[#1c1c22] dark:border dark:border-white/[0.08] rounded-2xl p-5 space-y-4">
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-1">
                  Status
                </span>
                <p className="font-medium text-gray-900 dark:text-zinc-100">
                  {event.log.consumption_status === 'normal'
                    ? 'Comeu normalmente'
                    : event.log.consumption_status === 'partial'
                    ? 'Comeu parcialmente'
                    : 'Não comeu'}
                </p>
              </div>

              <div>
                <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-1">
                  Horário
                </span>
                <p className="font-medium text-gray-900 dark:text-zinc-100">
                  {event.log.meal_time ? event.log.meal_time.substring(0, 5) : 'Não informado'}
                </p>
              </div>

              {event.log.description && (
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-1">
                    O que {pronoun} comeu
                  </span>
                  <p className="font-medium text-gray-900 dark:text-zinc-100">{event.log.description}</p>
                </div>
              )}

              {event.log.drink_description && (
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-1">
                    O que {pronoun} bebeu
                  </span>
                  <p className="font-medium text-gray-900 dark:text-zinc-100">
                    {event.log.drink_description}
                  </p>
                </div>
              )}

              {event.log.notes && (
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-1">
                    Observações
                  </span>
                  <p className="font-medium text-gray-900 dark:text-zinc-100">{event.log.notes}</p>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="border-t border-gray-100 dark:border-white/[0.08] pt-4">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-2">
                  Registro Original
                </h4>
                <div className="flex items-center text-sm">
                  <span className="mr-2 opacity-70">👤</span>
                  <span className="font-medium text-gray-900 dark:text-zinc-100">
                    {event.log.creator?.name || 'Familiar'}
                  </span>
                </div>
                {event.log.created_at && (
                  <div className="text-xs text-gray-500 dark:text-zinc-400 pl-6 mt-0.5">
                    Registrado às {formatDateToTime(event.log.created_at)}
                  </div>
                )}
              </div>

              {event.log.updated_by && event.log.updated_by !== event.log.created_by && (
                <div className="border-t border-gray-100 dark:border-white/[0.08] pt-4">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-2">
                    Última Alteração
                  </h4>
                  <div className="flex items-center text-sm">
                    <span className="mr-2 opacity-70">👤</span>
                    <span className="font-medium text-gray-900 dark:text-zinc-100">
                      {event.log.updater?.name || 'Familiar'}
                    </span>
                  </div>
                  {event.log.updated_at && (
                    <div className="text-xs text-gray-500 dark:text-zinc-400 pl-6 mt-0.5">
                      Alterado às {formatDateToTime(event.log.updated_at)}
                    </div>
                  )}
                </div>
              )}
            </div>

            {!isDayClosed && (
              <div className="pt-2">
                <Button
                  type="button"
                  onClick={() => setMode('edit')}
                  className="w-full font-medium"
                  variant="outline"
                >
                  EDITAR REGISTRO
                </Button>
              </div>
            )}
          </div>
        ) : (
          <>
            {error && (
              <div className="p-3 bg-red-50 dark:bg-rose-950/40 dark:border dark:border-rose-800/50 text-red-700 dark:text-rose-300 rounded-xl text-sm">
                {error}
              </div>
            )}

            <div className="space-y-3">
              <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                Como foi a refeição?
              </label>
              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setConsumption('normal')}
                  className={cn(
                    'p-4 rounded-xl border text-left flex items-center space-x-3 transition-colors',
                    consumption === 'normal'
                      ? 'bg-green-50 border-green-200 dark:bg-emerald-950/35 dark:border-emerald-800/60'
                      : 'bg-white border-gray-200 dark:bg-[#1c1c22] dark:border-white/[0.08] dark:hover:bg-[#222229]'
                  )}
                >
                  <div
                    className={cn(
                      'w-5 h-5 rounded-full border-2 flex items-center justify-center',
                      consumption === 'normal'
                        ? 'border-green-500 dark:border-emerald-400'
                        : 'border-gray-300 dark:border-zinc-600'
                    )}
                  >
                    {consumption === 'normal' && (
                      <div className="w-2.5 h-2.5 bg-green-500 dark:bg-emerald-400 rounded-full" />
                    )}
                  </div>
                  <span
                    className={cn(
                      'font-medium',
                      consumption === 'normal'
                        ? 'text-green-900 dark:text-emerald-300'
                        : 'text-gray-700 dark:text-zinc-200'
                    )}
                  >
                    Comeu normalmente
                  </span>
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setConsumption('partial')}
                  className={cn(
                    'p-4 rounded-xl border text-left flex items-center space-x-3 transition-colors',
                    consumption === 'partial'
                      ? 'bg-yellow-50 border-yellow-200 dark:bg-amber-950/35 dark:border-amber-800/60'
                      : 'bg-white border-gray-200 dark:bg-[#1c1c22] dark:border-white/[0.08] dark:hover:bg-[#222229]'
                  )}
                >
                  <div
                    className={cn(
                      'w-5 h-5 rounded-full border-2 flex items-center justify-center',
                      consumption === 'partial'
                        ? 'border-yellow-500 dark:border-amber-400'
                        : 'border-gray-300 dark:border-zinc-600'
                    )}
                  >
                    {consumption === 'partial' && (
                      <div className="w-2.5 h-2.5 bg-yellow-500 dark:bg-amber-400 rounded-full" />
                    )}
                  </div>
                  <span
                    className={cn(
                      'font-medium',
                      consumption === 'partial'
                        ? 'text-yellow-900 dark:text-amber-300'
                        : 'text-gray-700 dark:text-zinc-200'
                    )}
                  >
                    Comeu parcialmente
                  </span>
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setConsumption('none')}
                  className={cn(
                    'p-4 rounded-xl border text-left flex items-center space-x-3 transition-colors',
                    consumption === 'none'
                      ? 'bg-red-50 border-red-200 dark:bg-rose-950/35 dark:border-rose-800/60'
                      : 'bg-white border-gray-200 dark:bg-[#1c1c22] dark:border-white/[0.08] dark:hover:bg-[#222229]'
                  )}
                >
                  <div
                    className={cn(
                      'w-5 h-5 rounded-full border-2 flex items-center justify-center',
                      consumption === 'none'
                        ? 'border-red-500 dark:border-rose-400'
                        : 'border-gray-300 dark:border-zinc-600'
                    )}
                  >
                    {consumption === 'none' && (
                      <div className="w-2.5 h-2.5 bg-red-500 dark:bg-rose-400 rounded-full" />
                    )}
                  </div>
                  <span
                    className={cn(
                      'font-medium',
                      consumption === 'none'
                        ? 'text-red-900 dark:text-rose-300'
                        : 'text-gray-700 dark:text-zinc-200'
                    )}
                  >
                    Não comeu
                  </span>
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                Horário da Refeição
              </label>
              <Input
                type="time"
                value={mealTime}
                disabled={loading}
                onChange={(e) => setMealTime(e.target.value)}
              />
            </div>

            <div className="space-y-3">
              <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                O que {pronoun} comeu?{' '}
                <span className="text-gray-400 dark:text-zinc-500 font-normal">(Opcional)</span>
              </label>
              <Input
                placeholder="Ex: Arroz, feijão, frango e salada."
                value={description}
                disabled={loading}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-3">
              <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                O que {pronoun} bebeu?{' '}
                <span className="text-gray-400 dark:text-zinc-500 font-normal">(Opcional)</span>
              </label>
              <Input
                placeholder="Ex: 200ml de água, suco natural ou chá."
                value={drinkDescription}
                disabled={loading}
                onChange={(e) => setDrinkDescription(e.target.value)}
              />
            </div>

            <div className="space-y-3">
              <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                Foto <span className="text-gray-400 dark:text-zinc-500 font-normal">(Opcional)</span>
              </label>

              {photoPreview ? (
                <div className="relative rounded-2xl overflow-hidden bg-gray-100 dark:bg-[#1c1c22] aspect-video border border-gray-200 dark:border-white/[0.1]">
                  <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      if (objectUrlRef.current) {
                        URL.revokeObjectURL(objectUrlRef.current);
                        objectUrlRef.current = null;
                      }
                      setPhotoPreview(null);
                      setPhotoFile(null);
                      setPhotoRemoved(true);
                    }}
                    className="absolute top-2 right-2 p-2 bg-black/60 text-white rounded-full hover:bg-black/80 transition-colors disabled:opacity-50"
                    title="Remover foto"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loading}
                    className="w-full py-3 flex items-center justify-center gap-2 rounded-xl"
                    onClick={() => {
                      persistDraftForCamera();
                      cameraInputRef.current?.click();
                    }}
                  >
                    <Camera className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span>Tirar foto</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loading}
                    className="w-full py-3 flex items-center justify-center gap-2 rounded-xl"
                    onClick={() => {
                      persistDraftForCamera();
                      galleryInputRef.current?.click();
                    }}
                  >
                    <ImageIcon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span>Da galeria</span>
                  </Button>
                </div>
              )}

              <input
                type="file"
                accept="image/*"
                capture="environment"
                ref={cameraInputRef}
                className="hidden"
                onChange={handlePhotoSelect}
              />
              <input
                type="file"
                accept="image/*"
                ref={galleryInputRef}
                className="hidden"
                onChange={handlePhotoSelect}
              />
            </div>

            <div className="space-y-3">
              <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                Observação <span className="text-gray-400 dark:text-zinc-500 font-normal">(Opcional)</span>
              </label>
              <Input
                placeholder="Alguma observação?"
                value={notes}
                disabled={loading}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="pt-4">
              <Button
                type="button"
                className="w-full"
                size="lg"
                onClick={handleSave}
                disabled={loading || isDayClosed}
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner className="text-white dark:text-zinc-950" />
                    <span>{savingStatus}</span>
                  </span>
                ) : (
                  'Confirmar Refeição'
                )}
              </Button>
            </div>
          </>
        )}
      </div>

      {isPhotoZoomed && photoPreview && (
        <div
          className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setIsPhotoZoomed(false)}
        >
          <button
            type="button"
            onClick={() => setIsPhotoZoomed(false)}
            className="absolute top-6 right-6 p-3 rounded-full bg-white/15 hover:bg-white/25 text-white transition-colors"
            aria-label="Fechar foto"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={photoPreview}
            alt={event.title}
            className="max-w-full max-h-[85dvh] object-contain rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </BottomSheet>
  );
}
