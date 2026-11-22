import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import React from 'react';
import { act } from 'react';
import {
  filterShoppingHistoryItems,
  formatPriceBRL,
  isExpiredShoppingPurchase,
  parsePriceInputToCents,
  sortPendingShoppingItems,
  summarizeShoppingExpenses,
  type ShoppingItemRecord,
} from '../src/utils/shopping.ts';
import { getLocalDateString, shiftDateString } from '../src/utils/date.ts';
import { supabase } from '../src/services/supabase.ts';
import { ThemeProvider } from '../src/contexts/ThemeContext.tsx';
import { ShoppingReportModal } from '../src/components/history/ShoppingReportModal.tsx';

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
  (globalThis as any).localStorage = dom.window.localStorage;
  (globalThis as any).sessionStorage = dom.window.sessionStorage;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

  if (typeof dom.window.URL.createObjectURL !== 'function') {
    dom.window.URL.createObjectURL = () => 'blob:mock-pdf';
  }
  if (typeof dom.window.URL.revokeObjectURL !== 'function') {
    dom.window.URL.revokeObjectURL = () => {};
  }
  if (typeof (globalThis as any).URL?.createObjectURL !== 'function') {
    (globalThis as any).URL.createObjectURL = () => 'blob:mock-pdf';
  }
  if (typeof (globalThis as any).URL?.revokeObjectURL !== 'function') {
    (globalThis as any).URL.revokeObjectURL = () => {};
  }

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

  const { createRoot } = await import('react-dom/client');
  return { dom, createRoot };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const proto = Object.getPrototypeOf(input);
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
}

function makeShoppingItem(overrides: Partial<ShoppingItemRecord> = {}): ShoppingItemRecord {
  return {
    id: 'shop-1',
    family_id: 'fam-1',
    patient_id: 'pat-1',
    name: 'Leite sem lactose',
    quantity: '2 caixas',
    notes: 'Integral',
    is_urgent: false,
    status: 'pending',
    price_cents: null,
    requested_by: 'caregiver-1',
    purchased_by: null,
    purchased_at: null,
    purchased_date: null,
    updated_by: 'caregiver-1',
    created_at: '2026-11-20T12:00:00.000Z',
    updated_at: '2026-11-20T12:00:00.000Z',
    requester: { name: 'Cuidadora Ana' },
    purchaser: null,
    updater: { name: 'Cuidadora Ana' },
    ...overrides,
  };
}

// ============================================================================
// 1. SQL + GUARDRAILS (Sem termos proibidos)
// ============================================================================

test('[SQL + Guardrails] Migration 0023 define shopping_items, autoexclusão em 6 meses, RLS completo e zero termos proibidos no front-end', () => {
  const sql = fs.readFileSync(
    path.resolve('supabase/migrations/0023_shopping_list_and_history.sql'),
    'utf8'
  );

  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.shopping_items/i);
  assert.match(sql, /status IN \('pending', 'purchased'\)/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.purge_expired_shopping_items/i);
  assert.match(sql, /INTERVAL '6 months'/i);
  assert.match(sql, /CREATE TRIGGER trg_purge_expired_shopping_items/i);
  assert.match(sql, /FOR SELECT/i);
  assert.match(sql, /FOR INSERT/i);
  assert.match(sql, /FOR UPDATE/i);
  assert.match(sql, /FOR DELETE/i);

  const filesToCheck = [
    'src/utils/shopping.ts',
    'src/services/api.ts',
    'src/types/database.types.ts',
    'src/components/ui/ConfirmDialog.tsx',
    'src/components/shopping/ShoppingHomeCard.tsx',
    'src/components/shopping/ShoppingListModal.tsx',
    'src/components/shopping/ShoppingItemEditModal.tsx',
    'src/components/history/ShoppingHistoryCard.tsx',
    'src/components/history/ShoppingHistoryPanel.tsx',
    'src/components/history/ShoppingReportModal.tsx',
    'src/pages/Today.tsx',
    'src/pages/History.tsx',
  ];

  for (const relPath of filesToCheck) {
    const content = fs.readFileSync(path.resolve(relPath), 'utf8');
    assert.equal(
      /\bapple\b/i.test(content),
      false,
      `Termo proibido encontrado em ${relPath}: apple`
    );
    assert.equal(
      /\bpaciente\b/i.test(content),
      false,
      `Termo proibido encontrado em ${relPath}: paciente`
    );
  }
});

