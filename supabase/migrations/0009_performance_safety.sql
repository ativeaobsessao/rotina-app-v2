-- 1. Fix Race Condition in Admin Removal
CREATE OR REPLACE FUNCTION public.remove_family_member(p_user_id UUID, p_family_id UUID)
RETURNS void AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_admin_count INT;
  v_target_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  -- LOCK the family row to prevent concurrent modifications (Race Condition fix)
  PERFORM 1 FROM public.families WHERE id = p_family_id FOR UPDATE;

  SELECT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = p_family_id AND user_id = auth.uid() AND role = 'ADMIN'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Apenas administradores podem remover membros.';
  END IF;

  SELECT role INTO v_target_role
  FROM public.family_members
  WHERE family_id = p_family_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membro não encontrado nesta família.';
  END IF;

  IF v_target_role = 'ADMIN' THEN
    SELECT count(*) INTO v_admin_count
    FROM public.family_members
    WHERE family_id = p_family_id AND role = 'ADMIN';
    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'Este usuário é o único administrador da família e não pode ser removido.';
    END IF;
  END IF;

  DELETE FROM public.family_members
  WHERE family_id = p_family_id AND user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Prevent Phantom Mutations (Triggers)
CREATE OR REPLACE FUNCTION check_daily_closure_status()
RETURNS TRIGGER AS $$
DECLARE
  v_is_closed BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.daily_closures 
    WHERE patient_id = NEW.patient_id 
      AND date = NEW.event_date 
      AND status = 'closed'
  ) INTO v_is_closed;
  
  IF v_is_closed THEN
    RAISE EXCEPTION 'Não é possível modificar registros de um dia que já foi encerrado.';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_meal_mutation_on_closed_day ON public.meal_logs;
CREATE TRIGGER prevent_meal_mutation_on_closed_day
BEFORE INSERT OR UPDATE ON public.meal_logs
FOR EACH ROW EXECUTE FUNCTION check_daily_closure_status();

DROP TRIGGER IF EXISTS prevent_med_mutation_on_closed_day ON public.medication_logs;
CREATE TRIGGER prevent_med_mutation_on_closed_day
BEFORE INSERT OR UPDATE ON public.medication_logs
FOR EACH ROW EXECUTE FUNCTION check_daily_closure_status();
