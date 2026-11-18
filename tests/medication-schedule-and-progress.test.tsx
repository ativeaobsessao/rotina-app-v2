import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import React from 'react';
import { act } from 'react';
import {
  getMedicationWeekdays,
  isMedicationScheduledForDate,
  getMedicationDosageForDate,
  normalizeDailyDosages,
  formatMedicationScheduleSummary,
  getTimelineProgressMetrics,
} from '../src/utils/medicationSchedule.ts';
import { TimelineItem } from '../src/components/timeline/TimelineItem.tsx';
import { MedicationModal } from '../src/components/medications/MedicationModal.tsx';
import { MedicationFormModal } from '../src/components/routine/MedicationFormModal.tsx';
import { TodayScreen } from '../src/pages/Today.tsx';
import { ThemeProvider } from '../src/contexts/ThemeContext.tsx';
import { supabase } from '../src/services/supabase.ts';
import type { MedicationEventData } from '../src/types/timeline.ts';

function installMemoryIndexedDB() {
  const stores = new Map<string, Map<any, any>>();
  const fakeIndexedDB = {
    open(dbName: string) {
      const req: any = {
        result: {
          createObjectStore(storeName: string) {
            const key = `${dbName}:${storeName}`;
            if (!stores.has(key)) stores.set(key, new Map());
          },
          transaction(storeName: string) {
            const key = `${dbName}:${storeName}`;
            if (!stores.has(key)) stores.set(key, new Map());
            const map = stores.get(key)!;
            const tx: any = { oncomplete: null, onerror: null, onabort: null };
            const scheduleTxComplete = () => {
              queueMicrotask(() => {
                if (typeof tx.oncomplete === 'function') tx.oncomplete();
              });
            };
            const store: any = {
              transaction: tx,
              get(k: any) {
                const r: any = { result: undefined, onsuccess: null, onerror: null };
                queueMicrotask(() => {
                  r.result = map.get(k);
                  if (typeof r.onsuccess === 'function') r.onsuccess();
                });
                return r;
              },
              put(v: any, k: any) {
                map.set(k, v);
                scheduleTxComplete();
              },
              delete(k: any) {
                map.delete(k);
                scheduleTxComplete();
              },
              getAllKeys() {
                const r: any = { result: Array.from(map.keys()), onsuccess: null, onerror: null };
                queueMicrotask(() => {
                  if (typeof r.onsuccess === 'function') r.onsuccess();
                });
                return r;
              },
            };
            return {
              objectStore: () => store,
            };
          },
        },
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };
      queueMicrotask(() => {
        if (typeof req.onupgradeneeded === 'function') req.onupgradeneeded();
        if (typeof req.onsuccess === 'function') req.onsuccess();
      });
      return req;
    },
  };
  (globalThis as any).indexedDB = fakeIndexedDB;
}

let cachedCreateRoot: ((container: Element | DocumentFragment) => any) | null = null;

async function setupDom() {
  installMemoryIndexedDB();
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://duca.local/',
  });
  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  (globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
  (globalThis as any).Node = dom.window.Node;
  (globalThis as any).Event = dom.window.Event;
  (globalThis as any).InputEvent = dom.window.InputEvent;
  (globalThis as any).localStorage = dom.window.localStorage;
  (globalThis as any).sessionStorage = dom.window.sessionStorage;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (dom.window as any).matchMedia = () => ({
    matches: false,
    media: '',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
    writable: true,
  });
  if (!cachedCreateRoot) {
    const clientMod = await import('react-dom/client');
    cachedCreateRoot = clientMod.createRoot;
  }
  return { dom, createRoot: cachedCreateRoot };
}

// ---------------------------------------------------------------------------
// 1. Unit tests for multi-weekday scheduling, per-day dosages, and progress
// ---------------------------------------------------------------------------