// ============================================================================
// 2. UNITÁRIOS (Preços, expiração 6 meses, filtro e resumo de gastos)
// ============================================================================

test('[Unitário] Parsing/formatação de preço, ordenação, expiração > 6 meses e resumo mensal/semestral', () => {
  assert.equal(parsePriceInputToCents(''), null);
  assert.equal(parsePriceInputToCents('   '), null);
  assert.equal(parsePriceInputToCents('34,90'), 3490);
  assert.equal(parsePriceInputToCents('R$ 1.250,55'), 125055);
  assert.equal(parsePriceInputToCents('19.9'), 1990);
  assert.throws(() => parsePriceInputToCents('abc'), /valor válido/i);

  assert.match(formatPriceBRL(3490), /34,90/);
  assert.equal(formatPriceBRL(null), 'Sem valor');

  const now = new Date('2026-11-21T15:00:00.000Z');
  assert.equal(isExpiredShoppingPurchase(null, now), false);
  assert.equal(isExpiredShoppingPurchase('2026-06-01T12:00:00.000Z', now), false);
  assert.equal(isExpiredShoppingPurchase('2026-05-01T12:00:00.000Z', now), true);

  const sorted = sortPendingShoppingItems([
    makeShoppingItem({ id: 'a', is_urgent: false, created_at: '2026-11-21T08:00:00Z' }),
    makeShoppingItem({ id: 'b', is_urgent: true, created_at: '2026-11-21T10:00:00Z' }),
    makeShoppingItem({ id: 'c', is_urgent: true, created_at: '2026-11-21T09:00:00Z' }),
  ]);
  assert.deepEqual(
    sorted.map((s) => s.id),
    ['c', 'b', 'a']
  );

  const items: ShoppingItemRecord[] = [
    makeShoppingItem({
      id: 'p-1',
      name: 'Fralda G',
      notes: 'Pacote econômico',
      is_urgent: true,
      status: 'purchased',
      price_cents: 8990,
      purchased_at: new Date().toISOString(),
      purchased_date: getLocalDateString(),
      requester: { name: 'Cuidadora Ana' },
      purchaser: { name: 'Filho Pedro' },
    }),
    makeShoppingItem({
      id: 'p-2',
      name: 'Nutren Senior',
      notes: 'Sem sabor',
      is_urgent: false,
      status: 'purchased',
      price_cents: 12000,
      purchased_at: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
      purchased_date: shiftDateString(getLocalDateString(), -35),
      requester: { name: 'Cuidadora Ana' },
      purchaser: { name: 'Filho Pedro' },
    }),
    makeShoppingItem({
      id: 'p-old',
      name: 'Item antigo > 6 meses',
      status: 'purchased',
      price_cents: 5000,
      purchased_at: '2025-01-01T12:00:00.000Z',
      purchased_date: '2025-01-01',
    }),
  ];

  const filteredUrgent = filterShoppingHistoryItems(items, {
    query: 'fralda',
    urgentOnly: true,
  });
  assert.equal(filteredUrgent.length, 1);
  assert.equal(filteredUrgent[0].id, 'p-1');

  const allActive = filterShoppingHistoryItems(items, {});
  assert.equal(allActive.length, 2);

  const summary = summarizeShoppingExpenses(allActive, items, getLocalDateString());
  assert.equal(summary.totalCents, 20990);
  assert.equal(summary.currentMonthCents, 8990);
  assert.equal(summary.semesterCents, 20990);
  assert.equal(summary.urgentCount, 1);
});

// ============================================================================
// 3. INTEGRAÇÃO REACT - HOME (Posicionamento, criação urgente, compra, exclusão com pop-up)
// ============================================================================

