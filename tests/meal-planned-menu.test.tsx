import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { TodayScreen } from '../src/pages/Today.tsx';
import { RoutineScreen } from '../src/pages/Routine.tsx';
import { MealModal } from '../src/components/meals/MealModal.tsx';
import { ThemeProvider } from '../src/contexts/ThemeContext.tsx';
import { supabase } from '../src/services/supabase.ts';
import { clearAllUserCaches, updateMealConfig } from '../src/services/api.ts';

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
  (globalThis as any).KeyboardEvent = dom.window.KeyboardEvent;
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
  });
  if (!cachedCreateRoot) {
    const clientMod = await import('react-dom/client');
    cachedCreateRoot = clientMod.createRoot;
  }
  return { dom, createRoot: cachedCreateRoot };
}

function setReactInputValue(
  dom: JSDOM,
  input: HTMLInputElement,
  value: string
) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    'value'
  )!.set!;
  nativeSetter.call(input, value);
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

function makeQueryChain(resolvedData: any) {
  const result = { data: resolvedData, error: null };
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    lt: () => chain,
    gte: () => chain,
    order: () => chain,
    limit: () => chain,
    single: () =>
      Promise.resolve({
        data: Array.isArray(resolvedData) ? resolvedData[0] ?? null : resolvedData,
        error: null,
      }),
    maybeSingle: () =>
      Promise.resolve({
        data: Array.isArray(resolvedData) ? resolvedData[0] ?? null : resolvedData,
        error: null,
      }),
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

test('[SQL + Guardrails] Migration 0022 configura colunas e RLS universal sem termos proibidos no front-end', () => {
  const sql = fs.readFileSync(
    path.resolve('supabase/migrations/0022_meal_planned_menu_and_member_config.sql'),
    'utf8'
  );
  assert.match(sql, /ADD COLUMN IF NOT EXISTS default_description TEXT/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS default_drink_description TEXT/i);
  assert.match(sql, /Family members can update meal configs for their family's patients/);
  assert.match(sql, /public\.user_in_family\(p\.family_id\)/);
  assert.match(sql, /NOTIFY pgrst, 'reload schema'/i);

  const frontendFiles = [
    'src/utils/keyboardSubmit.ts',
    'src/components/routine/TimeEditModal.tsx',
    'src/pages/Routine.tsx',
    'src/components/timeline/TimelineItem.tsx',
    'src/components/meals/MealModal.tsx',
    'src/components/routine/ActivityFormModal.tsx',
    'src/components/activities/ActivityModal.tsx',
    'src/components/medications/MedicationModal.tsx',
    'src/components/routine/MedicationFormModal.tsx',
    'src/components/mood/MoodAndPainModal.tsx',
    'src/components/routine/PatientEditModal.tsx',
  ];

  for (const rel of frontendFiles) {
    const content = fs.readFileSync(path.resolve(rel), 'utf8');
    assert.equal(
      /\bapple\b/i.test(content),
      false,
      `Proibido incluir "apple" em ${rel}`
    );
    assert.equal(
      /\bpaciente\b/i.test(content),
      false,
      `Proibido incluir "paciente" em ${rel}`
    );
  }
});

test('[Integração React] Hoje exibe cardápio programado antes do registro, pré-preenche MealModal e salva ao apertar OK/Enter no teclado', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  const origFrom = (supabase as any).from;
  const origGetUser = supabase.auth.getUser.bind(supabase.auth);
  const origGetSession = supabase.auth.getSession.bind(supabase.auth);

  const insertedMealLogs: any[] = [];
  const mealConfigs = [
    {
      id: 'meal-lanche',
      patient_id: 'pat-1',
      name: 'Lanche da tarde',
      type: 'snack',
      scheduled_time: '16:00:00',
      display_order: 3,
      default_description: 'Iogurte com Nutren e Creatina',
      default_drink_description: '200ml de água',
      active: true,
    },
  ];

  (supabase.auth as any).getSession = async () => ({
    data: { session: { user: { id: 'caregiver-1' } } },
    error: null,
  });
  (supabase.auth as any).getUser = async () => ({
    data: { user: { id: 'caregiver-1' } },
    error: null,
  });

  (supabase as any).from = (table: string) => {
    switch (table) {
      case 'profiles':
        return makeQueryChain({
          id: 'caregiver-1',
          family_id: 'fam-1',
          name: 'Cintia Cuidadora',
          email: 'cintia@example.com',
        });
      case 'family_members':
        return makeQueryChain([
          {
            id: 'fm-1',
            family_id: 'fam-1',
            user_id: 'caregiver-1',
            role: 'MEMBER',
            member_type: 'CAREGIVER',
          },
        ]);
      case 'patients':
        return makeQueryChain({
          id: 'pat-1',
          family_id: 'fam-1',
          name: 'Vovó Dude',
          gender: 'F',
          photo_url: null,
        });
      case 'meal_configs':
        return makeQueryChain(mealConfigs);
      case 'meal_logs':
        return {
          ...makeQueryChain(insertedMealLogs),
          insert(rows: any) {
            const payload = Array.isArray(rows) ? rows[0] : rows;
            const created = {
              id: `mlog-${insertedMealLogs.length + 1}`,
              ...payload,
              creator: { name: 'Cintia Cuidadora' },
              updater: { name: 'Cintia Cuidadora' },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            insertedMealLogs.push(created);
            return makeQueryChain(created);
          },
        };
      case 'medication_periods':
      case 'medications':
      case 'medication_logs':
      case 'activities':
      case 'activity_logs':
        return makeQueryChain([]);
      case 'daily_closures':
      case 'daily_mood_logs':
        return makeQueryChain(null);
      default:
        return makeQueryChain([]);
    }
  };

  try {
    await clearAllUserCaches();
    await act(async () => {
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(TodayScreen, {
            nowProvider: () => new Date('2026-11-16T15:00:00.000Z'),
          })
        )
      );
      await new Promise((r) => setTimeout(r, 150));
    });

    const todayText = container.textContent || '';
    assert.match(todayText, /Cardápio programado/);
    assert.match(todayText, /Servir: Iogurte com Nutren e Creatina/);
    assert.match(todayText, /Bebida: 200ml de água/);

    const mealCard = Array.from<HTMLButtonElement>(
      container.querySelectorAll('button')
    ).find((b) => b.textContent?.includes('Lanche da tarde'));
    assert.ok(mealCard);

    await act(async () => {
      mealCard.click();
      await new Promise((r) => setTimeout(r, 80));
    });

    const dialog = container.querySelector('[role="dialog"]');
    assert.ok(dialog);
    assert.match(dialog.textContent || '', /Preenchido pela rotina/);

    const inputs = Array.from<HTMLInputElement>(dialog.querySelectorAll('input'));
    const descInput = inputs.find((i) =>
      i.getAttribute('placeholder')?.includes('Arroz, feijão')
    );
    const drinkInput = inputs.find((i) =>
      i.getAttribute('placeholder')?.includes('200ml de água')
    );
    assert.ok(descInput);
    assert.ok(drinkInput);
    assert.equal(descInput.value, 'Iogurte com Nutren e Creatina');
    assert.equal(drinkInput.value, '200ml de água');
    assert.equal(descInput.getAttribute('enterkeyhint'), 'done');

    // Focar no campo, editar texto e apertar OK/Enter no teclado nativo -> deve desfocar (fechar teclado) e salvar!
    let blurred = false;
    const origBlur = descInput.blur.bind(descInput);
    descInput.blur = () => {
      blurred = true;
      origBlur();
    };
    Object.defineProperty(dom.window.document, 'activeElement', {
      value: descInput,
      configurable: true,
    });

    await act(async () => {
      setReactInputValue(dom, descInput, 'Iogurte com Nutren, Creatina e aveia');
    });

    await act(async () => {
      descInput.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        })
      );
      await new Promise((r) => setTimeout(r, 120));
    });

    assert.equal(blurred, true);
    assert.equal(insertedMealLogs.length, 1);
    assert.equal(insertedMealLogs[0].description, 'Iogurte com Nutren, Creatina e aveia');
    assert.equal(insertedMealLogs[0].drink_description, '200ml de água');
  } finally {
    await act(async () => root.unmount());
    (supabase as any).from = origFrom;
    (supabase.auth as any).getUser = origGetUser;
    (supabase.auth as any).getSession = origGetSession;
    await clearAllUserCaches();
    dom.window.close();
  }
});

