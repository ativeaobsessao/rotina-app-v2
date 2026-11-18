import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { isRlsPermissionError, isTransientNetworkError } from '../src/services/api.ts';
import {
  addToSyncQueue,
  processSyncQueue,
  type SyncItem,
  type SyncQueueAdapter,
} from '../src/services/syncQueue.ts';
import { MealModal } from '../src/components/meals/MealModal.tsx';
import { MedicationModal } from '../src/components/medications/MedicationModal.tsx';
import { HistoryDayGroup } from '../src/pages/History.tsx';
import type { MealEventData, MedicationEventData } from '../src/types/timeline.ts';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://duca.local/',
  });
  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  (globalThis as any).Node = dom.window.Node;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
  return dom;
}

const MIGRATION_0014_PATH = path.resolve('supabase/migrations/0014_rbac_and_rls_hardening.sql');
const VERIFY_SQL_PATH = path.resolve('supabase/tests/verify_etapa3_rls.sql');

// ============================================================================
// 1. TESTES ESTÁTICOS DE MIGRATION SQL (não substituem execução em PostgreSQL real)
// ============================================================================

test('[Estático SQL] Migration 0014 é 100% idempotente: toda CREATE POLICY possui DROP POLICY IF EXISTS prévio', () => {
  const sql = fs.readFileSync(MIGRATION_0014_PATH, 'utf8');

  // Captura todas as instruções CREATE POLICY "Nome" ... ON schema.tabela
  const createPolicyRegex = /CREATE POLICY\s+"([^"]+)"\s+ON\s+([a-zA-Z0-9_.]+)/g;
  const createdPolicies: Array<{ name: string; table: string; index: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = createPolicyRegex.exec(sql)) !== null) {
    createdPolicies.push({
      name: match[1],
      table: match[2],
      index: match.index,
    });
  }

  assert.ok(createdPolicies.length >= 25, 'Esperado conjunto completo de políticas RLS na migration 0014');

  for (const policy of createdPolicies) {
    const precededSql = sql.slice(0, policy.index);
    const expectedDrop = `DROP POLICY IF EXISTS "${policy.name}" ON ${policy.table};`;
    assert.ok(
      precededSql.includes(expectedDrop),
      `Faltou "${expectedDrop}" antes de CREATE POLICY "${policy.name}" ON ${policy.table}`
    );
  }

  assert.equal(/DROP TABLE/i.test(sql), false);
  assert.equal(/TRUNCATE/i.test(sql), false);
});