test('[React/JSDOM - Home] TodayScreen posiciona Lista de Compras abaixo do Recado e acima do Progresso Diário e executa adicionar, comprar e excluir com confirmação', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  const todayStr = getLocalDateString();
  let shoppingStore: ShoppingItemRecord[] = [
    makeShoppingItem({
      id: 'shop-urgent-1',
      name: 'Fralda geriátrica',
      quantity: '2 pacotes',
      is_urgent: true,
      created_at: '2026-11-20T09:00:00.000Z',
    }),
    makeShoppingItem({
      id: 'shop-normal-1',
      name: 'Aveia em flocos',
      quantity: '1 caixa',
      is_urgent: false,
      created_at: '2026-11-20T10:00:00.000Z',
    }),
  ];

  const origAuthGetUser = supabase.auth.getUser.bind(supabase.auth);
  const origAuthGetSession = supabase.auth.getSession.bind(supabase.auth);
  const origFrom = (supabase as any).from;
  const origRpc = (supabase as any).rpc;
  const origChannel = (supabase as any).channel;
  const origRemoveChannel = (supabase as any).removeChannel;

  const makeStaticChain = (rows: any) => {
    const res = { data: rows, error: null };
    const singleRes = { data: Array.isArray(rows) ? rows[0] ?? null : rows, error: null };
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      gte: () => chain,
      lte: () => chain,
      order: () => chain,
      limit: () => chain,
      single: async () => singleRes,
      maybeSingle: async () => singleRes,
      then: (resolve: (v: any) => any) => Promise.resolve(res).then(resolve),
    };
    return chain;
  };

  const makeShoppingChain = () => {
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: any = null;
    const filters: Record<string, any> = {};

    const execute = async () => {
      if (op === 'insert') {
        const created: ShoppingItemRecord = {
          id: `shop-${shoppingStore.length + 1}`,
          family_id: payload.family_id,
          patient_id: payload.patient_id,
          name: payload.name,
          quantity: payload.quantity ?? null,
          notes: payload.notes ?? null,
          is_urgent: Boolean(payload.is_urgent),
          status: 'pending',
          price_cents: null,
          requested_by: payload.requested_by,
          purchased_by: null,
          purchased_at: null,
          purchased_date: null,
          updated_by: payload.updated_by,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          requester: { name: 'Cuidadora Ana' },
          purchaser: null,
          updater: { name: 'Cuidadora Ana' },
        };
        shoppingStore.push(created);
        return { data: created, error: null };
      }

      if (op === 'update') {
        const idx = shoppingStore.findIndex((item) => item.id === filters.id);
        if (idx >= 0) {
          shoppingStore[idx] = {
            ...shoppingStore[idx],
            ...payload,
            purchaser:
              payload.status === 'purchased' ? { name: 'Cuidadora Ana' } : null,
          };
          return { data: shoppingStore[idx], error: null };
        }
        return { data: null, error: null };
      }

      if (op === 'delete') {
        shoppingStore = shoppingStore.filter((item) => item.id !== filters.id);
        return { data: null, error: null };
      }

      const filtered = shoppingStore.filter((item) => {
        if (filters.patient_id && item.patient_id !== filters.patient_id) return false;
        if (filters.status && item.status !== filters.status) return false;
        return true;
      });
      return { data: filtered, error: null };
    };

    const chain: any = {
      select: () => chain,
      insert: (data: any) => {
        op = 'insert';
        payload = data;
        return chain;
      },
      update: (data: any) => {
        op = 'update';
        payload = data;
        return chain;
      },
      delete: () => {
        op = 'delete';
        return chain;
      },
      eq: (col: string, val: any) => {
        filters[col] = val;
        return chain;
      },
      in: () => chain,
      gte: () => chain,
      lte: () => chain,
      order: () => chain,
      limit: () => chain,
      single: async () => execute(),
      maybeSingle: async () => execute(),
      then: (resolve: (v: any) => any) => execute().then(resolve),
    };
    return chain;
  };

  (supabase.auth as any).getUser = async () => ({
    data: { user: { id: 'caregiver-1', email: 'ana@duca.local' } },
    error: null,
  });
  (supabase.auth as any).getSession = async () => ({
    data: { session: { user: { id: 'caregiver-1', email: 'ana@duca.local' } } },
    error: null,
  });
  (supabase as any).rpc = async () => ({ data: 0, error: null });
  (supabase as any).channel = () => {
    const ch: any = { on: () => ch, subscribe: () => ch, unsubscribe: async () => 'ok' };
    return ch;
  };
  (supabase as any).removeChannel = async () => 'ok';

  (supabase as any).from = (table: string) => {
    switch (table) {
      case 'profiles':
        return makeStaticChain({
          id: 'caregiver-1',
          family_id: 'fam-1',
          name: 'Cuidadora Ana',
          email: 'ana@duca.local',
        });
      case 'patients':
        return makeStaticChain([
          { id: 'pat-1', family_id: 'fam-1', name: 'Dona Maria', photo_url: null, gender: 'F' },
        ]);
      case 'family_members':
        return makeStaticChain([
          { id: 'fm-1', user_id: 'caregiver-1', family_id: 'fam-1', role: 'MEMBER', member_type: 'CAREGIVER' },
        ]);
      case 'meal_configs':
        return makeStaticChain([
          {
            id: 'mc-1',
            patient_id: 'pat-1',
            name: 'Café da manhã',
            type: 'breakfast',
            scheduled_time: '08:00:00',
            display_order: 1,
            active: true,
          },
        ]);
      case 'daily_mood_logs':
        return makeStaticChain({
          id: 'mood-1',
          patient_id: 'pat-1',
          family_id: 'fam-1',
          date: todayStr,
          mood: 'happy',
          pain_level: 'none',
          pain_locations: [],
          notes: 'Recado importante da manhã.',
        });
      case 'shopping_items':
        return makeShoppingChain();
      case 'daily_closures':
        return makeStaticChain(null);
      default:
        return makeStaticChain([]);
    }
  };

  try {
    const { TodayScreen } = await import('../src/pages/Today.tsx');

    await act(async () => {
      root.render(
        React.createElement(ThemeProvider, null, React.createElement(TodayScreen))
      );
      await new Promise((r) => setTimeout(r, 150));
    });

    // Verificar ordem exata no DOM: Recado -> Lista de compras -> Progresso diário
    const text = container.textContent || '';
    const recadoPos = text.indexOf('Recado:');
    const shoppingPos = text.indexOf('Compra urgente');
    const progressPos = text.indexOf('Progresso diário');

    assert.ok(recadoPos >= 0, 'Recado deve estar visível');
    assert.ok(shoppingPos > recadoPos, 'Lista de compras deve aparecer abaixo do Recado');
    assert.ok(progressPos > shoppingPos, 'Lista de compras deve aparecer acima do Progresso diário');
    assert.match(text, /Fralda geriátrica/);

    // 1) Abrir modal via clique em "+ Item"
    const quickAddBtn = container.querySelector(
      'button[aria-label="Adicionar item na lista de compras"]'
    ) as HTMLButtonElement | null;
    assert.ok(quickAddBtn);

    await act(async () => {
      quickAddBtn.click();
    });

    assert.match(container.textContent || '', /Novo item para comprar/);

    const nameInput = container.querySelector(
      'input[placeholder*="Leite sem lactose"]'
    ) as HTMLInputElement;
    assert.ok(nameInput);

    await act(async () => {
      setInputValue(nameInput, 'Pomada preventiva');
    });

    const urgentBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.includes('Comprar urgente')
    );
    assert.ok(urgentBtn);
    await act(async () => {
      urgentBtn.click();
    });

    const addSubmitBtn = (
      Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]
    ).find((b) => b.textContent?.includes('Adicionar à lista'));
    assert.ok(addSubmitBtn);

    await act(async () => {
      addSubmitBtn.click();
      await new Promise((r) => setTimeout(r, 100));
    });

    assert.match(container.textContent || '', /Pomada preventiva/);
    assert.equal(shoppingStore.length, 3);

    // 2) Marcar "Fralda geriátrica" como comprado informando valor R$ 72,50
    const fraldaCard = (
      Array.from(container.querySelectorAll('div')) as HTMLDivElement[]
    ).find(
      (div) =>
        div.textContent?.includes('Fralda geriátrica') &&
        div.querySelector('button[aria-label="Editar Fralda geriátrica"]')
    );
    assert.ok(fraldaCard);
    const fraldaPurchaseBtn = (
      Array.from(fraldaCard.querySelectorAll('button')) as HTMLButtonElement[]
    ).find((b) => b.textContent?.trim() === 'Comprado');
    assert.ok(fraldaPurchaseBtn);

    await act(async () => {
      fraldaPurchaseBtn.click();
    });

    assert.match(container.textContent || '', /Confirmar compra/);
    const priceInput = container.querySelector('input[placeholder="0,00"]') as HTMLInputElement;
    assert.ok(priceInput);
    await act(async () => {
      setInputValue(priceInput, '72,50');
    });

    const confirmPurchaseBtn = (
      Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]
    ).find((b) => b.textContent?.trim() === 'Confirmar compra');
    assert.ok(confirmPurchaseBtn);

    await act(async () => {
      confirmPurchaseBtn.click();
      await new Promise((r) => setTimeout(r, 120));
    });

    const purchasedRow = shoppingStore.find((s) => s.id === 'shop-urgent-1');
    assert.equal(purchasedRow?.status, 'purchased');
    assert.equal(purchasedRow?.price_cents, 7250);

    // 3) Excluir definitivamente "Aveia em flocos" via pop-up de confirmação
    const deleteAveiaBtn = container.querySelector(
      'button[aria-label="Apagar Aveia em flocos"]'
    ) as HTMLButtonElement | null;
    assert.ok(deleteAveiaBtn);

    await act(async () => {
      deleteAveiaBtn.click();
    });

    assert.match(container.textContent || '', /Apagar item da lista\?/);
    const confirmDeleteBtn = (
      Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]
    ).find((b) => b.textContent?.trim() === 'Apagar definitivamente');
    assert.ok(confirmDeleteBtn);

    await act(async () => {
      confirmDeleteBtn.click();
      await new Promise((r) => setTimeout(r, 100));
    });

    assert.equal(shoppingStore.some((s) => s.id === 'shop-normal-1'), false);
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

