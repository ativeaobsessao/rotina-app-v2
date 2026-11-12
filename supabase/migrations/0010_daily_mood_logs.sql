-- MIGRATION 0010: DAILY MOOD AND PAIN LOGS (ESTADO DE ESPÍRITO E DORES)

CREATE TABLE IF NOT EXISTS public.daily_mood_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    mood TEXT NOT NULL CHECK (mood IN ('happy', 'calm', 'tired', 'sad', 'agitated')),
    pain_level TEXT NOT NULL CHECK (pain_level IN ('none', 'mild', 'moderate', 'severe')),
    pain_locations TEXT[] DEFAULT '{}', -- ex: ['head', 'back', 'legs', 'belly', 'chest', 'arms', 'joints']
    notes TEXT,
    updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(patient_id, date)
);

-- Habilitar Row Level Security
ALTER TABLE public.daily_mood_logs ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS: Membros da família podem visualizar e registrar
CREATE POLICY "Membros da família podem visualizar o estado de espírito"
  ON public.daily_mood_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.family_members
      WHERE family_members.family_id = daily_mood_logs.family_id
        AND family_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Membros da família podem registrar ou atualizar o estado de espírito"
  ON public.daily_mood_logs
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.family_members
      WHERE family_members.family_id = daily_mood_logs.family_id
        AND family_members.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.family_members
      WHERE family_members.family_id = daily_mood_logs.family_id
        AND family_members.user_id = auth.uid()
    )
  );

-- Índice para buscas ultra-rápidas por paciente e data
CREATE INDEX IF NOT EXISTS idx_daily_mood_patient_date ON public.daily_mood_logs(patient_id, date);