test('medicationSchedule handles daily, legacy single weekday, multi-weekday, and per-day dosage', () => {
  // Legacy single weekday (backwards compatibility)
  const legacyWeekly = {
    frequency: 'weekly',
    weekday: 'Wednesday',
    weekdays: null,
    dosage: '1 comprimido',
    daily_dosages: null,
  };
  assert.deepEqual(getMedicationWeekdays(legacyWeekly), ['Wednesday']);
  assert.equal(isMedicationScheduledForDate(legacyWeekly, '2026-11-18'), true); // Wednesday
  assert.equal(isMedicationScheduledForDate(legacyWeekly, '2026-11-19'), false); // Thursday
  assert.equal(getMedicationDosageForDate(legacyWeekly, '2026-11-18'), '1 comprimido');

  // Multi-weekday + variable dosage per day
  const multiMed = {
    frequency: 'weekly',
    weekday: 'Monday',
    weekdays: ['Friday', 'Monday', 'Wednesday'],
    dosage: '1 comprimido',
    daily_dosages: {
      Monday: '2 comprimidos',
      Friday: '2 comprimidos',
    },
  };
  assert.deepEqual(getMedicationWeekdays(multiMed), ['Monday', 'Wednesday', 'Friday']);
  assert.equal(isMedicationScheduledForDate(multiMed, '2026-11-16'), true); // Monday
  assert.equal(isMedicationScheduledForDate(multiMed, '2026-11-17'), false); // Tuesday
  assert.equal(isMedicationScheduledForDate(multiMed, '2026-11-18'), true); // Wednesday
  assert.equal(isMedicationScheduledForDate(multiMed, '2026-11-20'), true); // Friday
  assert.equal(getMedicationDosageForDate(multiMed, '2026-11-16'), '2 comprimidos');
  assert.equal(getMedicationDosageForDate(multiMed, '2026-11-18'), '1 comprimido'); // falls back to default
  assert.equal(getMedicationDosageForDate(multiMed, '2026-11-20'), '2 comprimidos');
  assert.equal(formatMedicationScheduleSummary(multiMed), '1 comprimido (varia por dia) • Seg, Qua, Sex');

  // normalizeDailyDosages strips redundant entries matching base dosage
  assert.equal(
    normalizeDailyDosages('1 comprimido', ['Monday', 'Wednesday'], {
      Monday: '1 comprimido',
      Wednesday: ' 1 comprimido ',
    }),
    null
  );
  assert.deepEqual(
    normalizeDailyDosages('1 comprimido', ['Monday', 'Wednesday', 'Friday'], {
      Monday: '2 comprimidos',
      Wednesday: '1 comprimido',
      Friday: ' ',
    }),
    { Monday: '2 comprimidos' }
  );
});

test('getTimelineProgressMetrics counts each meal and each scheduled medication individually', () => {
  const metrics = getTimelineProgressMetrics([
    {
      id: 'mc-1',
      type: 'meal',
      time: '19:30:00',
      title: 'Jantar',
      status: 'confirmed',
      mealConfig: { id: 'mc-1' },
      log: { id: 'ml-1' },
    },
    {
      id: 'per-night',
      type: 'medication_period',
      time: '20:00:00',
      title: 'Depois do jantar',
      status: 'pending',
      period: { id: 'per-night', name: 'Depois do jantar', scheduled_time: '20:00:00' },
      medications: [
        { id: 'med-1', name: 'Rosuvastatina', dosage: '5mg' },
        { id: 'med-2', name: 'Quetiapina', dosage: '25mg' },
      ],
      logs: [
        { id: 'log-1', medication_id: 'med-1', status: 'administered', created_by: 'deyse-1' },
      ],
    },
  ]);

  assert.equal(metrics.totalItems, 3);
  assert.equal(metrics.completedItems, 2);
  assert.equal(metrics.pendingItems, 1);
  assert.equal(metrics.allCompleted, false);
});

// ---------------------------------------------------------------------------
// 2. Static SQL migration 0020 & UI copy constraint checks
// ---------------------------------------------------------------------------

