import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  isActivityScheduledForDate,
  isExpiredOneTimeActivity,
  getUpcomingScheduledActivities,
  formatDaysUntilLabel,
  formatActivityScheduleSummary,
} from '../src/utils/activitySchedule.ts';
import {
  dismissUpcomingActivityBanner,
  isUpcomingActivityBannerDismissed,
  shouldShowUpcomingActivityBanner,
  getUpcomingActivityDismissKey,
} from '../src/utils/activityReminder.ts';
import { getTimelineProgressMetrics } from '../src/utils/medicationSchedule.ts';
import { TodayScreen } from '../src/pages/Today.tsx';
import { RoutineScreen } from '../src/pages/Routine.tsx';
import { ThemeProvider } from '../src/contexts/ThemeContext.tsx';
import { supabase } from '../src/services/supabase.ts';

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

function setupDom() {
  installMemoryIndexedDB();
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://duca.local/',
  });
  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  (globalThis as any).Node = dom.window.Node;
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
  return dom;
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
    single: () => Promise.resolve({ data: Array.isArray(resolvedData) ? resolvedData[0] ?? null : resolvedData, error: null }),
    maybeSingle: () =>
      Promise.resolve({ data: Array.isArray(resolvedData) ? resolvedData[0] ?? null : resolvedData, error: null }),
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

test('[Unit] activitySchedule filtra datas únicas, semanais, expiradas e janela de aviso 1-7 dias', () => {
  const today = '2026-11-16'; // Monday
  const sameDay = {
    id: 'a-today',
    title: 'Sessão hoje',
    schedule_type: 'one_time',
    scheduled_date: '2026-11-16',
    scheduled_time: '15:00:00',
    active: true,
  };
  const in5Days = {
    id: 'a-5d',
    title: 'Consulta Obstetra',
    schedule_type: 'one_time',
    scheduled_date: '2026-11-21',
    scheduled_time: '09:30:00',
    active: true,
  };
  const in8Days = {
    id: 'a-8d',
    title: 'Exame em 8 dias',
    schedule_type: 'one_time',
    scheduled_date: '2026-11-24',
    scheduled_time: '10:00:00',
    active: true,
  };
  const in6Months = {
    id: 'a-6m',
    title: 'Retorno em 6 meses',
    schedule_type: 'one_time',
    scheduled_date: '2027-05-16',
    scheduled_time: '14:00:00',
    active: true,
  };
  const pastOneTime = {
    id: 'a-past',
    title: 'Exame passado',
    schedule_type: 'one_time',
    scheduled_date: '2026-11-10',
    scheduled_time: '08:00:00',
    active: true,
  };
  const weeklyYoga = {
    id: 'a-yoga',
    title: 'Yoga',
    schedule_type: 'weekly',
    weekdays: ['Monday', 'Wednesday'],
    scheduled_time: '10:00:00',
    active: true,
  };

  assert.equal(isActivityScheduledForDate(sameDay, today), true);
  assert.equal(isActivityScheduledForDate(in5Days, today), false);
  assert.equal(isActivityScheduledForDate(in6Months, today), false);
  assert.equal(isActivityScheduledForDate(in6Months, '2027-05-16'), true);
  assert.equal(isActivityScheduledForDate(weeklyYoga, '2026-11-16'), true); // Monday
  assert.equal(isActivityScheduledForDate(weeklyYoga, '2026-11-17'), false); // Tuesday

  assert.equal(isExpiredOneTimeActivity(pastOneTime, today), true);
  assert.equal(isExpiredOneTimeActivity(sameDay, today), false);
  assert.equal(isExpiredOneTimeActivity(weeklyYoga, today), false);

  const upcoming = getUpcomingScheduledActivities(
    [sameDay, in5Days, in8Days, in6Months, pastOneTime, weeklyYoga],
    today,
    1,
    7
  );
  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0].activity.id, 'a-5d');
  assert.equal(upcoming[0].daysUntil, 5);
  assert.equal(formatDaysUntilLabel(5), 'Em 5 dias');
  assert.match(formatActivityScheduleSummary(in5Days, today), /Em 5 dias/);
});