test('[Estático SQL] Migration 0014 valida pré-requisitos da 0006 e implementa fail-closed sem fallback para profiles', () => {
  const sql = fs.readFileSync(MIGRATION_0014_PATH, 'utf8');

  // Pré-requisito explícito da migration 0006 antes das alterações
  assert.match(sql, /to_regclass\('public\.family_members'\)\s+IS\s+NULL/);
  assert.match(sql, /column_name\s+IN\s*\('family_id',\s*'user_id',\s*'role'\)/);
  assert.match(sql, /migration 0006_family_members\.sql/i);

  // Funções críticas fail-closed: nunca consultam public.profiles para autorizar papel/pertencimento
  const extractFn = (name: string) => {
    const m = sql.match(
      new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([^)]*\\)[\\s\\S]*?END;\\s*\\$\\$;`)
    );
    assert.ok(m, `Função ${name} não encontrada na 0014`);
    return m[0];
  };

  const userInFamily = extractFn('user_in_family');
  assert.match(userInFamily, /IF to_regclass\('public\.family_members'\) IS NULL THEN\s+RETURN FALSE;\s*END IF;/);
  assert.equal(/FROM public\.profiles/i.test(userInFamily), false);

  const userIsAdmin = extractFn('user_is_family_admin');
  assert.match(userIsAdmin, /IF to_regclass\('public\.family_members'\) IS NULL THEN\s+RETURN FALSE;\s*END IF;/);
  assert.equal(/FROM public\.profiles/i.test(userIsAdmin), false);

  const currentFamily = extractFn('get_current_family_id');
  assert.match(currentFamily, /IF to_regclass\('public\.family_members'\) IS NULL THEN\s+RETURN NULL;\s*END IF;/);
  assert.match(currentFamily, /JOIN public\.family_members/);

  const storageRead = extractFn('user_can_access_storage_path');
  assert.match(storageRead, /IF second_segment = auth\.uid\(\)::text THEN\s+RETURN TRUE;/);
  assert.match(storageRead, /IF to_regclass\('public\.family_members'\) IS NULL THEN\s+RETURN FALSE;\s*END IF;/);
  assert.equal(/FROM public\.profiles/i.test(storageRead), false);

  const switchTrigger = extractFn('prevent_unauthorized_profile_family_switch');
  assert.match(switchTrigger, /IF to_regclass\('public\.family_members'\) IS NULL THEN[\s\S]*?RAISE EXCEPTION/);
});

test('[Estático SQL] family_members e family_invites bloqueiam escrita direta, protegem RPCs e ajustam pgcrypto dinamicamente', () => {
  const sql = fs.readFileSync(MIGRATION_0014_PATH, 'utf8');

  // family_members / family_invites sem políticas permissivas de escrita
  assert.ok(sql.includes('REVOKE INSERT, UPDATE, DELETE ON public.family_members FROM anon, authenticated;'));
  assert.ok(sql.includes('REVOKE INSERT, UPDATE, DELETE ON public.family_invites FROM anon, authenticated;'));
  assert.equal(/CREATE POLICY[^\n]+ON public\.family_members[\s\S]*?FOR (INSERT|UPDATE|DELETE|ALL)/i.test(sql), false);
  assert.equal(/CREATE POLICY[^\n]+ON public\.family_invites[\s\S]*?FOR (INSERT|UPDATE|DELETE|ALL)/i.test(sql), false);

  // Detecção real de schema do pgcrypto via pg_extension/pg_namespace para convites
  assert.match(sql, /FROM pg_extension e\s+JOIN pg_namespace n ON n\.oid = e\.extnamespace\s+WHERE e\.extname = 'pgcrypto'/);
  assert.match(sql, /ALTER FUNCTION public\.create_family_invite\(\) SET search_path = %s/);
  assert.match(sql, /ALTER FUNCTION public\.accept_family_invite\(text\) SET search_path = %s/);

  // Privilégios EXECUTE bloqueados para PUBLIC e anon em funções auxiliares e RPCs
  for (const fnSig of [
    'public.user_in_family(UUID)',
    'public.user_is_family_admin(UUID)',
    'public.get_current_family_id()',
    'public.user_can_access_storage_path(text)',
    'public.user_can_write_storage_path(text, text)',
    'public.set_active_family(uuid)',
    'public.remove_family_member(uuid, uuid)',
    'public.create_family_invite()',
    'public.accept_family_invite(text)',
    'public.revoke_family_invite(uuid)',
    'public.update_family_member_role(uuid, uuid, text)',
  ]) {
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION ${fnSig} FROM PUBLIC, anon;`));
    assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION ${fnSig} TO authenticated, service_role;`));
  }
});

test('[Estático SQL] Integridade de autoria dos registros e roteiro SQL real seguro (ROLLBACK)', () => {
  const sql = fs.readFileSync(MIGRATION_0014_PATH, 'utf8');
  const verifySql = fs.readFileSync(VERIFY_SQL_PATH, 'utf8');

  // Autoria nas políticas RLS de meal_logs, medication_logs, daily_mood_logs e daily_closures
  assert.match(sql, /ON public\.meal_logs[\s\S]*?FOR INSERT[\s\S]*?created_by = auth\.uid\(\)\s+AND updated_by = auth\.uid\(\)/);
  assert.match(sql, /ON public\.meal_logs[\s\S]*?FOR UPDATE[\s\S]*?WITH CHECK \([\s\S]*?updated_by = auth\.uid\(\)/);
  assert.match(sql, /ON public\.medication_logs[\s\S]*?FOR INSERT[\s\S]*?created_by = auth\.uid\(\)\s+AND updated_by = auth\.uid\(\)/);
  assert.match(sql, /ON public\.medication_logs[\s\S]*?FOR UPDATE[\s\S]*?WITH CHECK \([\s\S]*?updated_by = auth\.uid\(\)/);
  assert.match(sql, /ON public\.daily_mood_logs[\s\S]*?FOR INSERT[\s\S]*?updated_by = auth\.uid\(\)/);
  assert.match(sql, /ON public\.daily_mood_logs[\s\S]*?FOR UPDATE[\s\S]*?WITH CHECK \([\s\S]*?updated_by = auth\.uid\(\)/);
  assert.match(sql, /ON public\.daily_closures[\s\S]*?FOR INSERT[\s\S]*?closed_by = auth\.uid\(\)/);

  // Trigger preservando created_by original em UPDATE
  assert.match(sql, /CREATE TRIGGER preserve_meal_log_creator\s+BEFORE UPDATE ON public\.meal_logs/);
  assert.match(sql, /CREATE TRIGGER preserve_medication_log_creator\s+BEFORE UPDATE ON public\.medication_logs/);

  // Roteiro SQL real de homologação contém transação segura com ROLLBACK e cenários A..F
  assert.match(verifySql, /^\s*--[\s\S]*?BEGIN;[\s\S]*?ROLLBACK;\s*$/);
  for (const marker of ['TESTE A', 'TESTE B', 'TESTE C', 'TESTE D', 'TESTE E', 'TESTE F']) {
    assert.ok(verifySql.includes(marker), `Cenário ${marker} ausente em verify_etapa3_rls.sql`);
  }
  assert.ok(verifySql.includes('storage.objects'));
});

// ============================================================================
// 2. TESTES UNITÁRIOS (API & FILA OFFLINE COM ERROS 42501 / RLS)
// ============================================================================

test('[Unitário] api.ts & syncQueue.ts rejeitam RLS 42501 sem enfileirar offline e marcam item como failed', async () => {
  const rlsErr = { code: '42501', message: 'new row violates row-level security policy for table "meal_logs"' };
  assert.equal(isRlsPermissionError(rlsErr), true);
  assert.equal(isTransientNetworkError(rlsErr), false);

  let queue: SyncItem[] = [];
  const adapter: SyncQueueAdapter = {
    getQueue: async () => queue.map((q) => ({ ...q })),
    saveQueue: async (items) => {
      queue = items.map((q) => ({ ...q }));
    },
    getSessionUserId: async () => 'member-user',
    isOnline: () => true,
    client: {
      from: () => ({
        insert: () => ({
          select: () => ({
            maybeSingle: async () => ({ data: null, error: rlsErr }),
          }),
        }),
      }),
    },
  };

  await addToSyncQueue(
    'createMealLog',
    {
      patient_id: 'p1',
      meal_config_id: 'mc1',
      event_date: '2026-11-16',
      consumption_status: 'normal',
      created_by: 'member-user',
    },
    { patientId: 'p1', eventDate: '2026-11-16', userId: 'member-user' },
    adapter
  );

  const res = await processSyncQueue({ adapter });
  assert.equal(res.processed, 0);
  assert.equal(res.failed, 1);
  assert.equal(res.remainingPending, 0);
  assert.equal(queue[0].status, 'failed');
  assert.match(queue[0].lastError || '', /Sem permissão/);
});

// ============================================================================
// 3. TESTES REACT/JSDOM (UI RBAC PARA MEMBER vs ADMIN)
// ============================================================================

test('[React/JSDOM] MealModal impõe modo somente leitura quando conta não possui permissão ativa de registro (pendente e registrado com foto)', async () => {
  const dom = setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  const unloggedMeal: MealEventData = {
    id: 'mc-pending',
    type: 'meal',
    time: '12:00:00',
    title: 'Almoço',
    status: 'pending',
    mealConfig: { id: 'mc-pending', name: 'Almoço', scheduled_time: '12:00:00' },
    log: null,
  };

  const loggedMeal: MealEventData = {
    id: 'mc-done',
    type: 'meal',
    time: '08:00:00',
    title: 'Café da manhã',
    status: 'confirmed',
    mealConfig: { id: 'mc-done', name: 'Café da manhã', scheduled_time: '08:00:00' },
    photoSignedUrl: 'https://duca.local/meal-photo.jpg',
    log: {
      id: 'log-1',
      consumption_status: 'normal',
      description: 'Mamão e pão integral',
      drink_description: 'Chá de camomila',
      notes: 'Aceitou bem',
      meal_time: '08:15:00',
      created_by: 'admin-1',
      created_at: '2026-11-16T11:15:00.000Z',
    },
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(MealModal, {
          isOpen: true,
          onClose: () => {},
          event: unloggedMeal,
          patientId: 'pat-1',
          profileId: 'member-1',
          eventDate: '2026-11-16',
          canEdit: false,
          onSuccess: () => {},
        })
      );
    });

    const pendingText = container.textContent || '';
    assert.match(pendingText, /Aguardando registro/);
    assert.equal(pendingText.includes('Confirmar Refeição'), false);
    assert.equal(container.querySelectorAll('input').length, 0);

    await act(async () => {
      root.render(
        React.createElement(MealModal, {
          isOpen: true,
          onClose: () => {},
          event: loggedMeal,
          patientId: 'pat-1',
          profileId: 'member-1',
          eventDate: '2026-11-16',
          canEdit: false,
          onSuccess: () => {},
        })
      );
    });

    const loggedText = container.textContent || '';
    assert.match(loggedText, /Mamão e pão integral/);
    assert.match(loggedText, /Chá de camomila/);
    assert.match(loggedText, /Toque para ampliar/);
    assert.equal(loggedText.includes('EDITAR REGISTRO'), false);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('[React/JSDOM] MedicationModal impõe modo somente leitura quando conta não possui permissão ativa de registro', async () => {
  const dom = setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  const unloggedPeriod: MedicationEventData = {
    id: 'per-1',
    type: 'medication_period',
    time: '09:00:00',
    title: 'Manhã',
    status: 'pending',
    period: { id: 'per-1', name: 'Manhã', scheduled_time: '09:00:00' },
    medications: [{ id: 'med-1', name: 'Losartana', dosage: '50mg' }],
    logs: [],
  };

  const loggedPeriod: MedicationEventData = {
    ...unloggedPeriod,
    status: 'confirmed',
    logs: [
      {
        id: 'mlog-1',
        medication_id: 'med-1',
        status: 'administered',
        created_by: 'admin-1',
        created_at: '2026-11-16T12:00:00.000Z',
      },
    ],
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(MedicationModal, {
          isOpen: true,
          onClose: () => {},
          event: unloggedPeriod,
          patientId: 'pat-1',
          profileId: 'member-1',
          eventDate: '2026-11-16',
          canEdit: false,
          onSuccess: () => {},
        })
      );
    });

    const pendingText = container.textContent || '';
    assert.match(pendingText, /Aguardando confirmação/);
    assert.match(pendingText, /Losartana/);
    assert.equal(pendingText.includes('Confirmar Medicamentos'), false);
    assert.equal(pendingText.includes('Não tomou'), false);

    await act(async () => {
      root.render(
        React.createElement(MedicationModal, {
          isOpen: true,
          onClose: () => {},
          event: loggedPeriod,
          patientId: 'pat-1',
          profileId: 'member-1',
          eventDate: '2026-11-16',
          canEdit: false,
          onSuccess: () => {},
        })
      );
    });

    const viewText = container.textContent || '';
    assert.match(viewText, /Confirmado/);
    assert.equal(viewText.includes('EDITAR REGISTRO'), false);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('[React/JSDOM] HistoryDayGroup separa edição de registros (MEMBER em dia aberto) de encerramento/reabertura (ADMIN) e bloqueia conta sem vínculo', async () => {
  const dom = setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  const sampleDay = {
    dateStr: '2026-11-14',
    closure: null,
    meals: [
      {
        id: 'm1',
        logId: 'ml-1',
        mealConfigId: 'mc-1',
        title: 'Almoço',
        time: '12:30:00',
        consumption_status: 'normal' as const,
        description: 'Arroz e peixe',
        drink_description: 'Água',
        notes: 'Sem intercorrências',
        photo_url: 'pat-1/lunch.jpg',
        photoSignedUrl: 'https://duca.local/signed-lunch.jpg',
        creatorName: 'Admin',
        created_at: '2026-11-14T15:30:00.000Z',
        mealConfig: { id: 'mc-1', name: 'Almoço', scheduled_time: '12:30:00' },
        log: { id: 'ml-1', created_by: 'admin-1' },
      },
    ],
    meds: [
      {
        id: 'med-1',
        logId: 'medl-1',
        medicationId: 'med-1',
        name: 'Vitamina D',
        dosage: '1 gota',
        status: 'administered' as const,
        reason: null,
        time: '08:00:00',
        periodName: 'Manhã',
        periodId: 'per-1',
        creatorName: 'Admin',
        created_at: '2026-11-14T11:00:00.000Z',
        log: { id: 'medl-1', created_by: 'admin-1' },
        medication: { id: 'med-1', name: 'Vitamina D', dosage: '1 gota' },
      },
    ],
  };

  let editMealCalled = 0;
  let editMedCalled = 0;
  let viewedPhotoUrl: string | null = null;

  try {
    // 1. Conta sem vínculo ativo (canEditRecords=false, canManageClosures=false): apenas leitura + lightbox
    await act(async () => {
      root.render(
        React.createElement(HistoryDayGroup, {
          day: sampleDay,
          profileId: 'removed-1',
          canEdit: false,
          canEditRecords: false,
          canManageClosures: false,
          onViewPhoto: (url) => {
            viewedPhotoUrl = url;
          },
          onEditMeal: () => {
            editMealCalled += 1;
          },
          onEditMed: () => {
            editMedCalled += 1;
          },
          onRequestCloseDay: () => {},
          onOpenDayEdit: () => {},
        })
      );
    });

    const accordionBtn = container.querySelector('button') as HTMLButtonElement;
    assert.ok(accordionBtn);
    await act(async () => {
      accordionBtn.click();
    });

    const unlinkedText = container.textContent || '';
    assert.equal(unlinkedText.includes('Encerrar Dia'), false);
    assert.equal(unlinkedText.includes('Editar registros deste dia'), false);
    assert.match(unlinkedText, /Sem intercorrências/);

    const photoBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Toque para ampliar')
    );
    assert.ok(photoBtn);
    await act(async () => {
      photoBtn.click();
    });
    assert.equal(viewedPhotoUrl, 'https://duca.local/signed-lunch.jpg');
    assert.equal(editMealCalled, 0);
    assert.equal(editMedCalled, 0);

    // 2. MEMBER ativo em dia aberto: edita registros E pode encerrar o dia em aberto
    await act(async () => {
      root.render(
        React.createElement(HistoryDayGroup, {
          day: sampleDay,
          profileId: 'member-1',
          canEdit: false,
          canEditRecords: true,
          canCloseDay: true,
          canManageClosures: false,
          onViewPhoto: (url) => {
            viewedPhotoUrl = url;
          },
          onEditMeal: () => {
            editMealCalled += 1;
          },
          onEditMed: () => {
            editMedCalled += 1;
          },
          onRequestCloseDay: () => {},
          onOpenDayEdit: () => {},
        })
      );
    });

    const memberOpenText = container.textContent || '';
    assert.match(memberOpenText, /Encerrar Dia/);
    assert.match(memberOpenText, /Editar registros deste dia/);

    const memberButtons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
    const memberMealBtn = memberButtons.find((b) => b.textContent?.includes('Arroz e peixe'));
    const memberMedBtn = memberButtons.find((b) => b.textContent?.includes('Vitamina D'));
    assert.ok(memberMealBtn);
    assert.ok(memberMedBtn);
    await act(async () => {
      memberMealBtn.click();
      memberMedBtn.click();
    });
    assert.equal(editMealCalled, 1);
    assert.equal(editMedCalled, 1);

    // 3. MEMBER ativo em dia ENCERRADO: NÃO vê "Visualizar / Reabrir este dia" e não edita registros
    await act(async () => {
      root.render(
        React.createElement(HistoryDayGroup, {
          day: {
            ...sampleDay,
            closure: { id: 'cl-1', closed_at: '2026-11-14T23:00:00.000Z', closed_by_profile: { name: 'Admin' } },
          },
          profileId: 'member-1',
          canEdit: false,
          canEditRecords: true,
          canManageClosures: false,
          onViewPhoto: (url) => {
            viewedPhotoUrl = url;
          },
          onEditMeal: () => {
            editMealCalled += 1;
          },
          onEditMed: () => {
            editMedCalled += 1;
          },
          onRequestCloseDay: () => {},
          onOpenDayEdit: () => {},
        })
      );
    });
    const memberClosedText = container.textContent || '';
    assert.match(memberClosedText, /DIA ENCERRADO/);
    assert.equal(memberClosedText.includes('Visualizar / Reabrir este dia'), false);
    assert.equal(memberClosedText.includes('Editar registros deste dia'), false);

    // 4. ADMIN em dia aberto: vê tudo (Encerrar Dia + Editar registros + cards clicáveis)
    await act(async () => {
      root.render(
        React.createElement(HistoryDayGroup, {
          day: sampleDay,
          profileId: 'admin-1',
          canEdit: true,
          canEditRecords: true,
          canManageClosures: true,
          onEditMeal: () => {
            editMealCalled += 1;
          },
          onEditMed: () => {
            editMedCalled += 1;
          },
          onRequestCloseDay: () => {},
          onOpenDayEdit: () => {},
        })
      );
    });

    const adminText = container.textContent || '';
    assert.match(adminText, /Encerrar Dia/);
    assert.match(adminText, /Editar registros deste dia/);

    const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
    const mealCardBtn = buttons.find((b) => b.textContent?.includes('Arroz e peixe'));
    const medCardBtn = buttons.find((b) => b.textContent?.includes('Vitamina D'));
    assert.ok(mealCardBtn);
    assert.ok(medCardBtn);

    await act(async () => {
      mealCardBtn.click();
      medCardBtn.click();
    });

    assert.equal(editMealCalled, 2);
    assert.equal(editMedCalled, 2);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
