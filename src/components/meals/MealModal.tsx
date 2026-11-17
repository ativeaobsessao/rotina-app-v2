import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Camera, Image as ImageIcon, X, Lock, Clock, CheckCircle2 } from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';
import { InAppCameraModal } from './InAppCameraModal';
import { cn } from '../../utils/cn';
import { compressImage, validateImageFile } from '../../utils/image';
import { getCurrentLocalTime, formatDateToTime } from '../../utils/date';
import {
  createMealLog,
  updateMealLog,
  uploadMealPhoto,
  deleteStorageFile,
  getMealPhotoUrl,
  isTransientNetworkError,
  isRlsPermissionError,
} from '../../services/api';
import {
  LEGACY_MEAL_DRAFT_KEY,
  saveMealDraft,
  getMealDraft,
  deleteMealDraft,
  setActiveMealRecovery,
  blobToFile,
  isInAppCameraPreferred,
  setInAppCameraPreferred,
  markNativeCameraPending,
  clearNativeCameraPending,
  consumePendingNativeCameraCrash,
} from '../../services/mealDrafts';
import { triggerHapticFeedback } from '../../utils/haptics';
import type { MealEventData } from '../../types/timeline';

export const MEAL_DRAFT_KEY = LEGACY_MEAL_DRAFT_KEY;

