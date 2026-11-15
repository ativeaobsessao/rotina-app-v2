import React, { useState, useRef, useEffect } from 'react';
import { Camera, Image as ImageIcon, X } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Spinner } from '../components/ui/Spinner';
import {
  getCurrentProfile,
  createPatient,
  updatePatient,
  uploadPatientPhoto,
  seedInitialRoutine,
} from '../services/api';
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
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      const objectUrl = URL.createObjectURL(file);
      objectUrlRef.current = objectUrl;
      setPhotoFile(file);
      setPhotoPreview(objectUrl);
    }
  };

  const handleStart = async () => {
    if (loading) return;
    if (!name.trim()) {
      setError('Por favor, informe o nome.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const profile = await getCurrentProfile();
      if (!profile) throw new Error('Perfil não encontrado');

      const patientData = {
        family_id: profile.family_id,
        name: name.trim(),
      };

      const patient = await createPatient(patientData);
      if (!patient) throw new Error('Falha ao criar o perfil.');

      if (photoFile) {
        try {
          const compressed = await compressImage(photoFile);
          const fileName = `${Date.now()}.jpg`;
          const uploadData = await uploadPatientPhoto(patient.id, compressed, fileName);
          await updatePatient(patient.id, { photo_url: uploadData.path });
        } catch (photoErr) {
          console.error('Failed to upload photo:', photoErr);
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
    <div className="flex h-screen flex-col bg-gray-50 dark:bg-[#09090b] p-6 items-center justify-center">
      <div className="w-full max-w-md space-y-8 bg-white dark:bg-[#121216] p-8 rounded-3xl shadow-sm border border-gray-100 dark:border-white/[0.08] text-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">
            Bem-vindo ao DUCA
          </h1>
          <p className="text-gray-500 dark:text-zinc-400 mt-2">
            Vamos configurar a rotina. Primeiro, quem estamos acompanhando?
          </p>
        </div>

        {error && (
          <div className="text-red-600 dark:text-rose-300 text-sm bg-red-50 dark:bg-rose-950/40 dark:border dark:border-rose-800/50 p-3 rounded-xl">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <Input
            placeholder="Nome da pessoa (ex: Dona Maria)"
            value={name}
            disabled={loading}
            onChange={(e) => setName(e.target.value)}
          />

          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-900 dark:text-zinc-100 block text-left">
              Foto <span className="text-gray-400 dark:text-zinc-500 font-normal">(Opcional)</span>
            </label>
            {showPhotoMenu ? (
              <div className="p-4 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-[#1c1c22] space-y-2 animate-in fade-in duration-200 text-left">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => {
                    cameraInputRef.current?.click();
                    setShowPhotoMenu(false);
                  }}
                >
                  <Camera className="w-5 h-5 mr-3 text-gray-500 dark:text-zinc-400" /> Tirar foto
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => {
                    galleryInputRef.current?.click();
                    setShowPhotoMenu(false);
                  }}
                >
                  <ImageIcon className="w-5 h-5 mr-3 text-gray-500 dark:text-zinc-400" /> Escolher da galeria
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => setShowPhotoMenu(false)}
                >
                  Cancelar
                </Button>
              </div>
            ) : photoPreview ? (
              <div className="relative w-32 h-32 mx-auto rounded-full overflow-hidden bg-gray-100 dark:bg-[#1c1c22] border-2 border-gray-200 dark:border-white/[0.12]">
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
                  }}
                  className="absolute inset-0 bg-black/50 text-white flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setShowPhotoMenu(true)}
              >
                <Camera className="w-5 h-5 mr-2 text-gray-500 dark:text-zinc-400" /> Adicionar foto
              </Button>
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
        </div>

        <Button
          type="button"
          className="w-full"
          size="lg"
          onClick={handleStart}
          disabled={loading || !name.trim()}
        >
          {loading ? <Spinner className="text-white dark:text-zinc-950" /> : 'Começar'}
        </Button>
      </div>
    </div>
  );
}
