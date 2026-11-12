import React, { useState } from 'react';
import { X, Heart, Smile, Sparkles, AlertTriangle, Check, CheckCircle2, MapPin } from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { triggerHapticFeedback } from '../../utils/haptics';
import { upsertDailyMoodLog, type DailyMoodLog } from '../../services/api';

interface MoodAndPainModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  familyId: string;
  profileId: string;
  patientName: string;
  dateStr: string;
  currentLog?: DailyMoodLog | null;
  onSuccess: (updatedLog: DailyMoodLog) => void;
  mode?: 'view' | 'edit';
}

const MOOD_OPTIONS = [
  { key: 'happy', emoji: '😊', title: 'Feliz e Animada', desc: 'Disposta, comunicativa e bem-humorada', color: 'border-emerald-500 bg-emerald-50/50 text-emerald-800' },
  { key: 'calm', emoji: '😌', title: 'Calma e Tranquila', desc: 'Serena, repousando em paz', color: 'border-indigo-500 bg-indigo-50/50 text-indigo-800' },
  { key: 'tired', emoji: '🥱', title: 'Cansada / Lenta', desc: 'Com sono ou pouca disposição física', color: 'border-amber-500 bg-amber-50/50 text-amber-800' },
  { key: 'sad', emoji: '😢', title: 'Triste ou Chorosa', desc: 'Sensível, quieta ou com saudades', color: 'border-blue-500 bg-blue-50/50 text-blue-800' },
  { key: 'agitated', emoji: '😣', title: 'Inquieta / Agitada', desc: 'Ansiosa, confusa ou com incômodo', color: 'border-rose-500 bg-rose-50/50 text-rose-800' },
] as const;

const PAIN_LEVELS = [
  { key: 'none', label: 'Sem dor', icon: '✨', desc: 'Confortável e sem queixas', activeClass: 'border-emerald-500 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500/20' },
  { key: 'mild', label: 'Dor leve', icon: '🟡', desc: 'Incômodo suportável', activeClass: 'border-amber-400 bg-amber-50 text-amber-900 ring-2 ring-amber-400/20' },
  { key: 'moderate', label: 'Dor moderada', icon: '🟠', desc: 'Dor perceptível', activeClass: 'border-orange-500 bg-orange-50 text-orange-900 ring-2 ring-orange-500/20' },
  { key: 'severe', label: 'Dor forte', icon: '🔴', desc: 'Reclama bastante ou chora', activeClass: 'border-rose-600 bg-rose-50 text-rose-900 ring-2 ring-rose-600/20' },
] as const;

const BODY_PARTS = [
  { key: 'head', label: 'Cabeça', emoji: '🧠' },
  { key: 'belly', label: 'Barriga / Estômago', emoji: '🤰' },
  { key: 'back', label: 'Costas / Coluna', emoji: '🦴' },
  { key: 'legs', label: 'Pernas / Joelhos', emoji: '🦵' },
  { key: 'chest', label: 'Peito / Tórax', emoji: '🫁' },
  { key: 'arms', label: 'Braços / Ombros', emoji: '💪' },
  { key: 'feet', label: 'Pés', emoji: '🦶' },
  { key: 'joints', label: 'Articulações / Geral', emoji: '🩹' },
] as const;