// ============================================================================
// 4. INTEGRAÇÃO REACT - HISTÓRICO (Intercalação de cards, pesquisa, voltar item, PDF)
// ============================================================================

test('[React/JSDOM - Histórico] HistoryScreen intercala ShoppingHistoryCard entre dias, filtra compras e permite devolver item para a Lista de Compras', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  const todayStr = getLocalDateString();
  const yesterdayStr = shiftDateString(todayStr, -1);
  const twoDaysAgoStr = shiftDateString(todayStr, -2);

  let shoppingStore: ShoppingItemRecord[] = [
    makeShoppingItem({
      id: 'hist-shop-1',
      name: 'Ensure Baunilha',
      quantity: '3 latas',
      is_urgent: true,
      status: 'purchased',
      price_cents: 16500,
      purchased_by: 'family-1',
      purchased_at: `${yesterdayStr}T16:15:00.000Z`,
      purchased_date: yesterdayStr,
      requester: { name: 'Cuidadora Ana' },
      purchaser: { name: 'Filho João' },
    }),
    makeShoppingItem({
      id: 'hist-shop-2',
      name: 'Sabonete líquido neutro',
      quantity: '1 frasco',
      is_urgent: false,
      status: 'purchased',
      price_cents: 2490,
      purchased_by: 'family-1',
      purchased_at: `${todayStr}T10:00:00.000Z`,
      purchased_date: todayStr,
      requester: { name: 'Cuidadora Ana' },
      purchaser: { name: 'Filho João' },
    }),
  ];

  const origAuthGetUser = supabase.auth.getUser.bind(supabase.auth);
  const origAuthGetSession = supabase.auth.getSession.bind(supabase.auth);
  const origFrom = (supabase as any).from;
  const origRpc = (supabase as any).rpc;

  const makeStaticChain = (rows: any) => {
    const res = { data: rows, error: null };
    const singleRes = { data: Array.isArray(rows) ? rows[0] ?? null : rows, error: null };
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      gte: () => chain,
      lte: () => chain,
      lt: () => chain,
      order: () => chain,
      limit: () => chain,
      single: async () => singleRes,
      maybeSingle: async () => singleRes,
      then: (resolve: (v: any) => any) => Promise.resolve(res).then(resolve),
    };
    return chain;
  };

  const makeShoppingChain = () => {
    let op: 'select' | 'update' | 'delete' = 'select';
    let payload: any = null;
    const filters: Record<string, any> = {};

    const execute = async () => {
      if (op === 'update') {
        const idx = shoppingStore.findIndex((i) => i.id === filters.id);
        if (idx >= 0) {
          shoppingStore[idx] = { ...shoppingStore[idx], ...payload };
          return { data: shoppingStore[idx], error: null };
        }
        return { data: null, error: null };
      }
      if (op === 'delete') {
        shoppingStore = shoppingStore.filter((i) => i.id !== filters.id);
        return { data: null, error: null };
      }
      return {
        data: shoppingStore.filter((i) => !filters.status || i.status === filters.status),
        error: null,
      };
    };

    const chain: any = {
      select: () => chain,
      update: (d: any) => {
        op = 'update';
        payload = d;
        return chain;
      },
      delete: () => {
        op = 'delete';
        return chain;
      },
      eq: (c: string, v: any) => {
        filters[c] = v;
        return chain;
      },
      gte: () => chain,
      lte: () => chain,
      order: () => chain,
      single: async () => execute(),
      maybeSingle: async () => execute(),
      then: (resolve: (v: any) => any) => execute().then(resolve),
    };
    return chain;
  };

  (supabase.auth as any).getUser = async () => ({
    data: { user: { id: 'family-1', email: 'joao@duca.local' } },
    error: null,
  });
  (supabase.auth as any).getSession = async () => ({
    data: { session: { user: { id: 'family-1', email: 'joao@duca.local' } } },
    error: null,
  });
  (supabase as any).rpc = async () => ({ data: 0, error: null });

  (supabase as any).from = (table: string) => {
    switch (table) {
      case 'profiles':
        return makeStaticChain({
          id: 'family-1',
          family_id: 'fam-1',
          name: 'Filho João',
          email: 'joao@duca.local',
        });
      case 'patients':
        return makeStaticChain([
          { id: 'pat-1', family_id: 'fam-1', name: 'Dona Maria', photo_url: null, gender: 'F' },
        ]);
      case 'family_members':
        return makeStaticChain([
          { id: 'fm-2', user_id: 'family-1', family_id: 'fam-1', role: 'ADMIN', member_type: 'FAMILY' },
        ]);
      case 'meal_logs':
        return makeStaticChain([
          {
            id: 'ml-yest',
            meal_config_id: 'mc-1',
            patient_id: 'pat-1',
            event_date: yesterdayStr,
            consumption_status: 'normal',
            description: 'Sopa de legumes',
            created_by: 'caregiver-1',
            created_at: `${yesterdayStr}T15:00:00.000Z`,
            meal_config: { id: 'mc-1', name: 'Almoço', scheduled_time: '12:00:00' },
            creator: { name: 'Cuidadora Ana' },
          },
          {
            id: 'ml-2days',
            meal_config_id: 'mc-1',
            patient_id: 'pat-1',
            event_date: twoDaysAgoStr,
            consumption_status: 'normal',
            description: 'Mingau de aveia',
            created_by: 'caregiver-1',
            created_at: `${twoDaysAgoStr}T11:00:00.000Z`,
            meal_config: { id: 'mc-1', name: 'Café da manhã', scheduled_time: '08:00:00' },
            creator: { name: 'Cuidadora Ana' },
          },
        ]);
      case 'shopping_items':
        return makeShoppingChain();
      default:
        return makeStaticChain([]);
    }
  };

  try {
    const { HistoryScreen } = await import('../src/pages/History.tsx');

    await act(async () => {
      root.render(
        React.createElement(ThemeProvider, null, React.createElement(HistoryScreen))
      );
      await new Promise((r) => setTimeout(r, 150));
    });

    const pageText = container.textContent || '';
    assert.match(pageText, /Compras e Gastos/);
    assert.match(pageText, /Lista de Compras ·/);
    assert.match(pageText, /R\$\s*189,90/);

    // Expandir painel de pesquisa próprio de compras e pesquisar "Ensure"
    const panelToggleBtn = (
      Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]
    ).find((b) => b.textContent?.includes('Compras e Gastos'));
    assert.ok(panelToggleBtn);

    await act(async () => {
      panelToggleBtn.click();
    });

    const searchInput = container.querySelector(
      'input[placeholder*="Pesquisar item, marca"]'
    ) as HTMLInputElement;
    assert.ok(searchInput);

    await act(async () => {
      setInputValue(searchInput, 'Ensure');
    });

    // Com busca ativa, o card de Ensure expande automaticamente e mostra ação "Voltar"
    const revertBtn = (
      Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]
    ).find((b) => b.textContent?.trim() === 'Voltar');
    assert.ok(revertBtn, 'Botão Voltar para devolver item à Lista de Compras deve aparecer');

    await act(async () => {
      revertBtn.click();
    });

    assert.match(container.textContent || '', /Voltar item para a Lista de Compras\?/);
    const confirmRevertBtn = (
      Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]
    ).find((b) => b.textContent?.trim() === 'Voltar para a lista');
    assert.ok(confirmRevertBtn);

    await act(async () => {
      confirmRevertBtn.click();
      await new Promise((r) => setTimeout(r, 120));
    });

    const reverted = shoppingStore.find((i) => i.id === 'hist-shop-1');
    assert.equal(reverted?.status, 'pending');
    assert.equal(reverted?.price_cents, null);
  } finally {
    await act(async () => root.unmount());
    (supabase.auth as any).getUser = origAuthGetUser;
    (supabase.auth as any).getSession = origAuthGetSession;
    (supabase as any).from = origFrom;
    (supabase as any).rpc = origRpc;
    dom.window.close();
  }
});

