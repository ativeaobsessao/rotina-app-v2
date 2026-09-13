CREATE TABLE IF NOT EXISTS public.daily_closures (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'closed',
    closed_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(patient_id, date)
);

-- Enable RLS
ALTER TABLE public.daily_closures ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view daily closures of their family"
    ON public.daily_closures
    FOR SELECT
    USING (family_id IN (
        SELECT family_id FROM public.profiles WHERE id = auth.uid()
    ));

CREATE POLICY "Users can insert daily closures for their family"
    ON public.daily_closures
    FOR INSERT
    WITH CHECK (family_id IN (
        SELECT family_id FROM public.profiles WHERE id = auth.uid()
    ) AND closed_by = auth.uid());