test('Migration 0020 SQL is idempotent, safe, and reloads PostgREST schema', () => {
  const sqlPath = path.join(
    process.cwd(),
    'supabase/migrations/0020_medication_weekdays_and_daily_dosage.sql'
  );
  const sql = fs.readFileSync(sqlPath, 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS weekdays TEXT\[\]/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS daily_dosages JSONB/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS applied_dosage TEXT/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS medications_weekdays_valid_check/);
  assert.match(sql, /UPDATE public\.medications[\s\S]*SET weekdays = ARRAY\[weekday\]/);
  assert.match(sql, /NOTIFY pgrst, 'reload schema'/);
});

test('Edited front-end medication, routine, and timeline files never expose forbidden terms or alternate-days mode', () => {
  const checkedFiles = [
    'src/components/routine/MedicationFormModal.tsx',
    'src/components/medications/MedicationModal.tsx',
    'src/components/timeline/TimelineItem.tsx',
    'src/components/timeline/DailyProgressBar.tsx',
    'src/pages/Routine.tsx',
    'src/pages/Today.tsx',
    'src/utils/medicationSchedule.ts',
  ];

  for (const rel of checkedFiles) {
    const content = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
    assert.equal(/\bapple\b/i.test(content), false, `Forbidden word "apple" found in ${rel}`);
    assert.equal(/\bpaciente\b/i.test(content), false, `Forbidden word "paciente" found in ${rel}`);
    assert.equal(
      /alternate_days|dia sim, dia n[ãa]o/i.test(content),
      false,
      `Out-of-scope alternate days option found in ${rel}`
    );
  }
});

// ---------------------------------------------------------------------------
// 3. React/JSDOM: Partial med progress, TimelineItem badge, and MedicationModal
// ---------------------------------------------------------------------------

