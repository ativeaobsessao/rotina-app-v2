import React, { useEffect, useRef, useState } from 'react';
import {
  getMyFamilyMemberships,
  getPatient,
  setActiveFamily,
  getPatientPhotoUrl,
  getDailyMoodLog,
  type DailyMoodLog,
} from '../services/api';
import { supabase } from '../services/supabase';
import { getLocalDateString } from '../utils/date';
import { LaunchIntro } from '../components/ui/LaunchIntro';
import { Spinner } from '../components/ui/Spinner';
import { PWAInstallBanner } from '../components/pwa/PWAInstallBanner';
import { User, LogOut, ChevronRight } from 'lucide-react';

const CACHED_MOODS_KEY = 'duca_cached_context_moods';

export interface SelectedContextPatient {
  id: string;
  name: string;
  photo: string | null;
  familyId: string;
  gender: string | null;
}

function readCachedPatients(): SelectedContextPatient[] {
  try {
    const raw = localStorage.getItem('duca_cached_context_patients');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readCachedMoodsForToday(): Record<string, DailyMoodLog | null> {
  try {
    const raw = localStorage.getItem(CACHED_MOODS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const todayStr = getLocalDateString();
    if (parsed?.date === todayStr && parsed?.moods && typeof parsed.moods === 'object') {
      return parsed.moods;
    }
    localStorage.removeItem(CACHED_MOODS_KEY);
  } catch {}
  return {};
}

function writeCachedMoodsForToday(
  todayStr: string,
  moodsMap: Record<string, DailyMoodLog | null>
) {
  try {
    localStorage.setItem(CACHED_MOODS_KEY, JSON.stringify({ date: todayStr, moods: moodsMap }));
  } catch {}
}

export function ContextSelectorScreen({
  onSelect,
  initialPatients,
}: {
  onSelect: (patient?: SelectedContextPatient) => void;
  initialPatients?: SelectedContextPatient[];
}) {
  const seedPatients =
    initialPatients && initialPatients.length > 0 ? initialPatients : readCachedPatients();

  const [loading, setLoading] = useState(seedPatients.length === 0);
  const [patients, setPatients] = useState<SelectedContextPatient[]>(seedPatients);
  const [error, setError] = useState('');
  const [switching, setSwitching] = useState<string | null>(null);
  const [moods, setMoods] = useState<Record<string, DailyMoodLog | null>>(() =>
    readCachedMoodsForToday()
  );
  const isMountedRef = useRef(true);
  const loadedOnceRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    if (!loadedOnceRef.current) {
      loadedOnceRef.current = true;
      void loadPatients();
    }
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (initialPatients && initialPatients.length > 0 && patients.length === 0) {
      setPatients(initialPatients);
      setLoading(false);
    }
  }, [initialPatients, patients.length]);

  async function loadPatients() {
    try {
      const todayStr = getLocalDateString();
      const cachedPhotoById = new Map<string, string | null>(
        (patients || []).map((p) => [p.id, p.photo || null])
      );

      // Se já temos familiares em cache, busca o bem-estar imediatamente em paralelo
      const initialIds = (patients || []).map((p) => p.id).filter(Boolean);
      const earlyMoodPromise =
        initialIds.length > 0
          ? Promise.all(
              initialIds.map(async (id) => {
                const mLog = await getDailyMoodLog(id, todayStr);
                return [id, mLog] as const;
              })
            ).then((entries) => {
              if (!isMountedRef.current) return {};
              const nextMap = Object.fromEntries(entries);
              setMoods((prev) => {
                const merged = { ...prev, ...nextMap };
                writeCachedMoodsForToday(todayStr, merged);
                return merged;
              });
              return nextMap;
            })
          : null;

      const memberships = await getMyFamilyMemberships();
      if (!isMountedRef.current) return;

      // Carrega os dados principais dos familiares em paralelo sem bloquear pelas fotos
      const loadedPatientsRaw = await Promise.all(
        memberships.map(async (m) => {
          const pat = await getPatient(m.family_id);
          if (!pat) return null;
          return {
            id: pat.id,
            name: pat.name,
            photo: cachedPhotoById.get(pat.id) ?? null,
            familyId: m.family_id,
            gender: pat.gender || null,
            _photoPath: pat.photo_url || null,
          };
        })
      );

      if (!isMountedRef.current) return;

      const filtered = loadedPatientsRaw.filter(Boolean) as Array<
        SelectedContextPatient & { _photoPath?: string | null }
      >;
      const uniqueMap = new Map<string, SelectedContextPatient & { _photoPath?: string | null }>();
      for (const item of filtered) {
        if (!uniqueMap.has(item.id)) uniqueMap.set(item.id, item);
      }

      const uniquePatients: SelectedContextPatient[] = Array.from(uniqueMap.values()).map(
        ({ _photoPath: _ignored, ...rest }) => rest
      );

      setPatients(uniquePatients);
      setLoading(false);

      try {
        localStorage.setItem('duca_cached_context_patients', JSON.stringify(uniquePatients));
      } catch {}

      // Atualiza URLs assinadas das fotos em segundo plano sem travar a entrada
      void Promise.all(
        Array.from(uniqueMap.values()).map(async (item) => {
          if (!item._photoPath) return null;
          const signedUrl = await getPatientPhotoUrl(item.id, item._photoPath).catch(() => null);
          return signedUrl ? ([item.id, signedUrl] as const) : null;
        })
      ).then((photoEntries) => {
        if (!isMountedRef.current) return;
        const validPhotos = photoEntries.filter(Boolean) as Array<readonly [string, string]>;
        if (validPhotos.length === 0) return;
        const photoMap = new Map(validPhotos);
        setPatients((prev) => {
          const next = prev.map((p) => (photoMap.has(p.id) ? { ...p, photo: photoMap.get(p.id)! } : p));
          try {
            localStorage.setItem('duca_cached_context_patients', JSON.stringify(next));
          } catch {}
          return next;
        });
      });

      const earlyMoods = earlyMoodPromise ? await earlyMoodPromise : {};
      if (!isMountedRef.current) return;

      const missingPatients = uniquePatients.filter((p) => !(p.id in earlyMoods));
      if (missingPatients.length > 0) {
        const missingEntries = await Promise.all(
          missingPatients.map(async (p) => {
            const mLog = await getDailyMoodLog(p.id, todayStr);
            return [p.id, mLog] as const;
          })
        );
        if (!isMountedRef.current) return;
        const finalMoods = { ...earlyMoods, ...Object.fromEntries(missingEntries) };
        setMoods(finalMoods);
        writeCachedMoodsForToday(todayStr, finalMoods);
      } else {
        const activeIds = new Set(uniquePatients.map((p) => p.id));
        const filteredMoods = Object.fromEntries(
          Object.entries(earlyMoods).filter(([id]) => activeIds.has(id))
        );
        setMoods(filteredMoods);
        writeCachedMoodsForToday(todayStr, filteredMoods);
      }
    } catch (err: any) {
      if (!isMountedRef.current) return;
      setError(err?.message || 'Não foi possível carregar os familiares vinculados.');
      setLoading(false);
    }
  }

  async function handleSelect(patient: SelectedContextPatient) {
    if (switching !== null) return;
    setError('');
    setSwitching(patient.id);
    try {
      // O backend RLS e o RPC validam se auth.uid() pertence ao familyId.
      await setActiveFamily(patient.familyId);
      try {
        sessionStorage.setItem('duca_context_selected', '1');
      } catch {}
      onSelect(patient);
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err?.message || 'Acesso negado ou erro ao abrir esta rotina.');
        setSwitching(null);
      }
    }
  }

  if (loading) {
    return <LaunchIntro />;
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-gray-50 dark:bg-[#09090b] transition-colors items-center py-14 px-6 animate-in fade-in duration-150">
      <div className="w-full max-w-sm space-y-10">
        <div className="text-center">
          {patients.length > 1 ? (
            <>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">
                Como está a sua família hoje?
              </h1>
              <p className="text-gray-500 dark:text-zinc-400 mt-2.5 text-sm font-medium">
                Toque no perfil que você deseja acompanhar agora.
              </p>
            </>
          ) : patients.length === 1 ? (
            <>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">
                {patients[0].gender === 'F'
                  ? 'Como está a '
                  : patients[0].gender === 'M'
                  ? 'Como está o '
                  : 'Como está a rotina de '}
                {patients[0].name}?
              </h1>
              <p className="text-gray-500 dark:text-zinc-400 mt-2.5 text-sm font-medium">
                Toque para abrir a rotina{' '}
                {patients[0].gender === 'F' ? 'dela' : patients[0].gender === 'M' ? 'dele' : 'de hoje'}.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">
                Bem-vindo
              </h1>
              <p className="text-gray-500 dark:text-zinc-400 mt-2.5 text-sm font-medium">
                Nenhum familiar cadastrado no momento.
              </p>
            </>
          )}
        </div>

        {error && (
          <div className="text-red-600 dark:text-rose-300 text-sm font-medium bg-red-50 dark:bg-rose-950/40 p-4 rounded-2xl border border-red-100 dark:border-rose-900/50 text-center">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {patients.length === 0 && !error ? (
            <div className="text-center py-10 bg-white dark:bg-[#121216] transition-colors rounded-3xl border border-gray-100 dark:border-white/[0.08] shadow-sm">
              <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100 mb-2">
                Nenhum familiar disponível
              </h3>
              <p className="text-sm text-gray-500 dark:text-zinc-400 max-w-xs mx-auto">
                Você ainda não possui acesso a nenhum familiar cadastrado.
              </p>
            </div>
          ) : (
            patients.map((pat) => {
              const mLog = moods[pat.id];
              const cleanNote = mLog?.notes?.trim() || '';
              const isSwitchingThis = switching === pat.id;

              let bubbleText = `Como está ${pat.name} hoje? ✨`;
              let bubbleEmoji = '👵';
              let bubbleBorder = 'border-gray-100 dark:border-white/[0.1]';
              let bubbleBg = 'bg-white/95 dark:bg-[#18181e] text-gray-700 dark:text-zinc-200';
              let statusHint = 'Abrir rotina de hoje';

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
                  .map((k) => painPartsMap[k] || k)
                  .join(' e ');

                if (mLog.mood === 'happy') {
                  bubbleEmoji = '😊';
                  if (mLog.pain_level === 'none') {
                    bubbleText = `Hoje ${pat.name} está animada e sem dores 🙏`;
                    bubbleBorder =
                      'border-emerald-200/80 dark:border-emerald-800/50 shadow-emerald-500/10';
                    bubbleBg =
                      'bg-emerald-50/90 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200';
                    statusHint = 'Bem e sem dor · Toque para abrir';
                  } else {
                    bubbleText = `Hoje ${pat.name} está bem disposta, mas com queixa de ${painList || 'dor leve'}.`;
                    bubbleBorder = 'border-amber-200/80 dark:border-amber-800/50';
                    bubbleBg =
                      'bg-amber-50/90 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200';
                    statusHint = 'Atenção a dor · Toque para abrir';
                  }
                } else if (mLog.mood === 'calm') {
                  bubbleEmoji = '😌';
                  if (mLog.pain_level === 'none') {
                    bubbleText = `Hoje ${pat.name} está tranquila, serena e sem dores 🕊️`;
                    bubbleBorder = 'border-indigo-200/80 dark:border-indigo-800/50';
                    bubbleBg =
                      'bg-indigo-50/90 dark:bg-indigo-950/60 text-indigo-900 dark:text-indigo-200';
                    statusHint = 'Dia calmo · Toque para abrir';
                  } else {
                    bubbleText = `Hoje ${pat.name} está repousando com queixa de ${painList || 'dor'}.`;
                    bubbleBorder = 'border-amber-200/80 dark:border-amber-800/50';
                    bubbleBg =
                      'bg-amber-50/90 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200';
                    statusHint = 'Repouso · Toque para abrir';
                  }
                } else if (mLog.mood === 'tired') {
                  bubbleEmoji = '🥱';
                  bubbleText =
                    mLog.pain_level === 'none'
                      ? `Hoje ${pat.name} está mais cansadinha e dormindo mais 💤`
                      : `Hoje ${pat.name} está sonolenta e relatou ${painList || 'dor'}.`;
                  bubbleBorder = 'border-amber-200/80 dark:border-amber-800/50';
                  bubbleBg =
                    'bg-amber-50/90 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200';
                  statusHint = 'Pouca energia · Toque para abrir';
                } else if (mLog.mood === 'sad') {
                  bubbleEmoji = '😢';
                  bubbleText =
                    mLog.pain_level === 'none'
                      ? `Hoje ${pat.name} está mais quieta e sensível com saudades 💛`
                      : `Hoje ${pat.name} está chateadinha com ${painList || 'dor'}.`;
                  bubbleBorder = 'border-blue-200/80 dark:border-blue-800/50';
                  bubbleBg =
                    'bg-blue-50/90 dark:bg-blue-950/60 text-blue-900 dark:text-blue-200';
                  statusHint = 'Carinho especial · Toque para abrir';
                } else if (mLog.mood === 'agitated') {
                  bubbleEmoji = '😣';
                  bubbleText = `Hoje ${pat.name} está mais agitada ou queixando-se de ${painList || 'desconforto'}.`;
                  bubbleBorder = 'border-rose-200/80 dark:border-rose-800/50';
                  bubbleBg =
                    'bg-rose-50/90 dark:bg-rose-950/60 text-rose-900 dark:text-rose-200';
                  statusHint = 'Desconforto · Toque para abrir';
                }
              }

              return (
                <div key={pat.id} className="relative flex flex-col items-center">
                  {/* Balão empático conectado ao avatar */}
                  <div
                    className={`relative mb-3.5 max-w-[300px] px-4 py-2.5 rounded-2xl border backdrop-blur-md shadow-sm text-xs font-semibold leading-snug flex flex-col animate-in fade-in slide-in-from-bottom-1 duration-200 ${bubbleBorder} ${bubbleBg}`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-xl shrink-0">{bubbleEmoji}</span>
                      <span className="flex-1">{bubbleText}</span>
                    </div>
                    {cleanNote && (
                      <div className="mt-2 pt-1.5 border-t border-black/5 dark:border-white/10 flex items-start gap-1.5 text-[11px] font-medium opacity-80 leading-snug">
                        <span className="shrink-0 text-[11px]">💬</span>
                        <span className="line-clamp-2 italic">“{cleanNote}”</span>
                      </div>
                    )}
                    <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-inherit border-r border-b border-inherit rotate-45"></div>
                  </div>

                  {/* Card de seleção em 1 toque */}
                  <button
                    type="button"
                    onClick={() => handleSelect(pat)}
                    disabled={switching !== null}
                    aria-label={`Acompanhar rotina de ${pat.name}`}
                    className={`w-full bg-white dark:bg-[#121216] p-6 rounded-[2rem] shadow-sm border transition-all duration-150 flex flex-col items-center justify-center space-y-4 relative overflow-hidden group active:scale-[0.985] ${
                      isSwitchingThis
                        ? 'border-indigo-400 dark:border-indigo-500 ring-2 ring-indigo-500/20'
                        : 'border-gray-200/70 dark:border-white/[0.08] hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-500/40'
                    } ${switching !== null && !isSwitchingThis ? 'opacity-50' : ''}`}
                  >
                    <div className="relative">
                      <div className="w-24 h-24 rounded-full bg-gray-50 dark:bg-[#1c1c22] transition-transform duration-150 flex items-center justify-center border-2 border-indigo-100 dark:border-white/[0.1] overflow-hidden shadow-sm group-hover:scale-[1.03]">
                        {pat.photo ? (
                          <img src={pat.photo} alt={pat.name} className="w-full h-full object-cover" />
                        ) : (
                          <User className="w-10 h-10 text-gray-400 dark:text-zinc-500" />
                        )}
                      </div>
                      {mLog && (
                        <span className="absolute -bottom-1 -right-1 text-lg bg-white dark:bg-[#18181e] p-1 rounded-full shadow-sm border border-gray-100 dark:border-white/[0.1]">
                          {bubbleEmoji}
                        </span>
                      )}
                    </div>

                    <div className="text-center space-y-1">
                      <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100 tracking-tight">
                        {pat.name}
                      </h2>
                      <div className="inline-flex items-center justify-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                        {isSwitchingThis ? (
                          <>
                            <Spinner className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                            <span>Abrindo rotina...</span>
                          </>
                        ) : (
                          <>
                            <span>{statusHint}</span>
                            <ChevronRight className="w-3.5 h-3.5 opacity-70 group-hover:translate-x-0.5 transition-transform" />
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="pt-6 text-center">
          <button
            type="button"
            onClick={async () => {
              try {
                sessionStorage.removeItem('duca_context_selected');
                localStorage.removeItem(CACHED_MOODS_KEY);
                localStorage.removeItem('duca_cached_context_patients');
                localStorage.removeItem('duca_active_flow_until');
              } catch {}
              await supabase.auth.signOut();
              window.location.href = '/';
            }}
            className="inline-flex items-center text-sm text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300 font-medium transition-colors"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sair da conta
          </button>
        </div>
      </div>
      <PWAInstallBanner />
    </div>
  );
}