test('[Salvaguarda Clínica] MealModal limpa pré-preenchimento não editado ao escolher Não comeu', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  const origFrom = (supabase as any).from;
  const savedPayloads: any[] = [];

  (supabase as any).from = (table: string) => {
    if (table === 'meal_logs') {
      return {
        insert(rows: any) {
          const payload = Array.isArray(rows) ? rows[0] : rows;
          savedPayloads.push(payload);
          return makeQueryChain({
            id: 'mlog-none-1',
            ...payload,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        },
      };
    }
    return makeQueryChain([]);
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(MealModal, {
          isOpen: true,
          onClose: () => {},
          patientId: 'pat-1',
          profileId: 'caregiver-1',
          eventDate: '2026-11-16',
          patientGender: 'F',
          onSuccess: () => {},
          event: {
            id: 'meal-lanche',
            type: 'meal',
            time: '16:00:00',
            title: 'Lanche da tarde',
            status: 'pending',
            mealConfig: {
              id: 'meal-lanche',
              name: 'Lanche da tarde',
              scheduled_time: '16:00:00',
              default_description: 'Iogurte com Nutren e Creatina',
              default_drink_description: '200ml de água',
            },
          },
        })
      );
      await new Promise((r) => setTimeout(r, 80));
    });

    const naoComeuBtn = Array.from<HTMLButtonElement>(
      container.querySelectorAll('button')
    ).find((b) => b.textContent?.includes('Não comeu'));
    assert.ok(naoComeuBtn);

    await act(async () => {
      naoComeuBtn.click();
    });

    const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    assert.ok(submitBtn);

    await act(async () => {
      submitBtn.click();
      await new Promise((r) => setTimeout(r, 80));
    });

    assert.equal(savedPayloads.length, 1);
    assert.equal(savedPayloads[0].consumption_status, 'none');
    assert.equal(savedPayloads[0].description, null);
    assert.equal(savedPayloads[0].drink_description, null);
  } finally {
    await act(async () => root.unmount());
    (supabase as any).from = origFrom;
    dom.window.close();
  }
});