test('[Unit] activityReminder persiste fechamento do aviso e reaparece se surgir nova atividade próxima', () => {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => map.delete(k),
    setItem: (k: string, v: string) => map.set(k, v),
  };

  const act1 = [{ id: 'a1', scheduled_date: '2026-11-20' }];
  assert.equal(isUpcomingActivityBannerDismissed('u1', 'p1', '2026-11-16', act1, storage), false);

  dismissUpcomingActivityBanner('u1', 'p1', '2026-11-16', act1, storage);
  assert.ok(storage.getItem(getUpcomingActivityDismissKey('u1', 'p1', '2026-11-16')));
  assert.equal(isUpcomingActivityBannerDismissed('u1', 'p1', '2026-11-16', act1, storage), true);

  // If a second appointment is added into the 1-7 day window, the banner re-surfaces cleanly
  const act1And2 = [...act1, { id: 'a2', scheduled_date: '2026-11-21' }];
  assert.equal(isUpcomingActivityBannerDismissed('u1', 'p1', '2026-11-16', act1And2, storage), false);

  assert.equal(
    shouldShowUpcomingActivityBanner({
      isViewingToday: true,
      isDayClosed: false,
      upcomingCount: 1,
      isDismissed: false,
    }),
    true
  );
  assert.equal(
    shouldShowUpcomingActivityBanner({
      isViewingToday: true,
      isDayClosed: true,
      upcomingCount: 1,
      isDismissed: false,
    }),
    false
  );
});

test('[Unit] getTimelineProgressMetrics contabiliza atividades na barra diária', () => {
  const metricsBefore = getTimelineProgressMetrics([
    {
      id: 'act-1',
      type: 'activity',
      time: '10:00:00',
      title: 'Fisioterapia',
      status: 'pending',
      activity: { id: 'act-1' },
    },
  ]);
  assert.deepEqual(metricsBefore, {
    totalItems: 1,
    completedItems: 0,
    pendingItems: 1,
    allCompleted: false,
  });

  const metricsAfter = getTimelineProgressMetrics([
    {
      id: 'act-1',
      type: 'activity',
      time: '10:00:00',
      title: 'Fisioterapia',
      status: 'confirmed',
      activity: { id: 'act-1' },
      log: { id: 'log-1', status: 'completed' },
    },
  ]);
  assert.deepEqual(metricsAfter, {
    totalItems: 1,
    completedItems: 1,
    pendingItems: 0,
    allCompleted: true,
  });
});

