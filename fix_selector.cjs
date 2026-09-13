const fs = require('fs');
let code = `import React, { useEffect, useState } from 'react';
import { getMyFamilyMemberships, getPatient, setActiveFamily, getPatientPhotoUrl } from '../services/api';
import { Spinner } from '../components/ui/Spinner';
import { User } from 'lucide-react';

export function ContextSelectorScreen({ onSelect }: { onSelect: () => void }) {
  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState<Array<{ id: string, name: string, photo: string | null, familyId: string }>>([]);
  const [error, setError] = useState('');
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    loadPatients();
  }, []);

  async function loadPatients() {
    try {
      const memberships = await getMyFamilyMemberships();
      const loadedPatients = [];
      
      for (const m of memberships) {
        const pat = await getPatient(m.family_id);
        if (pat) {
          let picUrl = null;
          if (pat.photo_url) {
            picUrl = await getPatientPhotoUrl(pat.id, pat.photo_url);
          }
          loadedPatients.push({
            id: pat.id,
            name: pat.name,
            photo: picUrl,
            familyId: m.family_id
          });
        }
      }
      setPatients(loadedPatients);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar pacientes');
    } finally {
      setLoading(false);
    }
  }

  async function handleSelect(patientId: string, familyId: string) {
    setSwitching(patientId);
    try {
      // O backend RLS e o RPC validam se auth.uid() pertence ao familyId.
      await setActiveFamily(familyId);
      onSelect();
    } catch (err: any) {
      setError(err.message || 'Acesso negado ou erro ao selecionar paciente.');
      setSwitching(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-gray-50">
        <Spinner className="w-8 h-8 text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-gray-50 items-center py-16 px-6">
      <div className="w-full max-w-sm space-y-12">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            Quem você vai acompanhar hoje?
          </h1>
          <p className="text-gray-500 mt-3 font-medium">
            Selecione um paciente para continuar
          </p>
        </div>

        {error && (
          <div className="text-red-600 text-sm font-medium bg-red-50 p-4 rounded-2xl border border-red-100 text-center">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {patients.length === 0 && !error ? (
            <div className="text-center py-10 bg-white rounded-3xl border border-gray-100 shadow-sm">
              <h3 className="text-lg font-bold text-gray-900 mb-2">Nenhum paciente disponível</h3>
              <p className="text-sm text-gray-500 max-w-xs mx-auto">
                Você ainda não possui acesso a nenhum paciente.
              </p>
            </div>
          ) : (
            patients.map((pat) => (
              <button
                key={pat.id}
                onClick={() => handleSelect(pat.id, pat.familyId)}
                disabled={switching !== null}
                className="w-full bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100/50 hover:shadow-md hover:border-gray-200 transition-all active:scale-[0.98] flex flex-col items-center justify-center space-y-4 relative overflow-hidden group"
              >
                <div className="w-24 h-24 rounded-full bg-gray-50 flex items-center justify-center border border-gray-100 overflow-hidden shadow-inner">
                  {pat.photo ? (
                    <img src={pat.photo} alt={pat.name} className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-10 h-10 text-gray-400" />
                  )}
                </div>
                
                <h2 className="text-xl font-bold text-gray-900 tracking-tight">
                  {pat.name}
                </h2>
                
                {switching === pat.id && (
                  <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center">
                    <Spinner className="w-8 h-8 text-indigo-600" />
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
`;
fs.writeFileSync('src/pages/ContextSelector.tsx', code);
