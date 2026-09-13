import React, { useState, useRef, useEffect } from 'react';
import { Camera, Image as ImageIcon, X } from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';
import { updatePatient, uploadPatientPhoto, deleteStorageFile } from '../../services/api';
import { compressImage } from '../../utils/image';

interface PatientEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  patient: any;
  currentPhotoUrl: string | null;
  onSuccess: () => void;
}

export function PatientEditModal({ isOpen, onClose, patient, currentPhotoUrl, onSuccess }: PatientEditModalProps) {
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'M' | 'F' | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [showPhotoMenu, setShowPhotoMenu] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && patient) {
      setName(patient.name);
      setGender(patient.gender || null);
      setPhotoPreview(currentPhotoUrl);
      setPhotoFile(null);
      setShowPhotoMenu(false);
      setError('');
    }
  }, [isOpen, patient, currentPhotoUrl]);

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setPhotoFile(file);
      const objectUrl = URL.createObjectURL(file);
      setPhotoPreview(objectUrl);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('O nome não pode ficar vazio.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const updateData: any = {
        name: name.trim(),
        gender: gender,
      };

      if (photoFile) {
        const compressed = await compressImage(photoFile);
        const fileName = `${Date.now()}.jpg`;
        const uploadData = await uploadPatientPhoto(patient.id, compressed, fileName);
        
        if (patient.photo_url) {
          await deleteStorageFile('patient-profile', patient.photo_url);
        }
        
        updateData.photo_url = (uploadData as any).path;
      } else if (photoPreview === null) {
        // If there is no file and preview is explicitly cleared (null), remove the photo
        updateData.photo_url = null;
      }

      await updatePatient(patient.id, updateData);

      onSuccess();
    } catch (err) {
      console.error(err);
      setError('Não foi possível salvar. Verifique sua conexão.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Editar Perfil">
      <div className="space-y-6">
        {error && <div className="p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>}

        <div className="space-y-3">
          <label className="text-sm font-semibold text-gray-900">Nome</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome" />
        </div>


        <div className="space-y-3">
          <label className="text-sm font-semibold text-gray-900 block text-left">Como devemos nos referir?</label>
          <div className="flex gap-3">
            <button
              onClick={() => setGender('M')}
              className={`flex-1 py-3 px-4 rounded-xl border font-medium transition-all ${gender === 'M' ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:border-indigo-300'}`}
            >
              Ele (O)
            </button>
            <button
              onClick={() => setGender('F')}
              className={`flex-1 py-3 px-4 rounded-xl border font-medium transition-all ${gender === 'F' ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-gray-700 border-gray-200 hover:border-indigo-300'}`}
            >
              Ela (A)
            </button>
          </div>
        </div>
        <div className="space-y-3">
          <label className="text-sm font-semibold text-gray-900 block text-left">Foto <span className="text-gray-400 font-normal">(Opcional)</span></label>
          
          {showPhotoMenu ? (
            <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 space-y-2 animate-in fade-in duration-200">
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
            <div className="relative w-32 h-32 mx-auto rounded-full overflow-hidden bg-gray-100 border-2 border-gray-200">
              <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
              <button 
                onClick={() => { setPhotoPreview(null); setPhotoFile(null); }}
                className="absolute inset-0 bg-black/50 text-white flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          ) : (
            <Button variant="outline" className="w-full" onClick={() => setShowPhotoMenu(true)}>
              <Camera className="w-5 h-5 mr-2 text-gray-500" /> Alterar foto
            </Button>
          )}

          <input type="file" accept="image/*" capture="environment" ref={cameraInputRef} className="hidden" onChange={handlePhotoSelect} />
          <input type="file" accept="image/*" ref={galleryInputRef} className="hidden" onChange={handlePhotoSelect} />
        </div>

        <div className="pt-4">
          <Button className="w-full" size="lg" onClick={handleSave} disabled={loading || !name.trim()}>
            {loading ? <Spinner className="text-white" /> : 'Salvar'}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