test('[React/JSDOM] TodayScreen immediately updates progress and TimelineItem when a non-ADM member marks 1 of 2 meds', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  const origFrom = supabase.from;
  const origAuth = supabase.auth;
  const origChannel = supabase.channel;
  const origRemoveChannel = supabase.removeChannel;

  // Wednesday 2026-11-18 at 19:11 America/Sao_Paulo (before 20:00 medication period!)
  const nowProvider = () => new Date('2026-11-18T22:11:00.000Z');

  (supabase as any).auth = {
    getUser: async () => ({ data: { user: { id: 'viewer-1' } }, error: null }),
    getSession: async () => ({ data: { session: { user: { id: 'viewer-1' } } }, error: null }),
  };
  (supabase as any).channel = () => {
    const ch: any = {
      on: () => ch,
      subscribe: () => ch,
    };
    return ch;
  };
  (supabase as any).removeChannel = () => Promise.resolve('ok');

  const mealConfigs = [
    {
      id: 'mc-dinner',
      patient_id: 'pat-1',
      name: 'Jantar',
      type: 'dinner',
      scheduled_time: '19:00:00',
      display_order: 1,
      active: true,
    },
  ];
  const medPeriods = [
    {
      id: 'per-after-dinner',
      patient_id: 'pat-1',
      name: 'Depois do jantar',
      scheduled_time: '20:00:00',
      display_order: 1,
      active: true,
    },
  ];
  const medications = [
    {
      id: 'med-rosu',
      patient_id: 'pat-1',
      medication_period_id: 'per-after-dinner',
      name: 'Rosuvastatina cálcica',
      dosage: '1 comprimido (5 mg)',
      frequency: 'daily',
      weekday: null,
      weekdays: null,
      daily_dosages: null,
      active: true,
    },
    {
      id: 'med-queti',
      patient_id: 'pat-1',
      medication_period_id: 'per-after-dinner',
      name: 'Quetiapina',
      dosage: '1 comprimido',
      frequency: 'weekly',
      weekday: 'Wednesday',
      weekdays: ['Wednesday', 'Thursday'],
      daily_dosages: { Wednesday: '2 comprimidos' },
      active: true,
    },
  ];
  const mealLogs = [
    {
      id: 'mlog-1',
      meal_config_id: 'mc-dinner',
      patient_id: 'pat-1',
      event_date: '2026-11-18',
      consumption_status: 'normal',
      description: 'Tapioca',
      meal_time: '19:01:00',
      created_by: 'deyse-1',
      creator: { name: 'Deyse' },
      created_at: '2026-11-18T22:01:00.000Z',
    },
  ];
  const medLogs = [
    {
      id: 'medlog-1',
      medication_id: 'med-rosu',
      patient_id: 'pat-1',
      event_date: '2026-11-18',
      status: 'administered',
      created_by: 'deyse-1',
      creator: { name: 'Deyse' },
      created_at: '2026-11-18T21:48:00.000Z',
    },
  ];

  const makeChain = (table: string) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      single: async () => {
        if (table === 'profiles') {
          return {
            data: { id: 'viewer-1', family_id: 'fam-1', name: 'Gabriel', email: 'g@e.com' },
            error: null,
          };
        }
        return { data: null, error: null };
      },
      maybeSingle: async () => {
        if (table === 'profiles') {
          return {
            data: { id: 'viewer-1', family_id: 'fam-1', name: 'Gabriel', email: 'g@e.com' },
            error: null,
          };
        }
        if (table === 'patients') {
          return {
            data: { id: 'pat-1', family_id: 'fam-1', name: 'Vovó Dude', photo_url: null, gender: 'F' },
            error: null,
          };
        }
        return { data: null, error: null };
      },
      then: (resolve: any) => {
        if (table === 'family_members') {
          return Promise.resolve(
            resolve({
              data: [{ family_id: 'fam-1', user_id: 'viewer-1', role: 'MEMBER', member_type: 'FAMILY' }],
              error: null,
            })
          );
        }
        if (table === 'meal_configs') return Promise.resolve(resolve({ data: mealConfigs, error: null }));
        if (table === 'medication_periods') return Promise.resolve(resolve({ data: medPeriods, error: null }));
        if (table === 'medications') return Promise.resolve(resolve({ data: medications, error: null }));
        if (table === 'meal_logs') return Promise.resolve(resolve({ data: mealLogs, error: null }));
        if (table === 'medication_logs') return Promise.resolve(resolve({ data: medLogs, error: null }));
        return Promise.resolve(resolve({ data: [], error: null }));
      },
    };
    return chain;
  };

  (supabase as any).from = (table: string) => makeChain(table);

  try {
    await act(async () => {
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(TodayScreen, { nowProvider })
        )
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });

    const text = container.textContent || '';
    // 1 meal confirmed + 1 of 2 meds confirmed = 2/3 items (67%)!
    assert.match(text, /67%/);
    assert.match(text, /\(2\/3\)/);
    assert.match(text, /Falta 1 item na rotina/);
    // Timeline card shows partial status, remaining count, and creator immediately (even before 20:00)
    assert.match(text, /1 de 2 confirmados/);
    assert.match(text, /Falta 1 medicamento/);
    assert.match(text, /Registrado por Deyse/);
    assert.match(text, /2 de 3 atividades registradas/);

    // Clicking the partially logged medication period opens MedicationModal with BOTH confirmed & pending meds
    const cardBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Depois do jantar')
    );
    assert.ok(cardBtn);
    await act(async () => {
      cardBtn.click();
    });

    const modalText = container.textContent || '';
    assert.match(modalText, /Rosuvastatina cálcica/);
    assert.match(modalText, /Confirmado/);
    assert.match(modalText, /Quetiapina/);
    assert.match(modalText, /2 comprimidos/); // Wednesday dosage from daily_dosages!
    assert.match(modalText, /Pendente/);
    assert.match(modalText, /Registrar medicamento pendente/);
  } finally {
    await act(async () => root.unmount());
    (supabase as any).from = origFrom;
    (supabase as any).auth = origAuth;
    (supabase as any).channel = origChannel;
    (supabase as any).removeChannel = origRemoveChannel;
    dom.window.close();
  }
});

