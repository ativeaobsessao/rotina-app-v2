// @ts-nocheck

import React, { useState, useRef } from 'react';
import { Camera, Image as ImageIcon, X } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Spinner } from '../components/ui/Spinner';
import { getCurrentProfile, createPatient, updatePatient, uploadPatientPhoto, seedInitialRoutine } from '../services/api';
import { compressImage } from '../utils/image';

interface SetupScreenProps {
  onComplete: () => void;
}

export function SetupScreen({ onComplete }: SetupScreenProps) {
  const [name, setName] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
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

  const handleStart = async () => {
    if (!name.trim()) {
      setError('Por favor, informe o nome.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const profile = await getCurrentProfile();
      if (!profile) throw new Error("Perfil não encontrado");

      const patientData: any = {
        family_id: profile.family_id,
        name: name.trim(),
      };

      const patient = await createPatient(patientData);

      if (photoFile) {
        try {
          const compressed = await compressImage(photoFile);
          const fileName = `${Date.now()}.jpg`;
          const uploadData = await uploadPatientPhoto(patient.id, compressed, fileName);
          await updatePatient(patient.id, { photo_url: uploadData.path });
        } catch (photoErr) {
          console.error("Failed to upload photo:", photoErr);
        }
      }

      await seedInitialRoutine(patient.id);

      onComplete();
    } catch (err) {
      console.error(err);
      setError('Ocorreu um erro ao salvar os dados.');
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-gray-50 p-6 items-center justify-center">
      <div className="w-full max-w-md space-y-8 bg-white p-8 rounded-3xl shadow-sm border border-gray-100 text-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Bem-vindo ao DUDE</h1>
          <p className="text-gray-500 mt-2">Vamos configurar a rotina. Primeiro, quem estamos acompanhando?</p>
        </div>

        {error && <div className="text-red-600 text-sm bg-red-50 p-3 rounded-xl">{error}</div>}

        <div className="space-y-4">
          <Input 
            placeholder="Nome da pessoa (ex: Dona Maria)" 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
          />

          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-900 block text-left">Foto <span className="text-gray-400 font-normal">(Opcional)</span></label>
            {showPhotoMenu ? (
              <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 space-y-2 animate-in fade-in duration-200 text-left">
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
                <Camera className="w-5 h-5 mr-2 text-gray-500" /> Adicionar foto
              </Button>
            )}

            <input type="file" accept="image/*" capture="environment" ref={cameraInputRef} className="hidden" onChange={handlePhotoSelect} />
            <input type="file" accept="image/*" ref={galleryInputRef} className="hidden" onChange={handlePhotoSelect} />
          </div>
        </div>

        <Button className="w-full" size="lg" onClick={handleStart} disabled={loading || !name.trim()}>
          {loading ? <Spinner className="text-white" /> : 'Começar'}
        </Button>
      </div>
    </div>
  );
}
