import React, { useEffect, useState } from 'react';
import { getMyFamilyMemberships, getPatient, setActiveFamily, getPatientPhotoUrl, getDailyMoodLog, type DailyMoodLog } from '../services/api';
import { supabase } from '../services/supabase';
import { getLocalDateString } from '../utils/date';
import { Spinner } from '../components/ui/Spinner';
import { User, LogOut, Sparkles, Heart } from 'lucide-react';

export function ContextSelectorScreen({ onSelect, initialPatients }: { onSelect: () => void, initialPatients?: any[] }) {
  const [loading, setLoading] = useState(!initialPatients);
  const [patients, setPatients] = useState<Array<{ id: string, name: string, photo: string | null, familyId: string, gender: string | null, mood?: DailyMoodLog | null }>>(initialPatients || []);
  const [error, setError] = useState('');
  const [switching, setSwitching] = useState<string | null>(null);
  const [moods, setMoods] = useState<Record<string, DailyMoodLog | null>>({});

  useEffect(() => {
    // 1. Instant hydration from cached patients to avoid any splash/waiting
    const cachedPatientsStr = localStorage.getItem('duca_cached_context_patients');
    if (cachedPatientsStr && (!patients || patients.length === 0)) {
      try {
        const parsed = JSON.parse(cachedPatientsStr);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setPatients(parsed);
          setLoading(false);
        }
      } catch (e) {
        // Ignore JSON error
      }
    }

    loadPatients();
  }, [initialPatients]);

  async function loadPatients() {
    try {
      const memberships = await getMyFamilyMemberships();
      
      // PARALLEL FETCHING
      const loadedPatientsUnfiltered = await Promise.all(
        memberships.map(async (m) => {
          const pat = await getPatient(m.family_id);
          if (!pat) return null;
          
          let picUrl = null;
          if (pat.photo_url) {
            picUrl = await getPatientPhotoUrl(pat.id, pat.photo_url);
          }
          
          return {
            id: pat.id,
            name: pat.name,
            photo: picUrl,
            familyId: m.family_id,
            gender: pat.gender
          };
        })
      );
      
      const loadedPatients = loadedPatientsUnfiltered.filter((p) => p !== null) as any;
      const uniquePatients = Array.from(new Map(loadedPatients.map((p: any) => [p.id, p])).values());
      setPatients(uniquePatients);

      // Carrega o estado de espírito do dia atual para cada paciente
      const todayStr = getLocalDateString();
      const moodEntries = await Promise.all(
        uniquePatients.map(async (p: any) => {
          const mLog = await getDailyMoodLog(p.id, todayStr);
          return [p.id, mLog] as const;
        })
      );
      setMoods(Object.fromEntries(moodEntries));

      try {
        localStorage.setItem('duca_cached_context_patients', JSON.stringify(uniquePatients));
      } catch (e) {
        // quota exceeded fallback
      }
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
      <div className="flex h-[100dvh] items-center justify-center bg-gray-50 dark:bg-gray-950 transition-colors"></div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-gray-50 dark:bg-gray-950 transition-colors items-center py-16 px-6">
      <div className="w-full max-w-sm space-y-12">
        <div className="text-center">
          {patients.length > 1 ? (
            <>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
                Como está a sua família hoje?
              </h1>
              <p className="text-gray-500 mt-3 font-medium">
                Escolha quem você vai acompanhar agora.
              </p>
            </>
          ) : patients.length === 1 ? (
            <>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
                {patients[0].gender === 'F' ? 'Como está a ' : patients[0].gender === 'M' ? 'Como está o ' : 'Como está a rotina de '}{patients[0].name}?
              </h1>
              <p className="text-gray-500 mt-3 font-medium">
                Veja como está a rotina {patients[0].gender === 'F' ? 'dela' : patients[0].gender === 'M' ? 'dele' : 'hoje'}.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
                Bem-vindo
              </h1>
              <p className="text-gray-500 mt-3 font-medium">
                Nenhum familiar cadastrado no momento.
              </p>
            </>
          )}
        </div>

        {error && (
          <div className="text-red-600 text-sm font-medium bg-red-50 p-4 rounded-2xl border border-red-100 text-center">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {patients.length === 0 && !error ? (
            <div className="text-center py-10 bg-white dark:bg-gray-900 transition-colors rounded-3xl border border-gray-100 shadow-sm">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">Nenhum familiar disponível</h3>
              <p className="text-sm text-gray-500 max-w-xs mx-auto">
                Você ainda não possui acesso a nenhum familiar cadastrado.
              </p>
            </div>
          ) : (
            patients.map((pat) => {
              const mLog = moods[pat.id];
              
              // Gerador empático da frase do balão de estado
              let bubbleText = `Como está ${pat.name} hoje? ✨`;
              let bubbleEmoji = '👵';
              let bubbleBorder = 'border-gray-100 dark:border-gray-800';
              let bubbleBg = 'bg-white/95 dark:bg-gray-800/90 text-gray-700 dark:text-gray-200';
              let bubbleBadge = 'Toque para acompanhar';

              if (mLog) {
                const painPartsMap: Record<string, string> = {
                  head: 'dor de cabeça',
                  belly: 'dor na barriga',
                  back: 'dor nas costas',
                  legs: 'dor nas pernas',
                  chest: 'dor no peito',
                  arms: 'dor nos braços',
                  feet: 'dor nos pés',
                  joints: 'dores no corpo',
                };

                const painList = (mLog.pain_locations || [])
                  .map(k => painPartsMap[k] || k)
                  .join(' e ');

                if (mLog.mood === 'happy') {
                  bubbleEmoji = '😊';
                  if (mLog.pain_level === 'none') {
                    bubbleText = `Hoje ${pat.name} está animada e sem dores 🙏`;
                    bubbleBorder = 'border-emerald-200/80 dark:border-emerald-900/60 shadow-emerald-500/10';
                    bubbleBg = 'bg-emerald-50/90 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200';
                    bubbleBadge = 'Bem e sem dor';
                  } else {
                    bubbleText = `Hoje ${pat.name} está bem disposta, mas com queixa de ${painList || 'dor leve'}.`;
                    bubbleBorder = 'border-amber-200/80 dark:border-amber-900/60';
                    bubbleBg = 'bg-amber-50/90 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200';
                    bubbleBadge = 'Atenção a dor';
                  }
                } else if (mLog.mood === 'calm') {
                  bubbleEmoji = '😌';
                  if (mLog.pain_level === 'none') {
                    bubbleText = `Hoje ${pat.name} está tranquila, serena e sem dores 🕊️`;
                    bubbleBorder = 'border-indigo-200/80 dark:border-indigo-900/60';
                    bubbleBg = 'bg-indigo-50/90 dark:bg-indigo-950/60 text-indigo-900 dark:text-indigo-200';
                    bubbleBadge = 'Dia calmo';
                  } else {
                    bubbleText = `Hoje ${pat.name} está repousando com queixa de ${painList || 'dor'}.`;
                    bubbleBorder = 'border-amber-200/80';
                    bubbleBg = 'bg-amber-50/90 text-amber-900';
                    bubbleBadge = 'Repouso';
                  }
                } else if (mLog.mood === 'tired') {
                  bubbleEmoji = '🥱';
                  bubbleText = mLog.pain_level === 'none' 
                    ? `Hoje ${pat.name} está mais cansadinha e dormindo mais 💤`
                    : `Hoje ${pat.name} está sonolenta e relatou ${painList || 'dor'}.`;
                  bubbleBorder = 'border-amber-200/80';
                  bubbleBg = 'bg-amber-50/90 text-amber-900';
                  bubbleBadge = 'Pouca energia';
                } else if (mLog.mood === 'sad') {
                  bubbleEmoji = '😢';
                  bubbleText = mLog.pain_level === 'none'
                    ? `Hoje ${pat.name} está mais quieta e sensível com saudades 💛`
                    : `Hoje ${pat.name} está chateadinha com ${painList || 'dor'}.`;
                  bubbleBorder = 'border-blue-200/80';
                  bubbleBg = 'bg-blue-50/90 text-blue-900';
                  bubbleBadge = 'Carinho especial';
                } else if (mLog.mood === 'agitated') {
                  bubbleEmoji = '😣';
                  bubbleText = `Hoje ${pat.name} está mais agitada ou queixando-se de ${painList || 'desconforto'}.`;
                  bubbleBorder = 'border-rose-200/80';
                  bubbleBg = 'bg-rose-50/90 text-rose-900';
                  bubbleBadge = 'Desconforto';
                }
              }

              return (
                <div key={pat.id} className="relative flex flex-col items-center">
                  {/* Balão de Fala Empático Conectado ao Avatar */}
                  <div className={`relative mb-3.5 max-w-[290px] px-4 py-2.5 rounded-2xl border backdrop-blur-md shadow-md text-xs font-semibold leading-snug flex items-center gap-2.5 animate-in fade-in slide-in-from-bottom-2 duration-300 ${bubbleBorder} ${bubbleBg}`}>
                    <span className="text-xl shrink-0">{bubbleEmoji}</span>
                    <span className="flex-1">{bubbleText}</span>
                    {/* Triângulo apontando para o avatar */}
                    <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-inherit border-r border-b border-inherit rotate-45"></div>
                  </div>

                  {/* Card de Toque do Paciente */}
                  <button
                    onClick={() => handleSelect(pat.id, pat.familyId)}
                    disabled={switching !== null}
                    className="w-full bg-white dark:bg-gray-900 transition-colors p-6 rounded-[2rem] shadow-sm border border-gray-100/60 dark:border-gray-800 hover:shadow-md hover:border-indigo-200 transition-all active:scale-[0.98] flex flex-col items-center justify-center space-y-4 relative overflow-hidden group"
                  >
                    <div className="relative">
                      <div className="w-24 h-24 rounded-full bg-gray-50 dark:bg-gray-950 transition-colors flex items-center justify-center border-2 border-indigo-100 dark:border-gray-800 overflow-hidden shadow-sm group-hover:scale-105 transition-transform">
                        {pat.photo ? (
                          <img src={pat.photo} alt={pat.name} className="w-full h-full object-cover" />
                        ) : (
                          <User className="w-10 h-10 text-gray-400" />
                        )}
                      </div>
                      {mLog && (
                        <span className="absolute -bottom-1 -right-1 text-lg bg-white dark:bg-gray-900 p-1 rounded-full shadow-sm border border-gray-100 dark:border-gray-800">
                          {bubbleEmoji}
                        </span>
                      )}
                    </div>
                    
                    <div className="text-center">
                      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">
                        {pat.name}
                      </h2>
                      <span className="inline-block mt-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-0.5 rounded-full">
                        {bubbleBadge}
                      </span>
                    </div>
                    
                    {switching === pat.id && (
                      <div className="absolute inset-0 bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm flex items-center justify-center">
                        <Spinner className="w-8 h-8 text-indigo-600" />
                      </div>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
        
        <div className="pt-8 text-center">
           <button 
             onClick={async () => {
                await supabase.auth.signOut();
                window.location.href = '/';
             }} 
             className="inline-flex items-center text-sm text-gray-400 hover:text-gray-600 font-medium transition-colors"
           >
             <LogOut className="w-4 h-4 mr-2" />
             Sair da conta
           </button>
        </div>
      </div>
    </div>
  );
}