test('[Estático SQL e Copy] Migration 0021 integra RLS universal + bloqueio dia fechado, e UI não contém termos proibidos', () => {
  const migrationPath = path.resolve('supabase/migrations/0021_activities_and_logs.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.activities/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.activity_logs/i);
  assert.match(sql, /public\.user_in_family/i);
  assert.match(sql, /public\.user_is_family_admin/i);
  assert.match(sql, /prevent_activity_log_mutation_on_closed_day/i);
  assert.match(sql, /NOTIFY pgrst,\s*'reload schema'/i);

  const filesToCheck = [
    'src/components/routine/ActivityFormModal.tsx',
    'src/components/activities/ActivityModal.tsx',
    'src/components/timeline/TimelineItem.tsx',
    'src/pages/Today.tsx',
    'src/pages/Routine.tsx',
    'src/pages/History.tsx',
    'src/components/history/DayEditModal.tsx',
    'src/components/history/ReportModal.tsx',
    'src/utils/activitySchedule.ts',
    'src/utils/activityReminder.ts',
  ];

  for (const relPath of filesToCheck) {
    const content = fs.readFileSync(path.resolve(relPath), 'utf8');
    assert.equal(
      /\bapple\b/i.test(content),
      false,
      `Termo proibido encontrado em ${relPath}`
    );
    assert.equal(
      /\bpaciente\b/i.test(content),
      false,
      `Termo proibido encontrado em ${relPath}`
    );
  }
});

test('[Integração React] TodayScreen exibe aviso 1-7 dias fechável, isola atividade em 6 meses, e permite membro não-ADM registrar atividade e somar progresso', async () => {
  const dom = setupDom();
  const container = document.getElementById('root')!;
  const root = createRoot(container);

  const origAuthGetUser = supabase.auth.getUser.bind(supabase.auth);
  const origAuthGetSession = supabase.auth.getSession.bind(supabase.auth);
  const origFrom = supabase.from.bind(supabase);
  const origChannel = supabase.channel.bind(supabase);
  const origRemoveChannel = supabase.removeChannel.bind(supabase);

  const simulatedNow = new Date('2026-11-16T15:00:00.000Z'); // 12:00 BRT Monday

  let currentActivityLogs: any[] = [];

  (supabase as any).channel = () => {
    const ch: any = { on: () => ch, subscribe: () => ch };
    return ch;
  };
  (supabase as any).removeChannel = () => Promise.resolve('ok');
  (supabase.auth as any).getUser = async () => ({
    data: { user: { id: 'member-1', email: 'membra@familia.test' } },
    error: null,
  });
  (supabase.auth as any).getSession = async () => ({
    data: { session: { user: { id: 'member-1' } } },
    error: null,
  });

  const activitiesData = [
    {
      id: 'act-today',
      patient_id: 'pat-1',
      title: 'Fisioterapia Hoje',
      category: 'wellness',
      schedule_type: 'one_time',
      scheduled_date: '2026-11-16',
      weekdays: null,
      scheduled_time: '10:00:00',
      notes: 'Em casa',
      active: true,
    },
    {
      id: 'act-5days',
      patient_id: 'pat-1',
      title: 'Consulta Obstetra',
      category: 'medical',
      schedule_type: 'one_time',
      scheduled_date: '2026-11-21',
      weekdays: null,
      scheduled_time: '14:30:00',
      notes: 'Clínica Central',
      active: true,
    },
    {
      id: 'act-6months',
      patient_id: 'pat-1',
      title: 'Retorno em 6 meses',
      category: 'medical',
      schedule_type: 'one_time',
      scheduled_date: '2027-05-16',
      weekdays: null,
      scheduled_time: '09:00:00',
      notes: null,
      active: true,
    },
  ];

  (supabase as any).from = (table: string) => {
    switch (table) {
      case 'profiles':
        return makeQueryChain({
          id: 'member-1',
          name: 'Ana Membra',
          role: 'FAMILY',
          family_id: 'fam-1',
        });
      case 'patients':
        return makeQueryChain({
          id: 'pat-1',
          name: 'Dona Maria',
          family_id: 'fam-1',
          photo_url: null,
        });
      case 'family_members':
        return makeQueryChain([
          { id: 'fm-2', user_id: 'member-1', family_id: 'fam-1', role: 'MEMBER' },
        ]);
      case 'meal_configs':
        return makeQueryChain([]);
      case 'medication_periods':
        return makeQueryChain([]);
      case 'medications':
        return makeQueryChain([]);
      case 'activities':
        return makeQueryChain(activitiesData);
      case 'meal_logs':
        return makeQueryChain([]);
      case 'medication_logs':
        return makeQueryChain([]);
      case 'activity_logs':
        return {
          ...makeQueryChain(currentActivityLogs),
          insert: (payload: any) => ({
            select: () => ({
              single: async () => {
                const inserted = {
                  id: 'act-log-1',
                  ...payload,
                  created_at: '2026-11-16T15:05:00.000Z',
                  updated_at: '2026-11-16T15:05:00.000Z',
                  creator: { name: 'Ana Membra' },
                };
                currentActivityLogs = [inserted];
                return { data: inserted, error: null };
              },
            }),
          }),
        };
      case 'daily_mood_logs':
        return makeQueryChain(null);
      case 'daily_closures':
        return makeQueryChain(null);
      default:
        return makeQueryChain([]);
    }
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(TodayScreen, {
            nowProvider: () => simulatedNow,
          })
        )
      );
      await new Promise((r) => setTimeout(r, 140));
    });

    // 1. Aviso antecipado (1-7 dias) aparece no topo com botão X funcional
    const upcomingBanner = container.querySelector('[aria-label="Aviso de atividade agendada"]');
    assert.ok(upcomingBanner, 'Aviso de atividade próxima deve aparecer no topo');
    assert.match(upcomingBanner.textContent || '', /Consulta Obstetra/);
    assert.match(upcomingBanner.textContent || '', /Em 5 dias/);

    const closeBannerBtn = upcomingBanner.querySelector(
      'button[aria-label="Fechar aviso de atividade agendada"]'
    ) as HTMLButtonElement | null;
    assert.ok(closeBannerBtn, 'Botão X para fechar aviso é obrigatório');
    await act(async () => {
      closeBannerBtn.click();
    });
    assert.equal(
      container.querySelector('[aria-label="Aviso de atividade agendada"]'),
      null,
      'Banner deve sumir após o usuário clicar em X'
    );

    // 2. Consulta em 6 meses NÃO polui a timeline nem o progresso de Hoje
    assert.equal((container.textContent || '').includes('Retorno em 6 meses'), false);

    // 3. Apenas atividade de hoje entra na timeline & barra (0/1 -> 0%) e membro não-ADM vê botão + Atividade
    assert.match(container.textContent || '', /Fisioterapia Hoje/);
    assert.match(container.textContent || '', /0%/);
    assert.match(container.textContent || '', /\(0\/1\)/);
    const quickAddBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.includes('Atividade')
    );
    assert.ok(quickAddBtn, 'Membro ativo não-ADM deve poder adicionar atividade pela Home');

    // 4. Membro não-ADM clica na atividade de hoje e confirma realização -> progresso sobe para 100% (1/1)
    const activityCardBtn = (
      Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]
    ).find((b) => b.textContent?.includes('Fisioterapia Hoje'));
    assert.ok(activityCardBtn);

    await act(async () => {
      activityCardBtn.click();
    });
    const confirmActivityBtn = (
      Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]
    ).find((b) => b.textContent?.includes('Atividade realizada'));
    assert.ok(confirmActivityBtn, 'Modal de atividade deve abrir para membro não-ADM');

    await act(async () => {
      confirmActivityBtn.click();
      await new Promise((r) => setTimeout(r, 140));
    });

    assert.match(container.textContent || '', /100%/);
    assert.match(container.textContent || '', /\(1\/1\)/);
    assert.match(container.textContent || '', /Realizada/);
  } finally {
    await act(async () => root.unmount());
    (supabase.auth as any).getUser = origAuthGetUser;
    (supabase.auth as any).getSession = origAuthGetSession;
    (supabase as any).from = origFrom;
    (supabase as any).channel = origChannel;
    (supabase as any).removeChannel = origRemoveChannel;
    dom.window.close();
  }
});

