import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  getActivityMilestoneNotifications,
  getActivityMilestoneBadge,
  dismissActivityMilestone,
  isActivityMilestoneDismissed,
  filterActiveMilestoneAlerts,
  isTimeWithinNotificationWindow,
  urlBase64ToUint8Array,
  arrayBufferToBase64Url,
} from '../src/utils/notifications.ts';
import { NotificationBell } from '../src/components/notifications/NotificationBell.tsx';
import { TodayScreen } from '../src/pages/Today.tsx';
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
            return { objectStore: () => store };
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
  (globalThis as any).Event = dom.window.Event;
  (globalThis as any).CustomEvent = dom.window.CustomEvent;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
    writable: true,
  });
  (dom.window as any).matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  });
  return dom;
}

function makeQueryChain(data: any, error: any = null) {
  const result = { data, error };
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    lt: () => chain,
    lte: () => chain,
    gte: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => result,
    single: async () => result,
    then: (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

test('[SQL + Guardrails] migration 0024, Edge Function, SW e proibição de termos em src/', () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/0024_web_push_notifications.sql'),
    'utf8'
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.push_subscriptions/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.notification_dispatch_logs/i);
  assert.match(sql, /'activity_7d'/);
  assert.match(sql, /'activity_3d'/);
  assert.match(sql, /'activity_1d'/);
  assert.match(sql, /'medication'/);
  assert.match(sql, /'meal'/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.upsert_my_push_subscription/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);

  const fnCode = fs.readFileSync(
    path.join(process.cwd(), 'supabase/functions/dispatch-notifications/index.ts'),
    'utf8'
  );
  assert.match(fnCode, /Deno\.env\.get\('VAPID_PUBLIC_KEY'\)/);
  assert.match(fnCode, /Deno\.env\.get\('VAPID_PRIVATE_KEY'\)/);
  assert.match(fnCode, /constantTimeEqual/);
  assert.match(fnCode, /ACTIVITY_MILESTONES\s*=\s*\[7,\s*3,\s*1\]/);
  assert.match(fnCode, /action\s*===\s*'test'/);

  const swCode = fs.readFileSync(path.join(process.cwd(), 'src/sw.ts'), 'utf8');
  assert.match(swCode, /addEventListener\('push'/);
  assert.match(swCode, /addEventListener\('notificationclick'/);
  assert.match(swCode, /addEventListener\('pushsubscriptionchange'/);
  assert.match(swCode, /supabase-images-cache/);

  const filesToCheck = [
    'src/sw.ts',
    'src/utils/notifications.ts',
    'src/services/pushNotifications.ts',
    'src/components/notifications/NotificationBell.tsx',
    'src/components/notifications/NotificationsModal.tsx',
  ];
  for (const rel of filesToCheck) {
    const content = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
    assert.equal(
      /\b(apple|paciente)\b/i.test(content),
      false,
      `Termo proibido encontrado em ${rel}`
    );
  }
});

test('[Unit] marcos exatos de 7, 3 e 1 dia, dispensa individual e janela de horário', () => {
  const today = '2026-11-10';
  const activities = [
    {
      id: 'act-7d',
      title: 'Cardiologista',
      category: 'medical',
      schedule_type: 'one_time',
      scheduled_date: '2026-11-17',
      scheduled_time: '10:00:00',
      active: true,
    },
    {
      id: 'act-3d',
      title: 'Fisioterapia Motora',
      category: 'wellness',
      schedule_type: 'one_time',
      scheduled_date: '2026-11-13',
      scheduled_time: '14:30:00',
      active: true,
    },
    {
      id: 'act-1d',
      title: 'Exame de Sangue',
      category: 'medical',
      schedule_type: 'one_time',
      scheduled_date: '2026-11-11',
      scheduled_time: '07:30:00',
      active: true,
    },
    {
      id: 'act-5d',
      title: 'Não deve disparar marco 7/3/1',
      category: 'medical',
      schedule_type: 'one_time',
      scheduled_date: '2026-11-15',
      scheduled_time: '09:00:00',
      active: true,
    },
    {
      id: 'act-8d',
      title: 'Longe demais',
      category: 'medical',
      schedule_type: 'one_time',
      scheduled_date: '2026-11-18',
      scheduled_time: '09:00:00',
      active: true,
    },
    {
      id: 'act-weekly',
      title: 'Yoga Semanal',
      category: 'wellness',
      schedule_type: 'weekly',
      weekdays: ['Tuesday'],
      scheduled_time: '09:00:00',
      active: true,
    },
  ];

  const alerts = getActivityMilestoneNotifications(activities, today);
  assert.equal(alerts.length, 3);
  assert.deepEqual(
    alerts.map((a) => [a.activity.id, a.daysUntil, a.notificationType, a.badgeLabel]),
    [
      ['act-1d', 1, 'activity_1d', 'Falta 1 dia'],
      ['act-3d', 3, 'activity_3d', 'Faltam 3 dias'],
      ['act-7d', 7, 'activity_7d', 'Faltam 7 dias'],
    ]
  );
  assert.equal(getActivityMilestoneBadge(7), 'Faltam 7 dias');
  assert.equal(getActivityMilestoneBadge(3), 'Faltam 3 dias');
  assert.equal(getActivityMilestoneBadge(1), 'Falta 1 dia');

  // Dispensa isolada por marco
  const store = new Map<string, string>();
  const memStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };

  assert.equal(isActivityMilestoneDismissed('user-1', 'pat-1', alerts[2], memStorage), false);
  dismissActivityMilestone('user-1', 'pat-1', alerts[2], memStorage); // dispensa marco 7 dias
  assert.equal(isActivityMilestoneDismissed('user-1', 'pat-1', alerts[2], memStorage), true);
  assert.equal(isActivityMilestoneDismissed('user-1', 'pat-1', alerts[1], memStorage), false);
  assert.equal(filterActiveMilestoneAlerts(alerts, 'user-1', 'pat-1', memStorage).length, 2);

  // Janela de horário com antecedência
  assert.equal(isTimeWithinNotificationWindow('08:30:00', 8 * 60 + 30, 0), true);
  assert.equal(isTimeWithinNotificationWindow('08:30:00', 8 * 60 + 20, 10), true);
  assert.equal(isTimeWithinNotificationWindow('08:30:00', 8 * 60 + 10, 10), false);

  // Conversão VAPID base64url <-> bytes
  const sample = new Uint8Array([4, 18, 99, 240, 128, 7]);
  const b64 = arrayBufferToBase64Url(sample.buffer);
  const decoded = urlBase64ToUint8Array(b64);
  assert.deepEqual(Array.from(decoded), Array.from(sample));
});

test('[Integração React] NotificationBell + NotificationsModal exibem avisos de 7/3/1 dia, marcam visto e assinam Web Push', async () => {
  const dom = setupDom();
  const container = document.getElementById('root')!;
  const root = createRoot(container);

  const origGetUser = supabase.auth.getUser.bind(supabase.auth);
  const origFrom = supabase.from.bind(supabase);
  const origRpc = (supabase as any).rpc?.bind(supabase);
  const origEnvVapid = process.env.VITE_VAPID_PUBLIC_KEY;

  // Mock VAPID public key (65 bytes uncompressed P-256 point encoded base64url)
  const fakeVapidBytes = new Uint8Array(65).fill(7);
  fakeVapidBytes[0] = 4;
  process.env.VITE_VAPID_PUBLIC_KEY = arrayBufferToBase64Url(fakeVapidBytes.buffer);

  const rpcCalls: Array<{ fn: string; args: any }> = [];
  let savedSubRow: any = null;

  (supabase.auth as any).getUser = async () => ({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  (supabase as any).from = (table: string) => {
    if (table === 'push_subscriptions') {
      return makeQueryChain(savedSubRow ? [savedSubRow] : []);
    }
    return makeQueryChain([]);
  };
  (supabase as any).rpc = async (fn: string, args: any) => {
    rpcCalls.push({ fn, args });
    savedSubRow = {
      id: 'sub-1',
      user_id: 'user-1',
      family_id: args.p_family_id,
      patient_id: args.p_patient_id,
      endpoint: args.p_endpoint,
      keys_p256dh: args.p_keys_p256dh,
      keys_auth: args.p_keys_auth,
      enabled: args.p_enabled,
      notify_medications: args.p_notify_medications,
      notify_meals: args.p_notify_meals,
      notify_activities: args.p_notify_activities,
      lead_minutes: args.p_lead_minutes,
      timezone: args.p_timezone,
    };
    return { data: savedSubRow, error: null };
  };

  // Mock PushManager, Notification & ServiceWorkerRegistration
  const fakeBrowserSub = {
    endpoint: 'https://push.example/sub/123',
    toJSON: () => ({
      endpoint: 'https://push.example/sub/123',
      keys: { p256dh: 'p256dh-test-key', auth: 'auth-test-key' },
    }),
    unsubscribe: async () => true,
  };
  let currentSub: any = null;
  const fakeReg = {
    pushManager: {
      getSubscription: async () => currentSub,
      subscribe: async () => {
        currentSub = fakeBrowserSub;
        return fakeBrowserSub;
      },
    },
  };
  Object.defineProperty(globalThis.navigator, 'serviceWorker', {
    value: {
      getRegistration: async () => fakeReg,
      ready: Promise.resolve(fakeReg),
    },
    configurable: true,
  });
  const mockPushManager = function () {};
  const mockNotification = {
    permission: 'default',
    requestPermission: async () => {
      mockNotification.permission = 'granted';
      return 'granted';
    },
  };
  (globalThis as any).PushManager = mockPushManager;
  (dom.window as any).PushManager = mockPushManager;
  (globalThis as any).Notification = mockNotification;
  (dom.window as any).Notification = mockNotification;

  const activities = [
    {
      id: 'a7',
      title: 'Oftalmologista',
      category: 'medical',
      schedule_type: 'one_time',
      scheduled_date: '2026-11-17',
      scheduled_time: '09:00:00',
      active: true,
    },
    {
      id: 'a3',
      title: 'Fisioterapia',
      category: 'wellness',
      schedule_type: 'one_time',
      scheduled_date: '2026-11-13',
      scheduled_time: '15:00:00',
      active: true,
    },
    {
      id: 'a1',
      title: 'Exame Laboratorial',
      category: 'medical',
      schedule_type: 'one_time',
      scheduled_date: '2026-11-11',
      scheduled_time: '07:00:00',
      active: true,
    },
  ];

  try {
    await act(async () => {
      root.render(
        React.createElement(NotificationBell, {
          familyId: 'fam-1',
          patientId: 'pat-1',
          patientName: 'Dona Maria',
          userId: 'user-1',
          activities,
          todayDateStr: '2026-11-10',
        })
      );
    });

    const bellBtn = container.querySelector('button[aria-label="Notificações e alertas"]') as HTMLButtonElement;
    assert.ok(bellBtn);
    assert.match(bellBtn.textContent || '', /3/);

    await act(async () => {
      bellBtn.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    const bodyText = document.body.textContent || '';
    assert.match(bodyText, /Faltam 7 dias/);
    assert.match(bodyText, /Faltam 3 dias/);
    assert.match(bodyText, /Falta 1 dia/);
    assert.match(bodyText, /Oftalmologista/);
    assert.match(bodyText, /Fisioterapia/);
    assert.match(bodyText, /Exame Laboratorial/);

    // Marca o primeiro aviso como Visto -> contador cai de 3 para 2
    const seenBtn = (Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.includes('Visto')
    );
    assert.ok(seenBtn);
    await act(async () => {
      seenBtn.click();
    });
    assert.match(bellBtn.textContent || '', /2/);

    // Ativa Web Push no aparelho -> deve chamar upsert_my_push_subscription
    const enableBtn = (Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.trim() === 'Ativar'
    );
    assert.ok(enableBtn, 'Botão Ativar Web Push deve estar visível');
    await act(async () => {
      enableBtn.click();
      await new Promise((r) => setTimeout(r, 60));
    });

    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].fn, 'upsert_my_push_subscription');
    assert.equal(rpcCalls[0].args.p_endpoint, 'https://push.example/sub/123');
    assert.equal(rpcCalls[0].args.p_notify_medications, true);
    assert.equal(rpcCalls[0].args.p_notify_meals, true);
    assert.equal(rpcCalls[0].args.p_notify_activities, true);
  } finally {
    await act(async () => root.unmount());
    (supabase.auth as any).getUser = origGetUser;
    (supabase as any).from = origFrom;
    (supabase as any).rpc = origRpc;
    if (origEnvVapid === undefined) {
      delete process.env.VITE_VAPID_PUBLIC_KEY;
    } else {
      process.env.VITE_VAPID_PUBLIC_KEY = origEnvVapid;
    }
    delete (globalThis as any).PushManager;
    delete (dom.window as any).PushManager;
    delete (globalThis as any).Notification;
    delete (dom.window as any).Notification;
    dom.window.close();
  }
});

test('[Integração React] TodayScreen destaca marcos exatos de 7, 3 e 1 dia no banner da Home', async () => {
  const dom = setupDom();
  const container = document.getElementById('root')!;
  const root = createRoot(container);

  const origAuthGetUser = supabase.auth.getUser.bind(supabase.auth);
  const origAuthGetSession = supabase.auth.getSession.bind(supabase.auth);
  const origFrom = supabase.from.bind(supabase);
  const origChannel = supabase.channel.bind(supabase);
  const origRemoveChannel = supabase.removeChannel.bind(supabase);

  const simulatedNow = new Date('2026-11-10T12:00:00.000Z');

  (supabase.auth as any).getUser = async () => ({
    data: { user: { id: 'member-1' } },
    error: null,
  });
  (supabase.auth as any).getSession = async () => ({
    data: { session: { user: { id: 'member-1' } } },
    error: null,
  });
  (supabase as any).channel = () => ({
    on() {
      return this;
    },
    subscribe() {
      return this;
    },
  });
  (supabase as any).removeChannel = () => {};

  (supabase as any).from = (table: string) => {
    switch (table) {
      case 'profiles':
        return makeQueryChain({ id: 'member-1', name: 'Ana', family_id: 'fam-1' });
      case 'patients':
        return makeQueryChain({ id: 'pat-1', name: 'Dona Maria', family_id: 'fam-1', photo_url: null });
      case 'family_members':
        return makeQueryChain([{ id: 'fm-1', user_id: 'member-1', family_id: 'fam-1', role: 'ADMIN' }]);
      case 'activities':
        return makeQueryChain([
          {
            id: 'act-3d',
            patient_id: 'pat-1',
            title: 'Consulta Neurologista',
            category: 'medical',
            schedule_type: 'one_time',
            scheduled_date: '2026-11-13',
            scheduled_time: '10:00:00',
            active: true,
          },
          {
            id: 'act-1d',
            patient_id: 'pat-1',
            title: 'Coleta de Exames',
            category: 'medical',
            schedule_type: 'one_time',
            scheduled_date: '2026-11-11',
            scheduled_time: '07:30:00',
            active: true,
          },
        ]);
      case 'daily_mood_logs':
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
          React.createElement(TodayScreen, { nowProvider: () => simulatedNow })
        )
      );
      for (let i = 0; i < 20; i += 1) {
        await new Promise((r) => setTimeout(r, 40));
        if (container.querySelector('[aria-label="Aviso de atividade agendada"]')) break;
      }
    });

    const banner = container.querySelector('[aria-label="Aviso de atividade agendada"]');
    assert.ok(banner, 'Banner de atividades próximas deve renderizar na Home');
    assert.match(banner.textContent || '', /Falta 1 dia/);
    assert.match(banner.textContent || '', /Faltam 3 dias/);
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

test('[Regressão UI - Portal nas 3 abas] Sininho abre fora do header sticky (sem cortar ou ocultar logo/menu) em Hoje, Histórico e Rotina com passo a passo e botão Fechar', async () => {
  const dom = setupDom();
  const container = document.getElementById('root')!;
  const root = createRoot(container);

  const origAuthGetUser = supabase.auth.getUser.bind(supabase.auth);
  const origAuthGetSession = supabase.auth.getSession.bind(supabase.auth);
  const origFrom = supabase.from.bind(supabase);
  const origRpc = (supabase as any).rpc?.bind(supabase);
  const origChannel = supabase.channel.bind(supabase);
  const origRemoveChannel = supabase.removeChannel.bind(supabase);

  (supabase.auth as any).getUser = async () => ({
    data: { user: { id: 'member-1', email: 'ana@duca.local' } },
    error: null,
  });
  (supabase.auth as any).getSession = async () => ({
    data: { session: { user: { id: 'member-1', email: 'ana@duca.local' } } },
    error: null,
  });
  (supabase as any).rpc = async () => ({ data: 0, error: null });
  (supabase as any).channel = () => ({
    on() {
      return this;
    },
    subscribe() {
      return this;
    },
  });
  (supabase as any).removeChannel = () => {};

  (supabase as any).from = (table: string) => {
    switch (table) {
      case 'profiles':
        return makeQueryChain({
          id: 'member-1',
          name: 'Ana',
          email: 'ana@duca.local',
          family_id: 'fam-1',
        });
      case 'patients':
        return makeQueryChain([
          { id: 'pat-1', name: 'Dona Maria', family_id: 'fam-1', photo_url: null, gender: 'F' },
        ]);
      case 'family_members':
        return makeQueryChain([
          { id: 'fm-1', user_id: 'member-1', family_id: 'fam-1', role: 'ADMIN', member_type: 'FAMILY' },
        ]);
      case 'daily_mood_logs':
      case 'daily_closures':
        return makeQueryChain(null);
      default:
        return makeQueryChain([]);
    }
  };

  try {
    const { HistoryScreen } = await import('../src/pages/History.tsx');
    const { RoutineScreen } = await import('../src/pages/Routine.tsx');

    const screens = [
      {
        name: 'Hoje',
        element: React.createElement(ThemeProvider, null, React.createElement(TodayScreen)),
        assertHeaderIntact: () => {
          const header = container.querySelector('header');
          assert.ok(header, 'Header de Hoje deve existir');
          assert.match(header.textContent || '', /DUCA/);
          assert.ok(
            header.querySelector('button[aria-label="Menu do usuário"]'),
            'Menu do usuário deve permanecer intacto no topo em Hoje'
          );
        },
      },
      {
        name: 'Histórico',
        element: React.createElement(ThemeProvider, null, React.createElement(HistoryScreen)),
        assertHeaderIntact: () => {
          assert.match(container.textContent || '', /Histórico/);
          assert.ok(
            container.querySelector('button[aria-label="Menu do usuário"]'),
            'Menu do usuário deve permanecer intacto em Histórico'
          );
        },
      },
      {
        name: 'Rotina',
        element: React.createElement(ThemeProvider, null, React.createElement(RoutineScreen)),
        assertHeaderIntact: () => {
          assert.match(container.textContent || '', /Rotina/);
          assert.ok(
            container.querySelector('button[aria-label="Menu do usuário"]'),
            'Menu do usuário deve permanecer intacto em Rotina'
          );
        },
      },
    ];

    for (const screen of screens) {
      await act(async () => {
        root.render(screen.element);
        for (let i = 0; i < 20; i += 1) {
          await new Promise((r) => setTimeout(r, 35));
          if (container.querySelector('button[aria-label="Notificações e alertas"]')) break;
        }
      });

      const bellBtn = container.querySelector(
        'button[aria-label="Notificações e alertas"]'
      ) as HTMLButtonElement | null;
      assert.ok(bellBtn, `Botão do sininho deve existir em ${screen.name}`);

      await act(async () => {
        bellBtn.click();
        await new Promise((r) => setTimeout(r, 40));
      });

      // Modal precisa estar portado para document.body (nunca preso dentro de #root ou <header>)
      const dialog = document.body.querySelector(
        '[role="dialog"][aria-label="Notificações e Alertas"]'
      ) as HTMLElement | null;
      assert.ok(dialog, `Modal de notificações deve abrir em ${screen.name}`);
      assert.equal(
        container.contains(dialog),
        false,
        `Modal em ${screen.name} deve estar fora do header/container via portal`
      );
      assert.equal(
        dialog.parentElement?.parentElement,
        document.body,
        `Backdrop do modal em ${screen.name} deve estar direto em document.body`
      );

      // Header da página permanece intacto (logo + menu do usuário visíveis)
      screen.assertHeaderIntact();

      // Texto empático e passos claros visíveis
      const dialogText = dialog.textContent || '';
      assert.match(dialogText, /Lembretes para cuidar com mais leveza/);
      assert.match(dialogText, /Passo 1/);
      assert.match(dialogText, /Passo 2/);
      assert.match(dialogText, /Passo 3/);

      // Fechamento fácil pelo botão Fechar do rodapé
      const footerCloseBtn = (
        Array.from(dialog.querySelectorAll('button')) as HTMLButtonElement[]
      ).find((b) => b.textContent?.trim() === 'Fechar');
      assert.ok(footerCloseBtn, `Botão Fechar deve existir em ${screen.name}`);

      await act(async () => {
        footerCloseBtn.click();
      });

      assert.equal(
        document.body.querySelector('[role="dialog"][aria-label="Notificações e Alertas"]'),
        null,
        `Modal deve fechar ao clicar em Fechar em ${screen.name}`
      );
    }
  } finally {
    await act(async () => root.unmount());
    (supabase.auth as any).getUser = origAuthGetUser;
    (supabase.auth as any).getSession = origAuthGetSession;
    (supabase as any).from = origFrom;
    (supabase as any).rpc = origRpc;
    (supabase as any).channel = origChannel;
    (supabase as any).removeChannel = origRemoveChannel;
    dom.window.close();
  }
});