export function MoodAndPainModal({
  isOpen,
  onClose,
  patientId,
  familyId,
  profileId,
  patientName,
  dateStr,
  currentLog,
  onSuccess,
  mode = 'edit',
}: MoodAndPainModalProps) {
  const [currentMode, setCurrentMode] = useState<'view' | 'edit'>(currentLog && mode === 'view' ? 'view' : 'edit');
  const [selectedMood, setSelectedMood] = useState<DailyMoodLog['mood']>(currentLog?.mood || 'happy');
  const [painLevel, setPainLevel] = useState<DailyMoodLog['pain_level']>(currentLog?.pain_level || 'none');
  const [painLocations, setPainLocations] = useState<string[]>(currentLog?.pain_locations || []);
  const [notes, setNotes] = useState(currentLog?.notes || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const toggleLocation = (key: string) => {
    triggerHapticFeedback(25);
    setPainLocations(prev => 
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const handleSave = async () => {
    setLoading(true);
    setError('');

    try {
      const payload: DailyMoodLog = {
        patient_id: patientId,
        family_id: familyId,
        date: dateStr,
        mood: selectedMood,
        pain_level: painLevel,
        pain_locations: painLevel === 'none' ? [] : painLocations,
        notes: notes.trim() || null,
        updated_by: profileId,
      };

      const result = await upsertDailyMoodLog(payload);
      triggerHapticFeedback([40, 60, 40]);
      if (result) {
        onSuccess(result);
      }
      onClose();
    } catch (err: any) {
      console.error(err);
      setError('Não foi possível salvar o estado de espírito. Verifique sua conexão.');
    } finally {
      setLoading(false);
    }
  };

  const activeMoodObj = MOOD_OPTIONS.find(m => m.key === selectedMood);
  const activePainObj = PAIN_LEVELS.find(p => p.key === painLevel);

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={`Bem-estar de ${patientName}`}>
      <div className="space-y-6 pb-2">
        {error && (
          <div className="p-4 bg-rose-50 text-rose-700 text-xs font-semibold rounded-2xl border border-rose-100 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ─── MODO VISUALIZAÇÃO (Acolhedor para familiares) ─── */}
        {currentMode === 'view' && currentLog ? (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Card Principal de Resumo */}
            <div className="p-6 rounded-3xl bg-gradient-to-br from-indigo-50/80 via-white to-purple-50/60 border border-indigo-100/80 shadow-sm flex flex-col items-center text-center">
              <span className="text-5xl mb-3 transform hover:scale-110 transition-transform">
                {activeMoodObj?.emoji || '😊'}
              </span>
              <h3 className="text-xl font-bold text-gray-900 tracking-tight">
                {activeMoodObj?.title || 'Bem e tranquila'}
              </h3>
              <p className="text-xs text-gray-500 mt-1 max-w-xs leading-relaxed">
                {activeMoodObj?.desc}
              </p>

              {/* Tag de Dor */}
              <div className="mt-4 pt-4 border-t border-gray-100/80 w-full flex flex-col items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                  Condição Física
                </span>
                <span className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold ${
                  currentLog.pain_level === 'none' 
                    ? 'bg-emerald-100/70 text-emerald-800' 
                    : currentLog.pain_level === 'mild'
                    ? 'bg-amber-100 text-amber-900'
                    : 'bg-rose-100 text-rose-900'
                }`}>
                  <span>{activePainObj?.icon}</span>
                  <span>{activePainObj?.label}</span>
                </span>
              </div>
            </div>

            {/* Dores relatadas com Mapa Visual */}
            {currentLog.pain_level !== 'none' && currentLog.pain_locations?.length > 0 && (
              <div className="p-5 rounded-3xl bg-rose-50/50 border border-rose-100 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-rose-900 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-rose-600" />
                    Regiões com queixa de dor:
                  </h4>
                  <span className="text-[11px] font-semibold text-rose-600 bg-rose-100/80 px-2 py-0.5 rounded-full">
                    {currentLog.pain_locations.length} {currentLog.pain_locations.length === 1 ? 'área' : 'áreas'}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {currentLog.pain_locations.map(locKey => {
                    const part = BODY_PARTS.find(b => b.key === locKey);
                    return (
                      <div key={locKey} className="flex items-center gap-2 p-2.5 bg-white rounded-2xl border border-rose-100 shadow-2xs text-xs font-semibold text-gray-800">
                        <span className="text-base">{part?.emoji || '🩹'}</span>
                        <span className="truncate">{part?.label || locKey}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Observações da Cuidadora */}
            {currentLog.notes && (
              <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100 text-xs text-gray-600 leading-relaxed">
                <span className="font-bold text-gray-700 block mb-1">Recado / Observação:</span>
                "{currentLog.notes}"
              </div>
            )}

            <div className="pt-2 flex flex-col gap-2">
              <Button
                onClick={() => setCurrentMode('edit')}
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-2xl shadow-md"
              >
                Atualizar Bem-estar de Hoje
              </Button>
              <Button
                variant="ghost"
                onClick={onClose}
                className="w-full py-3.5 text-xs text-gray-500 font-medium rounded-2xl"
              >
                Fechar
              </Button>
            </div>
          </div>
        ) : (
          /* ─── MODO EDIÇÃO (Ultra simples para cuidadora) ─── */
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* ETAPA 1: ESTADO DE ESPÍRITO */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2.5">
                1. Como {patientName} está hoje?
              </label>
              <div className="grid grid-cols-1 gap-2">
                {MOOD_OPTIONS.map(opt => {
                  const isSelected = selectedMood === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => {
                        triggerHapticFeedback(25);
                        setSelectedMood(opt.key);
                      }}
                      className={`w-full flex items-center justify-between p-3.5 rounded-2xl border transition-all text-left ${
                        isSelected 
                          ? `${opt.color} border-2 shadow-sm scale-[1.01]` 
                          : 'border-gray-100 bg-white hover:bg-gray-50/80 text-gray-700'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{opt.emoji}</span>
                        <div>
                          <p className="text-sm font-bold leading-tight">{opt.title}</p>
                          <p className="text-[11px] opacity-75 mt-0.5 leading-snug">{opt.desc}</p>
                        </div>
                      </div>
                      {isSelected && <Check className="w-4 h-4 shrink-0 text-current font-bold" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ETAPA 2: NÍVEL DE DOR */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2.5">
                2. Sente alguma dor física?
              </label>
              <div className="grid grid-cols-2 gap-2">
                {PAIN_LEVELS.map(lvl => {
                  const isSelected = painLevel === lvl.key;
                  return (
                    <button
                      key={lvl.key}
                      type="button"
                      onClick={() => {
                        triggerHapticFeedback(25);
                        setPainLevel(lvl.key);
                      }}
                      className={`p-3 rounded-2xl border transition-all text-left flex flex-col justify-between ${
                        isSelected 
                          ? lvl.activeClass 
                          : 'border-gray-100 bg-white hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full mb-1">
                        <span className="text-base">{lvl.icon}</span>
                        {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-current" />}
                      </div>
                      <p className="text-xs font-bold leading-tight">{lvl.label}</p>
                      <p className="text-[10px] opacity-70 mt-0.5">{lvl.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ETAPA 3: ONDE DÓI? (APENAS SE HOUVER DOR) */}
            {painLevel !== 'none' && (
              <div className="p-4 rounded-3xl bg-rose-50/40 border border-rose-100/80 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-rose-900 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-rose-600" />
                    3. Onde ela(e) apontou dor?
                  </label>
                  <span className="text-[10px] font-semibold text-rose-500">Toque nas partes</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {BODY_PARTS.map(part => {
                    const isChecked = painLocations.includes(part.key);
                    return (
                      <button
                        key={part.key}
                        type="button"
                        onClick={() => toggleLocation(part.key)}
                        className={`flex items-center justify-between p-3 rounded-2xl border transition-all text-xs font-bold ${
                          isChecked 
                            ? 'bg-rose-500 text-white border-rose-600 shadow-xs' 
                            : 'bg-white text-gray-700 border-gray-200/80 hover:bg-rose-50/40'
                        }`}
                      >
                        <span className="flex items-center gap-2 truncate">
                          <span className="text-base">{part.emoji}</span>
                          <span className="truncate">{part.label}</span>
                        </span>
                        {isChecked && <Check className="w-3.5 h-3.5 shrink-0 text-white" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ETAPA 4: RECADINHO / OBSERVAÇÕES (OPCIONAL) */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                Algum recado para a família? <span className="font-normal text-gray-400 lowercase">(opcional)</span>
              </label>
              <input
                type="text"
                placeholder="Ex: Começou a reclamar após o banho..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 rounded-2xl border border-gray-100 text-xs font-medium text-gray-900 outline-none focus:border-indigo-500 focus:bg-white transition-all"
              />
            </div>

            {/* BOTÃO SALVAR */}
            <div className="pt-2">
              <Button
                onClick={handleSave}
                disabled={loading}
                className="w-full py-4 text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl shadow-lg shadow-indigo-600/25 active:scale-[0.98] transition-all"
              >
                {loading ? <Spinner className="text-white w-5 h-5" /> : 'Salvar Bem-Estar de Hoje'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
