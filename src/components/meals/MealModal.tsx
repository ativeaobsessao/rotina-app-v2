import React, { useEffect, useState, useRef } from 'react';
import { Camera, Image as ImageIcon, X } from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';
import { cn } from '../../utils/cn';
import { compressImage } from '../../utils/image';
import { createMealLog, updateMealLog, uploadMealPhoto, deleteStorageFile, getMealPhotoUrl } from '../../services/api';
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
  onSuccess: () => void;
}

export function MealModal({
  isOpen,
  onClose,
  event,
  patientId,
  profileId,
  eventDate,
  patientGender,
  onSuccess
}: MealModalProps) {
  const isEditing = !!event.log;
  const pronoun = patientGender === 'F' ? 'ela' : patientGender === 'M' ? 'ele' : 'ela(e)';

  // Restaura rascunho caso o sistema operacional do celular tenha recarregado a aba ao voltar da câmera
  const restoredDraft = (() => {
    try {
      const raw = sessionStorage.getItem(MEAL_DRAFT_KEY) || localStorage.getItem(MEAL_DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        parsed.mealId === event.id &&
        parsed.patientId === patientId &&
        parsed.eventDate === eventDate &&
        Date.now() - (parsed.ts || 0) < 15 * 60 * 1000
      ) {
        return parsed;
      }
    } catch {}
    return null;
  })();

  const [mode, setMode] = useState<'view' | 'edit'>(restoredDraft ? 'edit' : isEditing ? 'view' : 'edit');
  const [consumption, setConsumption] = useState<'normal' | 'partial' | 'none'>(
    restoredDraft?.consumption || event.log?.consumption_status || 'normal'
  );
  const [description, setDescription] = useState<string>(
    restoredDraft?.description ?? (event.log?.description || '')
  );
  const [drinkDescription, setDrinkDescription] = useState<string>(
    restoredDraft?.drinkDescription ?? (event.log?.drink_description || '')
  );
  const [notes, setNotes] = useState<string>(
    restoredDraft?.notes ?? (event.log?.notes || '')
  );

  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  const initialTime = restoredDraft?.mealTime || (event.log?.meal_time ? event.log.meal_time.substring(0, 5) : currentTime);
  const [mealTime, setMealTime] = useState(initialTime);

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(event.photoSignedUrl || null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [isPhotoZoomed, setIsPhotoZoomed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  // Garante que a foto salva no banco sempre seja resolvida e exibida ao abrir o card
  useEffect(() => {
    let cancelled = false;
    if (photoFile || photoRemoved) return;

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
  }, [event.photoSignedUrl, event.log?.photo_url, photoFile, photoRemoved]);

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
        ts: Date.now()
      });
      sessionStorage.setItem(MEAL_DRAFT_KEY, payload);
      localStorage.setItem(MEAL_DRAFT_KEY, payload);
      localStorage.setItem('duca_active_flow_until', String(Date.now() + 10 * 60 * 1000));
      sessionStorage.setItem('duca_context_selected', '1');
    } catch {}
  };

  const handleClose = () => {
    if (loading) return;
    clearDraft();
    onClose();
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      localStorage.setItem('duca_active_flow_until', String(Date.now() + 10 * 60 * 1000));
      sessionStorage.setItem('duca_context_selected', '1');
    } catch {}

    const file = e.target.files?.[0];
    // Permite selecionar/tirar novamente mesmo se o usuário cancelar e tentar de novo
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
    setLoading(true);
    setError('');

    try {
      let photoUrl = event.log?.photo_url || null;

      // Só apaga a foto existente no banco se a cuidadora clicou explicitamente em remover (X)
      if (photoRemoved && !photoFile) {
        if (event.log?.photo_url) {
          await deleteStorageFile('meal-records', event.log.photo_url);
        }
        photoUrl = null;
      }

      if (photoFile) {
        try {
          const compressed = await compressImage(photoFile, 1280);
          const fileName = `${eventDate}_${event.id}_${Date.now()}.jpg`;
          const uploadData = await uploadMealPhoto(patientId, compressed, fileName);

          if (event.log?.photo_url) {
            await deleteStorageFile('meal-records', event.log.photo_url);
          }

          photoUrl = (uploadData as any).path;
          if (photoUrl) {
            // Pré-carrega e coloca no cache a URL assinada para exibição instantânea na Home e no Histórico
            await getMealPhotoUrl(photoUrl);
          }
        } catch (uploadErr) {
          console.error('Photo upload failed:', uploadErr);
          throw new Error('Falha ao enviar a foto da refeição. Verifique sua conexão e tente novamente.');
        }
      }

      const logData: any = {
        meal_config_id: event.id,
        patient_id: patientId,
        event_date: eventDate,
        consumption_status: consumption,
        description: description.trim() || null,
        drink_description: drinkDescription.trim() || null,
        notes: notes.trim() || null,
        photo_url: photoUrl,
        meal_time: mealTime ? `${mealTime}:00` : null,
        updated_by: profileId,
      };

      if (isEditing) {
        await updateMealLog(event.log.id, logData);
      } else {
        await createMealLog({
          ...logData,
          created_by: profileId,
        });
      }

      clearDraft();
      triggerHapticFeedback([40, 60, 40]);
      onSuccess();
    } catch (err: any) {
      console.error(err);
      if (err?.code === '42703' || String(err?.message || '').includes('drink_description')) {
        setError('Falta atualizar o banco de dados com a coluna drink_description. Execute o SQL enviado.');
      } else {
        setError(err?.message || 'Não foi possível salvar. Verifique sua conexão e tente novamente.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={handleClose} title={event.title}>
      <div className="space-y-6">
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
                <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-1">Status</span>
                <p className="font-medium text-gray-900 dark:text-zinc-100">
                  {event.log.consumption_status === 'normal'
                    ? 'Comeu normalmente'
                    : event.log.consumption_status === 'partial'
                    ? 'Comeu parcialmente'
                    : 'Não comeu'}
                </p>
              </div>

              <div>
                <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-1">Horário</span>
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
                  <p className="font-medium text-gray-900 dark:text-zinc-100">{event.log.drink_description}</p>
                </div>
              )}

              {event.log.notes && (
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-1">Observações</span>
                  <p className="font-medium text-gray-900 dark:text-zinc-100">{event.log.notes}</p>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="border-t border-gray-100 dark:border-white/[0.08] pt-4">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-2">Registro Original</h4>
                <div className="flex items-center text-sm">
                  <span className="mr-2 opacity-70">👤</span>
                  <span className="font-medium text-gray-900 dark:text-zinc-100">{event.log.creator?.name || 'Familiar'}</span>
                </div>
                <div className="text-xs text-gray-500 dark:text-zinc-400 pl-6 mt-0.5">
                  Registrado às{' '}
                  {new Date(event.log.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>

              {event.log.updated_by !== event.log.created_by && (
                <div className="border-t border-gray-100 dark:border-white/[0.08] pt-4">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-2">Última Alteração</h4>
                  <div className="flex items-center text-sm">
                    <span className="mr-2 opacity-70">👤</span>
                    <span className="font-medium text-gray-900 dark:text-zinc-100">{event.log.updater?.name || 'Familiar'}</span>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-zinc-400 pl-6 mt-0.5">
                    Alterado às{' '}
                    {new Date(event.log.updated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-2">
              <Button onClick={() => setMode('edit')} className="w-full font-medium" variant="outline">
                EDITAR REGISTRO
              </Button>
            </div>
          </div>
        ) : (
          <>
            {error && (
              <div className="p-3 bg-red-50 dark:bg-rose-950/40 dark:border dark:border-rose-800/50 text-red-700 dark:text-rose-300 rounded-xl text-sm">
                {error}
              </div>
            )}

            <div className="space-y-3">
              <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Como foi a refeição?</label>
              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
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
                      consumption === 'normal' ? 'border-green-500 dark:border-emerald-400' : 'border-gray-300 dark:border-zinc-600'
                    )}
                  >
                    {consumption === 'normal' && <div className="w-2.5 h-2.5 bg-green-500 dark:bg-emerald-400 rounded-full" />}
                  </div>
                  <span className={cn('font-medium', consumption === 'normal' ? 'text-green-900 dark:text-emerald-300' : 'text-gray-700 dark:text-zinc-200')}>
                    Comeu normalmente
                  </span>
                </button>
                <button
                  type="button"
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
                      consumption === 'partial' ? 'border-yellow-500 dark:border-amber-400' : 'border-gray-300 dark:border-zinc-600'
                    )}
                  >
                    {consumption === 'partial' && <div className="w-2.5 h-2.5 bg-yellow-500 dark:bg-amber-400 rounded-full" />}
                  </div>
                  <span className={cn('font-medium', consumption === 'partial' ? 'text-yellow-900 dark:text-amber-300' : 'text-gray-700 dark:text-zinc-200')}>
                    Comeu parcialmente
                  </span>
                </button>
                <button
                  type="button"
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
                      consumption === 'none' ? 'border-red-500 dark:border-rose-400' : 'border-gray-300 dark:border-zinc-600'
                    )}
                  >
                    {consumption === 'none' && <div className="w-2.5 h-2.5 bg-red-500 dark:bg-rose-400 rounded-full" />}
                  </div>
                  <span className={cn('font-medium', consumption === 'none' ? 'text-red-900 dark:text-rose-300' : 'text-gray-700 dark:text-zinc-200')}>
                    Não comeu
                  </span>
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Horário da Refeição</label>
              <Input type="time" value={mealTime} onChange={(e) => setMealTime(e.target.value)} />
            </div>

            <div className="space-y-3">
              <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                O que {pronoun} comeu? <span className="text-gray-400 dark:text-zinc-500 font-normal">(Opcional)</span>
              </label>
              <Input
                placeholder="Ex: Arroz, feijão, frango e salada."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-3">
              <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                O que {pronoun} bebeu? <span className="text-gray-400 dark:text-zinc-500 font-normal">(Opcional)</span>
              </label>
              <Input
                placeholder="Ex: 200ml de água, suco natural ou chá."
                value={drinkDescription}
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
                    onClick={() => {
                      if (objectUrlRef.current) {
                        URL.revokeObjectURL(objectUrlRef.current);
                        objectUrlRef.current = null;
                      }
                      setPhotoPreview(null);
                      setPhotoFile(null);
                      setPhotoRemoved(true);
                    }}
                    className="absolute top-2 right-2 p-2 bg-black/60 text-white rounded-full hover:bg-black/80 transition-colors"
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
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="pt-4">
              <Button className="w-full" size="lg" onClick={handleSave} disabled={loading}>
                {loading ? <Spinner className="text-white dark:text-zinc-950" /> : 'Confirmar Refeição'}
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