test('[React/JSDOM] MedicationModal records applied_dosage for the exact date when confirming pending medication', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  const origFrom = supabase.from;
  const origAuth = supabase.auth;
  const insertedPayloads: any[] = [];

  (supabase as any).auth = {
    getSession: async () => ({ data: { session: { user: { id: 'member-1' } } }, error: null }),
  };

  (supabase as any).from = (table: string) => ({
    insert(payload: any) {
      if (table === 'medication_logs') insertedPayloads.push(payload);
      return {
        select: () => ({
          single: async () => ({
            data: { id: 'mlog-new', ...payload, created_at: '2026-11-18T22:20:00.000Z' },
            error: null,
          }),
        }),
      };
    },
  });

  const partialEvent: MedicationEventData = {
    id: 'per-night',
    type: 'medication_period',
    time: '20:00:00',
    title: 'Depois do jantar',
    status: 'pending',
    period: { id: 'per-night', name: 'Depois do jantar', scheduled_time: '20:00:00' },
    medications: [
      { id: 'med-1', name: 'Rosuvastatina', dosage: '5mg' },
      {
        id: 'med-2',
        name: 'Quetiapina',
        dosage: '1 comprimido',
        frequency: 'daily',
        daily_dosages: { Wednesday: '2 comprimidos' },
      },
    ],
    logs: [
      {
        id: 'log-existing',
        medication_id: 'med-1',
        status: 'administered',
        created_by: 'deyse-1',
        creator: { name: 'Deyse' },
        created_at: '2026-11-18T21:48:00.000Z',
      },
    ],
  };

  try {
    let saved = 0;
    await act(async () => {
      root.render(
        React.createElement(MedicationModal, {
          isOpen: true,
          onClose: () => {},
          event: partialEvent,
          patientId: 'pat-1',
          profileId: 'member-1',
          eventDate: '2026-11-18', // Wednesday -> '2 comprimidos'
          canEdit: true,
          onSuccess: () => {
            saved += 1;
          },
        })
      );
    });

    const openEditBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.includes('Registrar medicamento pendente')
    );
    assert.ok(openEditBtn);

    await act(async () => {
      openEditBtn.click();
    });

    const checkQuetiBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.includes('Quetiapina')
    );
    assert.ok(checkQuetiBtn);

    await act(async () => {
      checkQuetiBtn.click();
    });

    const confirmBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.includes('Confirmar Medicamentos')
    );
    assert.ok(confirmBtn);

    await act(async () => {
      confirmBtn.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    assert.equal(saved, 1);
    assert.equal(insertedPayloads.length, 1);
    assert.equal(insertedPayloads[0].medication_id, 'med-2');
    assert.equal(insertedPayloads[0].applied_dosage, '2 comprimidos');
  } finally {
    (supabase as any).from = origFrom;
    (supabase as any).auth = origAuth;
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('[React/JSDOM] TimelineItem renders partial medication state without needing confirmed/attention status', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  const partialMedEvent: MedicationEventData = {
    id: 'per-1',
    type: 'medication_period',
    time: '20:00:00',
    title: 'Depois do jantar',
    status: 'pending',
    period: { id: 'per-1', name: 'Depois do jantar', scheduled_time: '20:00:00' },
    medications: [
      { id: 'med-1', name: 'Rosuvastatina', dosage: '5mg' },
      { id: 'med-2', name: 'Quetiapina', dosage: '25mg' },
    ],
    logs: [
      {
        id: 'log-1',
        medication_id: 'med-1',
        status: 'administered',
        created_by: 'deyse-1',
        creator: { name: 'Deyse' },
        created_at: '2026-11-18T21:48:00.000Z',
      },
    ],
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(TimelineItem, {
          event: partialMedEvent,
          profileId: 'gabriel-1',
          onClick: () => {},
        })
      );
    });

    const text = container.textContent || '';
    assert.match(text, /1 de 2 confirmados/);
    assert.match(text, /Falta 1 medicamento/);
    assert.match(text, /Registrado por Deyse/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

// ---------------------------------------------------------------------------
// 4. React/JSDOM: MedicationFormModal multi-weekday & per-day dosage setup
// ---------------------------------------------------------------------------

test('[React/JSDOM] MedicationFormModal configures multiple weekdays and optional per-day dosage variation cleanly', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  const origFrom = supabase.from;
  const savedMeds: any[] = [];
  (supabase as any).from = (table: string) => ({
    insert(payload: any) {
      if (table === 'medications') savedMeds.push(payload);
      return {
        select: () => ({
          single: async () => ({ data: { id: 'med-new', ...payload }, error: null }),
        }),
      };
    },
  });

  const setInputValue = (input: HTMLInputElement, val: string) => {
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      'value'
    )!.set!;
    setter.call(input, val);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  };

  try {
    let onSuccessCalls = 0;
    await act(async () => {
      root.render(
        React.createElement(MedicationFormModal, {
          isOpen: true,
          onClose: () => {},
          patientId: 'pat-1',
          medication: null,
          periods: [{ id: 'per-night', name: 'Depois do jantar', scheduled_time: '20:00:00' }],
          defaultPeriodId: 'per-night',
          onSuccess: () => {
            onSuccessCalls += 1;
          },
        })
      );
    });

    // Confirm no "Dia sim, dia não" option exists
    assert.equal(/dia sim/i.test(container.textContent || ''), false);

    const nameInput = container.querySelector('input[placeholder*="Losartana"]') as HTMLInputElement;
    const doseInput = container.querySelector('input[placeholder*="1 comprimido 50mg"]') as HTMLInputElement;
    assert.ok(nameInput);
    assert.ok(doseInput);

    await act(async () => {
      setInputValue(nameInput, 'Quetiapina');
      setInputValue(doseInput, '1 comprimido');
    });

    // Switch to "Dias da semana" (default pre-selected: Mon, Wed, Fri)
    const weeklyRadio = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.trim() === 'Dias da semana'
    );
    assert.ok(weeklyRadio);
    await act(async () => {
      weeklyRadio.click();
    });

    // Toggle Thursday on as well -> Mon, Wed, Thu, Fri
    const thuBtn = container.querySelector('button[aria-label="Quinta-feira"]') as HTMLButtonElement;
    assert.ok(thuBtn);
    await act(async () => {
      thuBtn.click();
    });

    // Enable "Dose muda conforme o dia?"
    const variesSwitch = container.querySelector('button[role="switch"]') as HTMLButtonElement;
    assert.ok(variesSwitch);
    await act(async () => {
      variesSwitch.click();
    });

    // Change Wednesday dose to "2 comprimidos"
    const wedDoseInput = container.querySelector(
      'input[aria-label="Dose de Quarta-feira"]'
    ) as HTMLInputElement;
    assert.ok(wedDoseInput);
    await act(async () => {
      setInputValue(wedDoseInput, '2 comprimidos');
    });

    // Verify live summary displays human-friendly preview
    const previewText = container.textContent || '';
    assert.match(previewText, /Seg, Qua, Qui, Sex/);
    assert.match(previewText, /Qua: 2 comprimidos/);

    const saveBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Salvar Medicamento')
    );
    assert.ok(saveBtn);
    await act(async () => {
      saveBtn.click();
      await new Promise((r) => setTimeout(r, 40));
    });

    assert.equal(onSuccessCalls, 1);
    assert.equal(savedMeds.length, 1);
    assert.equal(savedMeds[0].frequency, 'weekly');
    assert.equal(savedMeds[0].weekday, 'Monday');
    assert.deepEqual(savedMeds[0].weekdays, ['Monday', 'Wednesday', 'Thursday', 'Friday']);
    assert.deepEqual(savedMeds[0].daily_dosages, { Wednesday: '2 comprimidos' });
  } finally {
    (supabase as any).from = origFrom;
    await act(async () => root.unmount());
    dom.window.close();
  }
});