test('[Integração React] RoutineScreen separa Agendadas/Recorrentes, oculta expiradas e libera criação para membro não-ADM', async () => {
  const dom = setupDom();
  const container = document.getElementById('root')!;
  const root = createRoot(container);

  const origAuthGetUser = supabase.auth.getUser.bind(supabase.auth);
  const origAuthGetSession = supabase.auth.getSession.bind(supabase.auth);
  const origFrom = supabase.from.bind(supabase);

  (supabase.auth as any).getUser = async () => ({
    data: { user: { id: 'member-2', email: 'cuidadora@familia.test' } },
    error: null,
  });
  (supabase.auth as any).getSession = async () => ({
    data: { session: { user: { id: 'member-2' } } },
    error: null,
  });

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const futureYearDate = `${Number(today.slice(0, 4)) + 1}-05-10`;
  const pastYearDate = `${Number(today.slice(0, 4)) - 1}-01-10`;

  (supabase as any).from = (table: string) => {
    switch (table) {
      case 'profiles':
        return makeQueryChain({
          id: 'member-2',
          name: 'Deyse Cuidadora',
          role: 'CAREGIVER',
          family_id: 'fam-1',
        });
      case 'patients':
        return makeQueryChain({
          id: 'pat-1',
          name: 'Dona Maria',
          family_id: 'fam-1',
          photo_url: null,
        });
      case 'family_members':
        return makeQueryChain([
          { id: 'fm-3', user_id: 'member-2', family_id: 'fam-1', role: 'MEMBER' },
        ]);
      case 'meal_configs':
        return makeQueryChain([]);
      case 'medication_periods':
        return makeQueryChain([]);
      case 'medications':
        return makeQueryChain([]);
      case 'activities':
        return makeQueryChain([
          {
            id: 'act-past',
            patient_id: 'pat-1',
            title: 'Consulta Antiga Expirada',
            category: 'medical',
            schedule_type: 'one_time',
            scheduled_date: pastYearDate,
            weekdays: null,
            scheduled_time: '08:00:00',
            active: true,
          },
          {
            id: 'act-future',
            patient_id: 'pat-1',
            title: 'Consulta Obstetra Futura',
            category: 'medical',
            schedule_type: 'one_time',
            scheduled_date: futureYearDate,
            weekdays: null,
            scheduled_time: '14:00:00',
            active: true,
          },
          {
            id: 'act-weekly',
            patient_id: 'pat-1',
            title: 'Yoga em Grupo',
            category: 'wellness',
            schedule_type: 'weekly',
            scheduled_date: null,
            weekdays: ['Tuesday', 'Thursday'],
            scheduled_time: '16:00:00',
            active: true,
          },
        ]);
      default:
        return makeQueryChain([]);
    }
  };

  try {
    await act(async () => {
      root.render(React.createElement(ThemeProvider, null, React.createElement(RoutineScreen)));
      await new Promise((r) => setTimeout(r, 140));
    });

    assert.match(container.textContent || '', /Atividades/);
    assert.match(container.textContent || '', /Agendadas \(data marcada\)/);
    assert.match(container.textContent || '', /Recorrentes \(toda semana\)/);
    assert.match(container.textContent || '', /Consulta Obstetra Futura/);
    assert.match(container.textContent || '', /Yoga em Grupo/);
    assert.equal(
      (container.textContent || '').includes('Consulta Antiga Expirada'),
      false,
      'Atividades antigas de data única não devem poluir a lista ativa em Rotina'
    );

    const addBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.includes('Adicionar') && !b.textContent?.includes('Período')
    );
    assert.ok(addBtn, 'Cuidadora/membro não-ADM deve poder adicionar atividade em Rotina');

    await act(async () => {
      addBtn.click();
    });
    assert.match(container.textContent || '', /Nova Atividade/);
    assert.match(container.textContent || '', /Data específica/);
    assert.match(container.textContent || '', /Dias da semana/);
  } finally {
    await act(async () => root.unmount());
    (supabase.auth as any).getUser = origAuthGetUser;
    (supabase.auth as any).getSession = origAuthGetSession;
    (supabase as any).from = origFrom;
    dom.window.close();
  }
});