test('[Integração React] Membro não-ADM pode configurar cardápio de refeição na Rotina sem liberar controles ADM', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  const origFrom = (supabase as any).from;
  const origGetUser = supabase.auth.getUser.bind(supabase.auth);
  const origGetSession = supabase.auth.getSession.bind(supabase.auth);

  const mealConfigs = [
    {
      id: 'meal-lanche',
      patient_id: 'pat-1',
      name: 'Lanche da tarde',
      type: 'snack',
      scheduled_time: '16:00:00',
      display_order: 3,
      default_description: null,
      default_drink_description: null,
      active: true,
    },
  ];
  const updatedMealConfigs: any[] = [];

  (supabase.auth as any).getSession = async () => ({
    data: { session: { user: { id: 'member-1' } } },
    error: null,
  });
  (supabase.auth as any).getUser = async () => ({
    data: { user: { id: 'member-1' } },
    error: null,
  });

  (supabase as any).from = (table: string) => {
    switch (table) {
      case 'profiles':
        return makeQueryChain({
          id: 'member-1',
          family_id: 'fam-1',
          name: 'Deyse Filha',
          email: 'deyse@example.com',
        });
      case 'family_members':
        return makeQueryChain([
          {
            id: 'fm-member',
            family_id: 'fam-1',
            user_id: 'member-1',
            role: 'MEMBER',
            member_type: 'FAMILY',
          },
        ]);
      case 'patients':
        return makeQueryChain({
          id: 'pat-1',
          family_id: 'fam-1',
          name: 'Vovó Dude',
          gender: 'F',
          photo_url: null,
        });
      case 'meal_configs':
        return {
          ...makeQueryChain(mealConfigs),
          update(patch: any) {
            Object.assign(mealConfigs[0], patch);
            updatedMealConfigs.push(patch);
            return makeQueryChain(mealConfigs[0]);
          },
        };
      case 'medication_periods':
      case 'medications':
      case 'activities':
        return makeQueryChain([]);
      default:
        return makeQueryChain([]);
    }
  };

  try {
    await clearAllUserCaches();
    await act(async () => {
      root.render(React.createElement(ThemeProvider, null, React.createElement(RoutineScreen)));
      await new Promise((r) => setTimeout(r, 150));
    });

    const routineText = container.textContent || '';
    assert.equal(routineText.includes('Editar perfil'), false);
    assert.equal(routineText.includes('Adicionar Período'), false);
    assert.equal(routineText.includes('Adicionar medicamento'), false);
    assert.equal(routineText.includes('Editar horário'), false);
    assert.match(routineText, /Lanche da tarde/);
    assert.match(routineText, /Toque para definir o cardápio/);

    const mealBtn = Array.from<HTMLButtonElement>(
      container.querySelectorAll('button')
    ).find((b) => b.textContent?.includes('Lanche da tarde'));
    assert.ok(mealBtn);

    await act(async () => {
      mealBtn.click();
      await new Promise((r) => setTimeout(r, 80));
    });

    const dialog = container.querySelector('[role="dialog"]');
    assert.ok(dialog);
    assert.match(dialog.textContent || '', /Configurar Cardápio/);
    assert.equal(dialog.textContent?.includes('Inativo'), false);

    const dialogInputs = Array.from<HTMLInputElement>(dialog.querySelectorAll('input'));
    const foodInput = dialogInputs.find((i) =>
      i.getAttribute('placeholder')?.includes('Iogurte com Nutren')
    );
    const drinkInput = dialogInputs.find((i) =>
      i.getAttribute('placeholder')?.includes('200ml de água')
    );
    assert.ok(foodInput);
    assert.ok(drinkInput);
    assert.equal(foodInput.getAttribute('enterkeyhint'), 'done');

    await act(async () => {
      setReactInputValue(dom, foodInput, 'Iogurte com Nutren e Creatina');
      setReactInputValue(dom, drinkInput, '200ml de água');
    });

    let drinkBlurred = false;
    const origDrinkBlur = drinkInput.blur.bind(drinkInput);
    drinkInput.blur = () => {
      drinkBlurred = true;
      origDrinkBlur();
    };
    Object.defineProperty(dom.window.document, 'activeElement', {
      value: drinkInput,
      configurable: true,
    });

    await act(async () => {
      drinkInput.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        })
      );
      await new Promise((r) => setTimeout(r, 120));
    });

    assert.equal(drinkBlurred, true);
    assert.equal(updatedMealConfigs.length, 1);
    assert.equal(updatedMealConfigs[0].default_description, 'Iogurte com Nutren e Creatina');
    assert.equal(updatedMealConfigs[0].default_drink_description, '200ml de água');
    assert.equal('name' in updatedMealConfigs[0], false);
    assert.equal('scheduled_time' in updatedMealConfigs[0], false);
  } finally {
    await act(async () => root.unmount());
    (supabase as any).from = origFrom;
    (supabase.auth as any).getUser = origGetUser;
    (supabase.auth as any).getSession = origGetSession;
    await clearAllUserCaches();
    dom.window.close();
  }
});