test('[React/JSDOM - PDF] ShoppingReportModal gera PDF personalizado por período sem erros', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  const origFrom = (supabase as any).from;
  const origRpc = (supabase as any).rpc;
  const todayStr = getLocalDateString();

  (supabase as any).rpc = async () => ({ data: 0, error: null });
  (supabase as any).from = () => {
    const rows = [
      makeShoppingItem({
        id: 'pdf-1',
        name: 'Leite sem lactose',
        quantity: '6 caixas',
        is_urgent: false,
        status: 'purchased',
        price_cents: 4140,
        purchased_at: `${todayStr}T12:00:00.000Z`,
        purchased_date: todayStr,
        requester: { name: 'Cuidadora Ana' },
        purchaser: { name: 'Filho João' },
      }),
    ];
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      gte: () => chain,
      lte: () => chain,
      order: () => chain,
      then: (resolve: (v: any) => any) => Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return chain;
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(ShoppingReportModal, {
          isOpen: true,
          onClose: () => {},
          patientId: 'pat-1',
          familyId: 'fam-1',
          patientName: 'Dona Maria',
        })
      );
    });

    const downloadBtn = (
      Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]
    ).find((b) => b.textContent?.includes('Baixar PDF de Compras'));
    assert.ok(downloadBtn);

    await act(async () => {
      downloadBtn.click();
      await new Promise((r) => setTimeout(r, 150));
    });

    assert.match(container.textContent || '', /PDF gerado!/);
  } finally {
    await act(async () => root.unmount());
    (supabase as any).from = origFrom;
    (supabase as any).rpc = origRpc;
    dom.window.close();
  }
});
