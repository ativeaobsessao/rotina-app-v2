import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import { ThemeProvider } from '../src/contexts/ThemeContext.tsx';
import { NetworkProvider } from '../src/contexts/NetworkContext.tsx';
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
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
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

function makeDeferred<T>() {
  let resolve!: (val: T) => void;
  let reject!: (err: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createQueryChain(getResult: () => Promise<{ data: any; error: any }> | { data: any; error: any }) {
  const exec = () => Promise.resolve(getResult());
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    neq: () => chain,
    gte: () => chain,
    lte: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => exec(),
    single: () => exec(),
    then: (onFulfilled: any, onRejected: any) => exec().then(onFulfilled, onRejected),
  };
  return chain;
}

test('selecting a familiar card enters TodayScreen on the first tap and never bounces back when slow background checkPatient finishes', async () => {
  const dom = setupDom();
  const container = dom.window.document.getElementById('root')!;

  const fakeSession = {
    access_token: 'tok-123',
    user: { id: 'user-1', email: 'familiar@duca.app' },
  };
  dom.window.localStorage.setItem('sb-test-auth-token', JSON.stringify(fakeSession));
  dom.window.localStorage.setItem(
    'duca_cached_context_patients',
    JSON.stringify([
      {
        id: 'pat-1',
        name: 'Vovó Dude',
        photo: null,
        familyId: 'fam-1',
        gender: 'F',
      },
    ])
  );

  const origGetSession = supabase.auth.getSession.bind(supabase.auth);
  const origGetUser = supabase.auth.getUser.bind(supabase.auth);
  const origOnAuthStateChange = supabase.auth.onAuthStateChange.bind(supabase.auth);
  const origFrom = supabase.from.bind(supabase);
  const origRpc = (supabase as any).rpc.bind(supabase);

  const slowMemberships = makeDeferred<{ data: any; error: any }>();
  const rpcCalls: Array<{ fn: string; args: any }> = [];

  (supabase.auth as any).getSession = async () => ({
    data: { session: fakeSession },
    error: null,
  });
  (supabase.auth as any).getUser = async () => ({
    data: { user: fakeSession.user },
    error: null,
  });
  (supabase.auth as any).onAuthStateChange = () => ({
    data: { subscription: { unsubscribe: () => {} } },
  });

  (supabase as any).rpc = async (fn: string, args: any) => {
    rpcCalls.push({ fn, args });
    return { data: null, error: null };
  };

  (supabase as any).from = (table: string) => {
    return createQueryChain(async () => {
      if (table === 'family_members') {
        return await slowMemberships.promise;
      }
      if (table === 'profiles') {
        return {
          data: {
            id: 'user-1',
            name: 'Gustavo',
            email: 'familiar@duca.app',
            family_id: 'fam-1',
            role: 'ADMIN',
          },
          error: null,
        };
      }
      if (table === 'patients') {
        return {
          data: {
            id: 'pat-1',
            name: 'Vovó Dude',
            family_id: 'fam-1',
            gender: 'F',
            photo_url: null,
          },
          error: null,
        };
      }
      if (table === 'daily_mood_logs' || table === 'daily_closures') {
        return { data: null, error: null };
      }
      return { data: [], error: null };
    });
  };

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(NetworkProvider, null, React.createElement(App))
        )
      );
      await new Promise((r) => setTimeout(r, 25));
    });

    // Must immediately show ContextSelectorScreen with Vovó Dude card
    assert.match(container.textContent || '', /Vovó Dude/);
    assert.match(container.textContent || '', /Como está/);

    const cardButton = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => (b.textContent || '').includes('Vovó Dude')
    );
    assert.ok(cardButton, 'Card button for Vovó Dude should exist');

    // First tap while background checkPatient is still pending on slowMemberships
    await act(async () => {
      cardButton.click();
      await new Promise((r) => setTimeout(r, 40));
    });

    assert.equal(rpcCalls.length, 1);
    assert.deepEqual(rpcCalls[0], { fn: 'set_active_family', args: { p_family_id: 'fam-1' } });
    assert.equal(dom.window.sessionStorage.getItem('duca_context_selected'), '1');

    // Should already have transitioned away from ContextSelectorScreen and show DUCA TodayScreen skeleton/header
    assert.doesNotMatch(container.textContent || '', /Qual familiar você vai acompanhar hoje|Sair da conta/);
    assert.match(container.textContent || '', /DUCA/);
    assert.match(container.textContent || '', /Vovó Dude/);

    // Now simulate the slow background checkPatient finishing AFTER the 1st tap!
    await act(async () => {
      slowMemberships.resolve({
        data: [{ id: 'fm-1', family_id: 'fam-1', user_id: 'user-1', role: 'ADMIN' }],
        error: null,
      });
      await new Promise((r) => setTimeout(r, 60));
    });

    // Critical regression check: must STAY in TodayScreen, NEVER bounce back to ContextSelectorScreen!
    assert.doesNotMatch(container.textContent || '', /Sair da conta/);
    assert.match(container.textContent || '', /DUCA/);
    assert.match(container.textContent || '', /Vovó Dude/);
  } finally {
    (supabase.auth as any).getSession = origGetSession;
    (supabase.auth as any).getUser = origGetUser;
    (supabase.auth as any).onAuthStateChange = origOnAuthStateChange;
    (supabase as any).from = origFrom;
    (supabase as any).rpc = origRpc;
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('LaunchIntro shows centered DUCA brand immediately while session loads and transitions without artificial delay', async () => {
  const dom = setupDom();
  const container = dom.window.document.getElementById('root')!;

  const origGetSession = supabase.auth.getSession.bind(supabase.auth);
  const origOnAuthStateChange = supabase.auth.onAuthStateChange.bind(supabase.auth);

  const sessionDeferred = makeDeferred<{ data: { session: null }; error: null }>();
  (supabase.auth as any).getSession = () => sessionDeferred.promise;
  (supabase.auth as any).onAuthStateChange = () => ({
    data: { subscription: { unsubscribe: () => {} } },
  });

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(NetworkProvider, null, React.createElement(App))
        )
      );
      await new Promise((r) => setTimeout(r, 10));
    });

    const intro = container.querySelector('[role="status"][aria-label="Iniciando DUCA"]');
    assert.ok(intro, 'LaunchIntro should render while loading');
    assert.match(intro.textContent || '', /DUCA/);

    await act(async () => {
      sessionDeferred.resolve({ data: { session: null }, error: null });
      await new Promise((r) => setTimeout(r, 20));
    });

    assert.equal(
      container.querySelector('[role="status"][aria-label="Iniciando DUCA"]'),
      null,
      'LaunchIntro should disappear immediately once session check completes'
    );
    assert.match(container.textContent || '', /Entrar/);
  } finally {
    (supabase.auth as any).getSession = origGetSession;
    (supabase.auth as any).onAuthStateChange = origOnAuthStateChange;
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('modified login/context files contain zero forbidden words', () => {
  const files = [
    'src/components/ui/LaunchIntro.tsx',
    'src/pages/ContextSelector.tsx',
    'src/App.tsx',
    'src/pages/Today.tsx',
  ];
  for (const rel of files) {
    const content = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
    assert.equal(
      /\b(apple|paciente)\b/i.test(content),
      false,
      `Forbidden term found in ${rel}`
    );
  }
});