test('[API Fallback] updateMealConfig orienta migration 0022 quando PGRST204 ocorre com cardápio preenchido', async () => {
  installMemoryIndexedDB();
  const origFrom = (supabase as any).from;
  let updateCalls = 0;

  (supabase as any).from = () => ({
    update(patch: any) {
      updateCalls += 1;
      const err =
        updateCalls === 1 && 'default_description' in patch
          ? {
              code: 'PGRST204',
              message: "Could not find the 'default_description' column of 'meal_configs'",
            }
          : null;
      return {
        eq: () => ({
          select: () => ({
            single: async () =>
              err
                ? { data: null, error: err }
                : { data: { id: 'meal-1', patient_id: 'pat-1', ...patch }, error: null },
          }),
        }),
      };
    },
  });

  try {
    await assert.rejects(
      () =>
        updateMealConfig('meal-1', {
          default_description: 'Iogurte com Nutren',
          default_drink_description: null,
        }),
      /migration 0022/i
    );

    updateCalls = 0;
    const legacyUpdated = await updateMealConfig('meal-1', {
      name: 'Almoço',
      default_description: null,
      default_drink_description: null,
    });
    assert.equal(legacyUpdated.name, 'Almoço');
    assert.equal(updateCalls, 2);
  } finally {
    (supabase as any).from = origFrom;
  }
});
