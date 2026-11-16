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

test('Migration 0014 eliminates profiles fallback when family_members exists and locks down privileges + RBAC', () => {
  const sql = fs.readFileSync(
    path.resolve('supabase/migrations/0014_rbac_and_rls_hardening.sql'),
    'utf8'
  );

  // 1. user_in_family returns early inside IF to_regclass('public.family_members') IS NOT NULL
  const userInFamilyMatch = sql.match(
    /CREATE OR REPLACE FUNCTION public\.user_in_family\(f_id UUID\)[\s\S]*?END;\s*\$\$;/
  );
  assert.ok(userInFamilyMatch);
  assert.match(userInFamilyMatch[0], /SECURITY DEFINER\s+SET search_path = public/);
  assert.match(
    userInFamilyMatch[0],
    /IF to_regclass\('public\.family_members'\) IS NOT NULL THEN[\s\S]*?RETURN COALESCE\(v_match, FALSE\);\s*END IF;/
  );

  // 2. user_can_access_storage_path handles own avatar, shared family_members avatars, and patient/meal paths
  const storageAccessMatch = sql.match(
    /CREATE OR REPLACE FUNCTION public\.user_can_access_storage_path\(object_name text\)[\s\S]*?END;\s*\$\$;/
  );
  assert.ok(storageAccessMatch);
  assert.match(storageAccessMatch[0], /SECURITY DEFINER\s+SET search_path = public/);
  assert.match(storageAccessMatch[0], /IF second_segment = auth\.uid\(\)::text THEN\s+RETURN TRUE;/);
  assert.match(
    storageAccessMatch[0],
    /IF to_regclass\('public\.family_members'\) IS NOT NULL THEN[\s\S]*?RETURN COALESCE\(v_shared_family, FALSE\);\s*END IF;/
  );
  assert.match(storageAccessMatch[0], /RETURN public\.user_in_family\(patient_family_id\);/);

  // 3. Storage writes enforce ADMIN for patient/meal photos and owner-only for user avatars
  const storageWriteMatch = sql.match(
    /CREATE OR REPLACE FUNCTION public\.user_can_write_storage_path\(bucket_name text, object_name text\)[\s\S]*?END;\s*\$\$;/
  );
  assert.ok(storageWriteMatch);
  assert.match(storageWriteMatch[0], /RETURN public\.user_is_family_admin\(patient_family_id\);/);

  // 4. Function privilege hardening: revoke from PUBLIC and anon, grant to authenticated & service_role
  for (const fnSig of [
    'public.user_in_family(UUID)',
    'public.user_is_family_admin(UUID)',
    'public.get_current_family_id()',
    'public.user_can_access_storage_path(text)',
    'public.user_can_write_storage_path(text, text)',
  ]) {
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION ${fnSig} FROM PUBLIC, anon;`));
    assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION ${fnSig} TO authenticated, service_role;`));
  }

  // 5. All priority tables enforce ADMIN writes and authenticated-scoped SELECT policies
  for (const table of [
    'public.patients',
    'public.meal_configs',
    'public.medication_periods',
    'public.medications',
    'public.meal_logs',
    'public.medication_logs',
    'public.daily_closures',
    'public.daily_mood_logs',
  ]) {
    assert.ok(sql.includes(`ON ${table}`), `Expected policy statements for ${table}`);
  }
  assert.equal(sql.includes('TO authenticated'), true);
  assert.equal(sql.includes('public.user_is_family_admin('), true);
  assert.equal(/DROP TABLE/i.test(sql), false);
  assert.equal(/TRUNCATE/i.test(sql), false);
});

test('api.ts & syncQueue.ts never queue RLS 42501 denials as offline retries and mark queued 42501 as failed', async () => {
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

test('MealModal enforces MEMBER read-only view (pending state & logged photo view without edit controls)', async () => {
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
    // 1. Unlogged meal as MEMBER -> calm read-only placeholder, zero form inputs or confirm button
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

    // 2. Logged meal as MEMBER -> full details + clickable zoom photo, no EDITAR REGISTRO button
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

test('MedicationModal enforces MEMBER read-only view for both unlogged and logged periods', async () => {
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

test('HistoryDayGroup hides admin actions from MEMBER while preserving read-only photo inspection, and keeps edit controls for ADMIN', async () => {
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
    // Render as MEMBER
    await act(async () => {
      root.render(
        React.createElement(HistoryDayGroup, {
          day: sampleDay,
          profileId: 'member-1',
          canEdit: false,
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

    // Expand accordion
    const accordionBtn = container.querySelector('button') as HTMLButtonElement;
    assert.ok(accordionBtn);
    await act(async () => {
      accordionBtn.click();
    });

    const memberText = container.textContent || '';
    assert.equal(memberText.includes('Encerrar Dia'), false);
    assert.equal(memberText.includes('Editar registros deste dia'), false);
    assert.match(memberText, /Sem intercorrências/);

    // Clicking photo triggers onViewPhoto and never onEditMeal
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

    // Re-render as ADMIN (already expanded)
    await act(async () => {
      root.render(
        React.createElement(HistoryDayGroup, {
          day: sampleDay,
          profileId: 'admin-1',
          canEdit: true,
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

    assert.equal(editMealCalled, 1);
    assert.equal(editMedCalled, 1);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