interface MealModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: MealEventData;
  patientId: string;
  profileId: string;
  eventDate: string;
  patientGender?: string | null;
  isDayClosed?: boolean;
  canEdit?: boolean;
  recoveryTab?: 'today' | 'history';
  editingDateStr?: string | null;
  requestMediaStream?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  captureFrame?: (video: HTMLVideoElement) => Promise<File>;
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
  isDayClosed = false,
  canEdit = true,
  recoveryTab = 'today',
  editingDateStr = null,
  requestMediaStream,
  captureFrame,
  onSuccess,
}: MealModalProps) {
  const isEditing = !!event.log;
  const allowEdit = canEdit && !isDayClosed;
  const pronoun = patientGender === 'F' ? 'ela' : patientGender === 'M' ? 'ele' : 'ela(e)';

  const [mode, setMode] = useState<'view' | 'edit'>(() => {
    if (!canEdit) return 'view';
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
  const [uploadedPhotoPath, setUploadedPhotoPath] = useState<string | null>(null);
  const [wasRecovered, setWasRecovered] = useState(false);
  const [recoveredFromCameraCrash, setRecoveredFromCameraCrash] = useState(false);
  const [preferInAppCamera, setPreferInAppCamera] = useState<boolean>(() => isInAppCameraPreferred());
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isPhotoZoomed, setIsPhotoZoomed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingStatus, setSavingStatus] = useState('Salvando...');
  const [error, setError] = useState('');

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const isSavingRef = useRef(false);
  const isMountedRef = useRef(true);
  const hasLocalEditsRef = useRef(false);
  const activeSessionKeyRef = useRef<string | null>(null);
  const draftReqSeqRef = useRef(0);
  const draftDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeCameraOpenedInThisMountRef = useRef(false);
  const nativeCancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const formRef = useRef({
    consumption,
    description,
    drinkDescription,
    notes,
    mealTime,
    photoFile,
    photoRemoved,
    uploadedPhotoPath,
  });
  formRef.current = {
    consumption,
    description,
    drinkDescription,
    notes,
    mealTime,
    photoFile,
    photoRemoved,
    uploadedPhotoPath,
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (draftDebounceRef.current) {
        clearTimeout(draftDebounceRef.current);
        draftDebounceRef.current = null;
      }
      if (nativeCancelTimerRef.current) {
        clearTimeout(nativeCancelTimerRef.current);
        nativeCancelTimerRef.current = null;
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  // If the same JS runtime resumes after user cancels native camera (without OS process kill),
  // wait briefly for onChange and then clear pending intent without flagging a crash.
  useEffect(() => {
    if (!isOpen) return;

    const scheduleSameSessionCancelClear = () => {
      if (!nativeCameraOpenedInThisMountRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (nativeCancelTimerRef.current) {
        clearTimeout(nativeCancelTimerRef.current);
      }
      nativeCancelTimerRef.current = setTimeout(() => {
        nativeCancelTimerRef.current = null;
        nativeCameraOpenedInThisMountRef.current = false;
        clearNativeCameraPending({ userId: profileId, patientId, mealId: event.id, eventDate });
      }, 1500);
    };

    window.addEventListener('focus', scheduleSameSessionCancelClear);
    document.addEventListener('visibilitychange', scheduleSameSessionCancelClear);
    return () => {
      window.removeEventListener('focus', scheduleSameSessionCancelClear);
      document.removeEventListener('visibilitychange', scheduleSameSessionCancelClear);
    };
  }, [isOpen, profileId, patientId, event.id, eventDate]);

  const persistDraftNow = useCallback(
    async (overrides?: {
      photoBlob?: Blob | null;
      photoRemoved?: boolean;
      uploadedPhotoPath?: string | null;
      markActiveRecovery?: boolean;
    }) => {
      if (!profileId || !patientId || !event.id || !eventDate || !allowEdit) return;
      const cur = formRef.current;
      const blobToSave = overrides && 'photoBlob' in overrides ? overrides.photoBlob ?? null : cur.photoFile;
      const nextRemoved =
        overrides && 'photoRemoved' in overrides ? Boolean(overrides.photoRemoved) : cur.photoRemoved;
      const nextUploadedPath =
        overrides && 'uploadedPhotoPath' in overrides
          ? overrides.uploadedPhotoPath ?? null
          : cur.uploadedPhotoPath;

      try {
        await saveMealDraft({
          userId: profileId,
          patientId,
          mealId: event.id,
          eventDate,
          tab: recoveryTab,
          editingDateStr: editingDateStr ?? null,
          consumption: cur.consumption,
          description: cur.description,
          drinkDescription: cur.drinkDescription,
          notes: cur.notes,
          mealTime: cur.mealTime,
          photoBlob: blobToSave,
          photoName: blobToSave instanceof File ? blobToSave.name : null,
          photoType: blobToSave?.type || null,
          photoRemoved: nextRemoved,
          uploadedPhotoPath: nextUploadedPath,
          markActiveRecovery: overrides?.markActiveRecovery ?? true,
        });
      } catch (draftErr) {
        console.warn('Recoverable warning saving meal draft:', draftErr);
      }
    },
    [allowEdit, editingDateStr, event.id, eventDate, patientId, profileId, recoveryTab]
  );

  // Sync modal state only on session open / close; never wipe in-progress edits or photos on background refresh
  useEffect(() => {
    if (!isOpen) {
      activeSessionKeyRef.current = null;
      hasLocalEditsRef.current = false;
      setIsCameraOpen(false);
      if (draftDebounceRef.current) {
        clearTimeout(draftDebounceRef.current);
        draftDebounceRef.current = null;
      }
      return;
    }

    const sessionKey = `${profileId}:${patientId}:${event.id}:${eventDate}`;
    const defaultTime = event.log?.meal_time
      ? event.log.meal_time.substring(0, 5)
      : getCurrentLocalTime().slice(0, 5);

    if (activeSessionKeyRef.current !== sessionKey) {
      activeSessionKeyRef.current = sessionKey;
      hasLocalEditsRef.current = false;
      nativeCameraOpenedInThisMountRef.current = false;

      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }

      const crashedInNativeCamera = Boolean(
        profileId &&
          patientId &&
          event.id &&
          eventDate &&
          allowEdit &&
          consumePendingNativeCameraCrash({
            userId: profileId,
            patientId,
            mealId: event.id,
            eventDate,
          })
      );

      setMode(crashedInNativeCamera ? 'edit' : !canEdit ? 'view' : event.log ? 'view' : 'edit');
      setConsumption(event.log?.consumption_status || 'normal');
      setDescription(event.log?.description || '');
      setDrinkDescription(event.log?.drink_description || '');
      setNotes(event.log?.notes || '');
      setMealTime(defaultTime);
      setPhotoFile(null);
      setPhotoPreview(event.photoSignedUrl || null);
      setPhotoRemoved(false);
      setUploadedPhotoPath(null);
      setWasRecovered(crashedInNativeCamera);
      setRecoveredFromCameraCrash(crashedInNativeCamera);
      setPreferInAppCamera(crashedInNativeCamera || isInAppCameraPreferred());
      setIsCameraOpen(false);
      setIsPhotoZoomed(false);
      setError('');

      if (profileId && patientId && event.id && eventDate && allowEdit) {
        const myReq = ++draftReqSeqRef.current;
        getMealDraft({ userId: profileId, patientId, mealId: event.id, eventDate })
          .then((draft) => {
            if (
              !isMountedRef.current ||
              myReq !== draftReqSeqRef.current ||
              activeSessionKeyRef.current !== sessionKey ||
              hasLocalEditsRef.current
            ) {
              return;
            }
            if (!draft) return;

            setMode('edit');
            setConsumption(draft.consumption);
            setDescription(draft.description);
            setDrinkDescription(draft.drinkDescription);
            setNotes(draft.notes);
            setMealTime(draft.mealTime || defaultTime);
            setPhotoRemoved(Boolean(draft.photoRemoved));
            setUploadedPhotoPath(draft.uploadedPhotoPath || null);

            if (draft.photoBlob) {
              const restoredFile = blobToFile(draft.photoBlob, draft.photoName, draft.photoType);
              if (objectUrlRef.current) {
                URL.revokeObjectURL(objectUrlRef.current);
              }
              const objUrl = URL.createObjectURL(draft.photoBlob);
              objectUrlRef.current = objUrl;
              setPhotoFile(restoredFile);
              setPhotoPreview(objUrl);
              setWasRecovered(true);
            } else if (draft.photoRemoved) {
              setPhotoFile(null);
              setPhotoPreview(null);
              setWasRecovered(true);
            } else if (
              draft.description ||
              draft.drinkDescription ||
              draft.notes ||
              draft.uploadedPhotoPath
            ) {
              setWasRecovered(true);
            }
          })
          .catch(() => {});
      }
    } else if (!hasLocalEditsRef.current && !photoFile && !photoRemoved && !isCameraOpen && mode === 'view') {
      // Safe view-mode refresh if server log updated externally while user hadn't started editing
      setConsumption(event.log?.consumption_status || 'normal');
      setDescription(event.log?.description || '');
      setDrinkDescription(event.log?.drink_description || '');
      setNotes(event.log?.notes || '');
      setMealTime(defaultTime);
      setPhotoPreview(event.photoSignedUrl || null);
    }
  }, [
    isOpen,
    profileId,
    patientId,
    event.id,
    eventDate,
    event.log?.id,
    event.log?.updated_at,
    event.photoSignedUrl,
    isDayClosed,
    canEdit,
    allowEdit,
    isCameraOpen,
    mode,
    photoFile,
    photoRemoved,
  ]);

  // Debounced auto-save for text/status edits while modal is in edit mode
  useEffect(() => {
    if (!isOpen || !allowEdit || mode !== 'edit' || !hasLocalEditsRef.current) return;

    if (draftDebounceRef.current) {
      clearTimeout(draftDebounceRef.current);
    }
    draftDebounceRef.current = setTimeout(() => {
      draftDebounceRef.current = null;
      void persistDraftNow();
    }, 250);

    return () => {
      if (draftDebounceRef.current) {
        clearTimeout(draftDebounceRef.current);
        draftDebounceRef.current = null;
      }
    };
  }, [
    isOpen,
    allowEdit,
    mode,
    consumption,
    description,
    drinkDescription,
    notes,
    mealTime,
    persistDraftNow,
  ]);

  // Ensure persisted storage photo resolves cleanly without stalling or overwriting selected photo
  useEffect(() => {
    let cancelled = false;
    if (!isOpen || photoFile || photoRemoved || hasLocalEditsRef.current) return;

    if (event.photoSignedUrl) {
      setPhotoPreview(event.photoSignedUrl);
      return;
    }

    if (event.log?.photo_url) {
      getMealPhotoUrl(event.log.photo_url).then((url) => {
        if (!cancelled && url && !formRef.current.photoFile && !formRef.current.photoRemoved) {
          setPhotoPreview(url);
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [isOpen, event.photoSignedUrl, event.log?.photo_url, photoFile, photoRemoved]);

  const clearDraft = useCallback(async () => {
    if (draftDebounceRef.current) {
      clearTimeout(draftDebounceRef.current);
      draftDebounceRef.current = null;
    }
    if (!profileId || !patientId || !event.id || !eventDate) return;
    await deleteMealDraft({ userId: profileId, patientId, mealId: event.id, eventDate });
  }, [event.id, eventDate, patientId, profileId]);

  const markRecoveryBeforePicker = useCallback(() => {
    hasLocalEditsRef.current = true;
    setActiveMealRecovery({
      userId: profileId,
      patientId,
      mealId: event.id,
      eventDate,
      tab: recoveryTab,
      editingDateStr: editingDateStr ?? null,
    });
    void persistDraftNow({ markActiveRecovery: true });
  }, [editingDateStr, event.id, eventDate, patientId, persistDraftNow, profileId, recoveryTab]);

  const handleClose = () => {
    if (loading || isSavingRef.current || isCameraOpen) return;

    if (nativeCancelTimerRef.current) {
      clearTimeout(nativeCancelTimerRef.current);
      nativeCancelTimerRef.current = null;
    }
    nativeCameraOpenedInThisMountRef.current = false;
    clearNativeCameraPending({ userId: profileId, patientId, mealId: event.id, eventDate });

    const uncommittedPath = formRef.current.uploadedPhotoPath;
    if (uncommittedPath && uncommittedPath !== event.log?.photo_url) {
      deleteStorageFile('meal-records', uncommittedPath).catch(() => {});
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    hasLocalEditsRef.current = false;
    void clearDraft();
    onClose();
  };

  const handlePhotoAccepted = (file: File) => {
    try {
      validateImageFile(file);
    } catch (validationErr: any) {
      setIsCameraOpen(false);
      setError(
        validationErr?.message ||
          'O arquivo selecionado não é uma imagem válida. Tente tirar outra foto ou escolher da galeria.'
      );
      return;
    }

    const prevUncommitted = formRef.current.uploadedPhotoPath;
    if (prevUncommitted && prevUncommitted !== event.log?.photo_url) {
      deleteStorageFile('meal-records', prevUncommitted).catch(() => {});
    }

    hasLocalEditsRef.current = true;

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    const objectUrl = URL.createObjectURL(file);
    objectUrlRef.current = objectUrl;

    formRef.current.photoFile = file;
    formRef.current.photoRemoved = false;
    formRef.current.uploadedPhotoPath = null;

    setPhotoFile(file);
    setPhotoPreview(objectUrl);
    setPhotoRemoved(false);
    setUploadedPhotoPath(null);
    setWasRecovered(false);
    setRecoveredFromCameraCrash(false);
    setIsCameraOpen(false);
    setError('');

    // Save raw captured Blob to IndexedDB IMMEDIATELY before compression or upload
    void persistDraftNow({
      photoBlob: file,
      photoRemoved: false,
      uploadedPhotoPath: null,
      markActiveRecovery: true,
    });
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (nativeCancelTimerRef.current) {
      clearTimeout(nativeCancelTimerRef.current);
      nativeCancelTimerRef.current = null;
    }
    nativeCameraOpenedInThisMountRef.current = false;
    clearNativeCameraPending({ userId: profileId, patientId, mealId: event.id, eventDate });

    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    handlePhotoAccepted(file);
  };

  const handleOpenInAppCamera = () => {
    if (loading || !allowEdit) return;
    markRecoveryBeforePicker();
    setIsCameraOpen(true);
  };

  const handleTriggerNativeCamera = () => {
    if (loading || !allowEdit) return;
    markRecoveryBeforePicker();
    nativeCameraOpenedInThisMountRef.current = true;
    markNativeCameraPending({ userId: profileId, patientId, mealId: event.id, eventDate });
    setIsCameraOpen(false);
    cameraInputRef.current?.click();
  };

  const handlePrimaryTakePhoto = () => {
    if (preferInAppCamera) {
      handleOpenInAppCamera();
      return;
    }
    handleTriggerNativeCamera();
  };

  const handleTriggerGallery = () => {
    if (loading || !allowEdit) return;
    markRecoveryBeforePicker();
    setIsCameraOpen(false);
    galleryInputRef.current?.click();
  };

  const handleRemovePhoto = () => {
    if (loading) return;
    const prevUncommitted = formRef.current.uploadedPhotoPath;
    if (prevUncommitted && prevUncommitted !== event.log?.photo_url) {
      deleteStorageFile('meal-records', prevUncommitted).catch(() => {});
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    hasLocalEditsRef.current = true;
    formRef.current.photoFile = null;
    formRef.current.photoRemoved = true;
    formRef.current.uploadedPhotoPath = null;

    setPhotoPreview(null);
    setPhotoFile(null);
    setPhotoRemoved(true);
    setUploadedPhotoPath(null);
    setWasRecovered(false);

    void persistDraftNow({
      photoBlob: null,
      photoRemoved: true,
      uploadedPhotoPath: null,
      markActiveRecovery: true,
    });
  };

  const handleSave = async () => {
    if (isSavingRef.current || loading) return;
    if (!canEdit) {
      setError('Apenas administradores podem registrar ou editar refeições.');
      return;
    }
    if (isDayClosed) {
      setError('Este dia está encerrado. Reabra o dia antes de fazer alterações.');
      return;
    }

    isSavingRef.current = true;
    setLoading(true);
    setError('');

    const oldPhotoPath: string | null = event.log?.photo_url || null;
    let newlyUploadedPath: string | null = formRef.current.uploadedPhotoPath || null;
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
        const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;

        if (newlyUploadedPath && isOnline) {
          // Photo was already uploaded in an earlier retry where DB save failed: reuse idempotently
          nextPhotoPath = newlyUploadedPath;
        } else {
          setSavingStatus('Preparando foto...');
          let compressed: File;
          try {
            compressed = await compressImage(photoFile, 2048);
          } catch (compressionErr: any) {
            throw new Error(
              compressionErr?.message ||
                'Não foi possível processar a fotografia. Tente escolher outra foto ou tirar novamente.'
            );
          }

          const fileName = `${eventDate}_${event.id}_${Date.now()}.jpg`;

          if (!isOnline) {
            offlinePhoto = {
              bucket: 'meal-records',
              patientId,
              fileName,
              blob: compressed,
            };
            oldPhotoPathToDeleteOffline = oldPhotoPath;
            newlyUploadedPath = null;
          } else {
            setSavingStatus('Enviando foto...');
            try {
              const uploadData = await uploadMealPhoto(patientId, compressed, fileName);
              newlyUploadedPath = (uploadData as any)?.path || `${patientId}/${fileName}`;
              nextPhotoPath = newlyUploadedPath;

              // Checkpoint uploaded path in state & IndexedDB so retries won't duplicate uploads
              formRef.current.uploadedPhotoPath = newlyUploadedPath;
              setUploadedPhotoPath(newlyUploadedPath);
              await persistDraftNow({
                photoBlob: photoFile,
                photoRemoved: false,
                uploadedPhotoPath: newlyUploadedPath,
              });
            } catch (uploadErr: any) {
              if (isTransientNetworkError(uploadErr)) {
                offlinePhoto = {
                  bucket: 'meal-records',
                  patientId,
                  fileName,
                  blob: compressed,
                };
                oldPhotoPathToDeleteOffline = oldPhotoPath;
                newlyUploadedPath = null;
              } else if (isRlsPermissionError(uploadErr)) {
                throw new Error('Sem permissão para enviar a fotografia desta refeição.');
              } else {
                throw new Error(
                  'Não foi possível enviar a fotografia agora. Seus dados e a foto foram mantidos; tente novamente.'
                );
              }
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
            uploadedPhotoPath: newlyUploadedPath,
            expectedUpdatedAt: event.log?.updated_at || null,
          })
        : await createMealLog(
            {
              ...logData,
              created_by: profileId,
            },
            {
              offlinePhoto,
              oldPhotoPathToDelete: oldPhotoPathToDeleteOffline,
              uploadedPhotoPath: newlyUploadedPath,
            }
          );

      dbConfirmed = true;

      // Delete old Storage photo ONLY AFTER DB mutation succeeds (and not deferred to offline queue)
      const isQueuedOffline = Boolean(saved?._syncPending);
      if (!isQueuedOffline) {
        if (newlyUploadedPath) {
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

      hasLocalEditsRef.current = false;
      formRef.current.uploadedPhotoPath = null;
      await clearDraft();
      triggerHapticFeedback([40, 60, 40]);
      onSuccess();
    } catch (err: any) {
      console.error('MealModal save error:', err);

      const rawMsg = String(err?.message || '');
      const isPermanentConflictOrPermission =
        isRlsPermissionError(err) ||
        rawMsg.toLowerCase().includes('acabou de ser registrad') ||
        rawMsg.toLowerCase().includes('foi atualizada por') ||
        err?.code === '42703';

      // Only purge newlyUploadedPath immediately on unrecoverable conflicts/permissions;
      // on transient/retryable DB errors, keep uploadedPhotoPath checkpointed for idempotent retry!
      if (!dbConfirmed && newlyUploadedPath && isPermanentConflictOrPermission) {
        formRef.current.uploadedPhotoPath = null;
        if (isMountedRef.current) setUploadedPhotoPath(null);
        await persistDraftNow({ uploadedPhotoPath: null });
        deleteStorageFile('meal-records', newlyUploadedPath).catch((cleanupErr) =>
          console.warn('Recoverable rollback cleanup warning (orphan photo):', cleanupErr)
        );
      }

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
    <>
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

        {!canEdit && !event.log ? (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="p-6 rounded-2xl bg-gray-50 dark:bg-[#1c1c22] border border-gray-100 dark:border-white/[0.08] flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800/40 flex items-center justify-center mb-3">
                <Clock className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
              </div>
              <h3 className="text-base font-bold text-gray-900 dark:text-zinc-100">
                Aguardando registro
              </h3>
              <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1.5 max-w-xs leading-relaxed">
                Assim que o responsável ou cuidadora registrar esta refeição, as informações e fotos aparecerão aqui.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              className="w-full py-3.5 text-sm font-semibold text-gray-700 dark:text-zinc-200 bg-gray-100 dark:bg-[#1c1c22] hover:bg-gray-200 dark:hover:bg-[#26262f] rounded-2xl"
            >
              Fechar
            </Button>
          </div>
        ) : mode === 'view' && event.log ? (
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

            {allowEdit && (
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
            {recoveredFromCameraCrash ? (
              <div className="p-3 bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/50 text-amber-900 dark:text-amber-200 rounded-xl text-xs flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                <span>
                  Seu celular fechou o aplicativo ao abrir a câmera externa. Use o botão abaixo para fotografar sem sair do app ou escolha da galeria.
                </span>
              </div>
            ) : wasRecovered ? (
              <div className="p-3 bg-indigo-50/90 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/50 text-indigo-800 dark:text-indigo-200 rounded-xl text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
                <span>Seu registro em andamento foi recuperado.</span>
              </div>
            ) : null}

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
                  onClick={() => {
                    hasLocalEditsRef.current = true;
                    setConsumption('normal');
                  }}
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
                  onClick={() => {
                    hasLocalEditsRef.current = true;
                    setConsumption('partial');
                  }}
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
                  onClick={() => {
                    hasLocalEditsRef.current = true;
                    setConsumption('none');
                  }}
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
                onChange={(e) => {
                  hasLocalEditsRef.current = true;
                  setMealTime(e.target.value);
                }}
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
                onChange={(e) => {
                  hasLocalEditsRef.current = true;
                  setDescription(e.target.value);
                }}
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
                onChange={(e) => {
                  hasLocalEditsRef.current = true;
                  setDrinkDescription(e.target.value);
                }}
              />
            </div>

            <div className="space-y-3">
              <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                Foto <span className="text-gray-400 dark:text-zinc-500 font-normal">(Opcional)</span>
              </label>

              {photoPreview ? (
                <div className="space-y-2">
                  <div className="relative rounded-2xl overflow-hidden bg-gray-100 dark:bg-[#1c1c22] aspect-video border border-gray-200 dark:border-white/[0.1]">
                    <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      disabled={loading}
                      onClick={handleRemovePhoto}
                      className="absolute top-2 right-2 min-w-[40px] min-h-[40px] p-2 bg-black/60 text-white rounded-full hover:bg-black/80 transition-colors disabled:opacity-50 flex items-center justify-center"
                      aria-label="Remover foto"
                      title="Remover foto"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  {(photoFile || uploadedPhotoPath) && (
                    <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                      Foto pronta. Agora você pode confirmar o registro da refeição.
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={loading}
                      className="w-full min-h-[48px] py-3 flex items-center justify-center gap-2 rounded-xl"
                      onClick={handlePrimaryTakePhoto}
                    >
                      <Camera className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      <span>Tirar foto</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={loading}
                      className="w-full min-h-[48px] py-3 flex items-center justify-center gap-2 rounded-xl"
                      onClick={handleTriggerGallery}
                    >
                      <ImageIcon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      <span>Da galeria</span>
                    </Button>
                  </div>
                  <div className="flex justify-center">
                    {preferInAppCamera ? (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => {
                          setInAppCameraPreferred(false);
                          setPreferInAppCamera(false);
                          setRecoveredFromCameraCrash(false);
                          handleTriggerNativeCamera();
                        }}
                        className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 underline-offset-2 hover:underline py-1"
                      >
                        Usar câmera do aparelho
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={handleOpenInAppCamera}
                        className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 underline-offset-2 hover:underline py-1"
                      >
                        Usar câmera no app
                      </button>
                    )}
                  </div>
                </div>
              )}

              <input
                type="file"
                accept="image/*"
                capture="environment"
                ref={cameraInputRef}
                data-testid="native-camera-input"
                className="hidden"
                onChange={handlePhotoSelect}
              />
              <input
                type="file"
                accept="image/*"
                ref={galleryInputRef}
                data-testid="gallery-input"
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
                onChange={(e) => {
                  hasLocalEditsRef.current = true;
                  setNotes(e.target.value);
                }}
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
      </BottomSheet>

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

      <InAppCameraModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCaptureConfirm={handlePhotoAccepted}
        onFallbackNativeCamera={handleTriggerNativeCamera}
        onFallbackGallery={handleTriggerGallery}
        requestMediaStream={requestMediaStream}
        captureFrame={captureFrame}
      />
    </>
  );
}
