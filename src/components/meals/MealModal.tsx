import React, { useState, useRef } from 'react';
import { Camera, Image as ImageIcon, X } from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';
import { cn } from '../../utils/cn';
import { compressImage } from '../../utils/image';
import { createMealLog, updateMealLog, uploadMealPhoto, deleteStorageFile } from '../../services/api';
import type { MealEventData } from '../../types/timeline';

interface MealModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: MealEventData;
  patientId: string;
  profileId: string;
  eventDate: string;
  onSuccess: () => void;
}

export function MealModal({ isOpen, onClose, event, patientId, profileId, eventDate, onSuccess }: MealModalProps) {
  const isEditing = !!event.log;
  const [mode, setMode] = useState<'view' | 'edit'>(isEditing ? 'view' : 'edit');
  const [consumption, setConsumption] = useState<'normal' | 'partial' | 'none'>(
    event.log?.consumption_status || 'normal'
  );
  const [description, setDescription] = useState(event.log?.description || '');
  const [notes, setNotes] = useState(event.log?.notes || '');
  
  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  
  const initialTime = event.log?.meal_time 
    ? event.log.meal_time.substring(0, 5)
    : currentTime;
  const [mealTime, setMealTime] = useState(initialTime);

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(event.photoSignedUrl || null);
  const [showPhotoMenu, setShowPhotoMenu] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setPhotoFile(file);
      const objectUrl = URL.createObjectURL(file);
      setPhotoPreview(objectUrl);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setError('');
    
    try {
      let photoUrl = event.log?.photo_url || null;
      
      if (!photoPreview && !photoFile) {
        if (event.log?.photo_url) {
          await deleteStorageFile('meal-records', event.log.photo_url);
        }
        photoUrl = null;
      }

      if (photoFile) {
        try {
          const compressed = await compressImage(photoFile, 1920); // Better quality
          const fileName = `${eventDate}_${event.id}_${Date.now()}.jpg`;
          const uploadData = await uploadMealPhoto(patientId, compressed, fileName);
          
          // Delete old photo if it exists to prevent storage bloat
          if (event.log?.photo_url) {
            await deleteStorageFile('meal-records', event.log.photo_url);
          }
          
          photoUrl = (uploadData as any).path;
        } catch (uploadErr) {
          console.error("Photo upload failed:", uploadErr);
          throw new Error("Falha ao enviar a foto da refeição. Verifique sua conexão e tente novamente.");
        }
      }

      const logData = {
        meal_config_id: event.id,
        patient_id: patientId,
        event_date: eventDate,
        consumption_status: consumption,
        description: description || null,
        notes: notes || null,
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

      onSuccess();
    } catch (err) {
      console.error(err);
      setError("Não foi possível salvar. Verifique sua conexão e tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={event.title}>
      <div className="space-y-6">
        
        {mode === 'view' && event.log ? (
          <div className="space-y-6">
            {event.photoSignedUrl && (
              <div className="w-full aspect-[4/3] bg-gray-100 rounded-2xl overflow-hidden relative">
                <img src={event.photoSignedUrl} alt={event.title} className="w-full h-full object-cover" />
              </div>
            )}
            
            <div className="bg-gray-50 rounded-2xl p-5 space-y-4">
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Status</span>
                <p className="font-medium text-gray-900">
                  {event.log.consumption_status === 'normal' ? 'Comeu normalmente' : event.log.consumption_status === 'partial' ? 'Comeu parcialmente' : 'Não comeu'}
                </p>
              </div>
              
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Horário</span>
                <p className="font-medium text-gray-900">
                  {event.log.meal_time ? event.log.meal_time.substring(0, 5) : 'Não informado'}
                </p>
              </div>

              {event.log.description && (
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">O que comeu</span>
                  <p className="font-medium text-gray-900">{event.log.description}</p>
                </div>
              )}

              {event.log.notes && (
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Observações</span>
                  <p className="font-medium text-gray-900">{event.log.notes}</p>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="border-t border-gray-100 pt-4">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Registro Original</h4>
                <div className="flex items-center text-sm">
                  <span className="mr-2 opacity-70">👤</span>
                  <span className="font-medium text-gray-900">{event.log.creator?.name || 'Familiar'}</span>
                </div>
                <div className="text-xs text-gray-500 pl-6 mt-0.5">
                  Registrado às {new Date(event.log.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>

              {event.log.updated_by !== event.log.created_by && (
                <div className="border-t border-gray-100 pt-4">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Última Alteração</h4>
                  <div className="flex items-center text-sm">
                    <span className="mr-2 opacity-70">👤</span>
                    <span className="font-medium text-gray-900">{event.log.updater?.name || 'Familiar'}</span>
                  </div>
                  <div className="text-xs text-gray-500 pl-6 mt-0.5">
                    Alterado às {new Date(event.log.updated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
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
          <div className="p-3 bg-red-50 text-red-700 rounded-xl text-sm">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <label className="text-sm font-semibold text-gray-900">Como foi a refeição?</label>
          <div className="grid grid-cols-1 gap-2">
            <button
              onClick={() => setConsumption('normal')}
              className={cn(
                "p-4 rounded-xl border text-left flex items-center space-x-3 transition-colors",
                consumption === 'normal' ? "bg-green-50 border-green-200" : "bg-white border-gray-200"
              )}
            >
              <div className={cn("w-5 h-5 rounded-full border-2 flex items-center justify-center", consumption === 'normal' ? "border-green-500" : "border-gray-300")}>
                {consumption === 'normal' && <div className="w-2.5 h-2.5 bg-green-500 rounded-full" />}
              </div>
              <span className={cn("font-medium", consumption === 'normal' ? "text-green-900" : "text-gray-700")}>Comeu normalmente</span>
            </button>
            <button
              onClick={() => setConsumption('partial')}
              className={cn(
                "p-4 rounded-xl border text-left flex items-center space-x-3 transition-colors",
                consumption === 'partial' ? "bg-yellow-50 border-yellow-200" : "bg-white border-gray-200"
              )}
            >
              <div className={cn("w-5 h-5 rounded-full border-2 flex items-center justify-center", consumption === 'partial' ? "border-yellow-500" : "border-gray-300")}>
                {consumption === 'partial' && <div className="w-2.5 h-2.5 bg-yellow-500 rounded-full" />}
              </div>
              <span className={cn("font-medium", consumption === 'partial' ? "text-yellow-900" : "text-gray-700")}>Comeu parcialmente</span>
            </button>
            <button
              onClick={() => setConsumption('none')}
              className={cn(
                "p-4 rounded-xl border text-left flex items-center space-x-3 transition-colors",
                consumption === 'none' ? "bg-red-50 border-red-200" : "bg-white border-gray-200"
              )}
            >
              <div className={cn("w-5 h-5 rounded-full border-2 flex items-center justify-center", consumption === 'none' ? "border-red-500" : "border-gray-300")}>
                {consumption === 'none' && <div className="w-2.5 h-2.5 bg-red-500 rounded-full" />}
              </div>
              <span className={cn("font-medium", consumption === 'none' ? "text-red-900" : "text-gray-700")}>Não comeu</span>
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-sm font-semibold text-gray-900">Horário da Refeição</label>
          <Input 
            type="time"
            value={mealTime}
            onChange={(e) => setMealTime(e.target.value)}
          />
        </div>

        <div className="space-y-3">
          <label className="text-sm font-semibold text-gray-900">O que ela comeu? <span className="text-gray-400 font-normal">(Opcional)</span></label>
          <Input 
            placeholder="Ex: Arroz, feijão, frango e salada." 
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="space-y-3">
          <label className="text-sm font-semibold text-gray-900">Foto <span className="text-gray-400 font-normal">(Opcional)</span></label>
          
          {showPhotoMenu ? (
            <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 space-y-2 animate-in fade-in duration-200">
              <p className="text-sm font-medium text-gray-900 mb-3 text-center">Adicionar foto</p>
              <Button variant="outline" className="w-full justify-start" onClick={() => { cameraInputRef.current?.click(); setShowPhotoMenu(false); }}>
                <Camera className="w-5 h-5 mr-3 text-gray-500" /> Tirar foto
              </Button>
              <Button variant="outline" className="w-full justify-start" onClick={() => { galleryInputRef.current?.click(); setShowPhotoMenu(false); }}>
                <ImageIcon className="w-5 h-5 mr-3 text-gray-500" /> Escolher da galeria
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setShowPhotoMenu(false)}>
                Cancelar
              </Button>
            </div>
          ) : photoPreview ? (
            <div className="relative rounded-xl overflow-hidden bg-gray-100 aspect-video">
              <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
              <button 
                onClick={() => { setPhotoPreview(null); setPhotoFile(null); }}
                className="absolute top-2 right-2 p-2 bg-black/50 text-white rounded-full hover:bg-black/70"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <div className="flex space-x-3">
              <Button 
                variant="outline" 
                className="flex-1"
                onClick={() => setShowPhotoMenu(true)}
              >
                <Camera className="w-5 h-5 mr-2 text-gray-500" />
                Inserir foto
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
          <label className="text-sm font-semibold text-gray-900">Observação <span className="text-gray-400 font-normal">(Opcional)</span></label>
          <Input 
            placeholder="Alguma observação?" 
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="pt-4">
          <Button 
            className="w-full" 
            size="lg" 
            onClick={handleSave}
            disabled={loading}
          >
            {loading ? <Spinner className="text-white" /> : 'Confirmar Refeição'}
          </Button>
        </div>
        </>
      )}
      </div>
    </BottomSheet>
  );
}
