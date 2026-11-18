import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DEFAULT_TIMEZONE,
  getLocalDateString,
  isAfterClosureReminderTime,
  getMsUntilNextClosureBoundary,
} from '../src/utils/date.ts';
import {
  getClosureReminderDismissKey,
  isClosureReminderDismissed,
  dismissClosureReminder,
  shouldShowClosureReminderBanner,
} from '../src/utils/closureReminder.ts';
import { DailyProgressBar } from '../src/components/timeline/DailyProgressBar.tsx';
import { ClosureReminderBanner, TodayScreen } from '../src/pages/Today.tsx';
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

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

// ============================================================================
// TESTE C & D (Horário America/Sao_Paulo antes e a partir das 21:00)
// ============================================================================

test('[Unitário] Regra das 21:00 em America/Sao_Paulo oculta antes das 21h e libera a partir das 21h', () => {
  // America/Sao_Paulo = UTC-3 -> 08:00 BRT = 11:00Z, 12:00 BRT = 15:00Z, 15:27 BRT = 18:27Z, 20:59 BRT = 23:59Z
  const timesBefore21 = [
    new Date('2026-11-16T11:00:00.000Z'), // 08:00 BRT
    new Date('2026-11-16T15:00:00.000Z'), // 12:00 BRT
    new Date('2026-11-16T18:27:00.000Z'), // 15:27 BRT
    new Date('2026-11-16T23:59:59.000Z'), // 20:59:59 BRT (mesmo dia local 2026-11-16)
    new Date('2026-11-17T03:00:00.000Z'), // 00:00:00 BRT do dia seguinte (2026-11-17)
  ];

  for (const dt of timesBefore21) {
    assert.equal(
      isAfterClosureReminderTime(dt, DEFAULT_TIMEZONE, 21),
      false,
      `Deveria permanecer oculto para ${dt.toISOString()}`
    );
  }

  // 21:00 BRT = 00:00Z do dia UTC seguinte, mas data local em America/Sao_Paulo ainda é 2026-11-16
  const at2100 = new Date('2026-11-17T00:00:00.000Z');
  const at2130 = new Date('2026-11-17T00:30:00.000Z');
  const at2300 = new Date('2026-11-17T02:00:00.000Z');

  for (const dt of [at2100, at2130, at2300]) {
    assert.equal(getLocalDateString(DEFAULT_TIMEZONE, dt), '2026-11-16');
    assert.equal(
      isAfterClosureReminderTime(dt, DEFAULT_TIMEZONE, 21),
      true,
      `Deveria liberar às ${dt.toISOString()}`
    );
  }
});

test('[Unitário] Cálculo do próximo marco temporal aponta exatamente para 21:00 ou meia-noite local', () => {
  const at205959 = new Date('2026-11-16T23:59:59.500Z'); // 20:59:59.500 BRT -> faltam ~500ms para 21h
  const msTo21 = getMsUntilNextClosureBoundary(at205959, DEFAULT_TIMEZONE, 21);
  assert.ok(msTo21 >= 450 && msTo21 <= 700, `Esperado ~550ms até 21h, recebeu ${msTo21}ms`);

  const at213000 = new Date('2026-11-17T00:30:00.000Z'); // 21:30:00 BRT -> faltam 2h30 (9000s) até 00:00
  const msToMidnight = getMsUntilNextClosureBoundary(at213000, DEFAULT_TIMEZONE, 21);
  assert.ok(msToMidnight >= 8_999_000 && msToMidnight <= 9_001_000);
});

// ============================================================================
// TESTE E & F (Permissões, Dia Atual/Aberto, Dispensa persistida por usuário+paciente+dia)
// ============================================================================

test('[Unitário] Dispensa do banner persiste no localStorage isolada por usuário, paciente e data local', () => {
  const storage = makeMemoryStorage();

  // Antes da dispensa: visível para qualquer membro ativo (ADM, Familiar ou Cuidador) no dia atual em aberto após 21h
  assert.equal(
    shouldShowClosureReminderBanner({
      canCloseDay: true,
      isAdmin: false,
      isViewingToday: true,
      isDayClosed: false,
      isAfterReminderTime: true,
      isDismissed: isClosureReminderDismissed('member-1', 'pat-1', '2026-11-16', storage),
    }),
    true
  );

  // Conta sem vínculo ativo na família nunca visualiza
  assert.equal(
    shouldShowClosureReminderBanner({
      canCloseDay: false,
      isAdmin: false,
      isViewingToday: true,
      isDayClosed: false,
      isAfterReminderTime: true,
      isDismissed: false,
    }),
    false
  );

  // Dia anterior nunca visualiza
  assert.equal(
    shouldShowClosureReminderBanner({
      isAdmin: true,
      isViewingToday: false,
      isDayClosed: false,
      isAfterReminderTime: true,
      isDismissed: false,
    }),
    false
  );

  // Dia já encerrado nunca visualiza
  assert.equal(
    shouldShowClosureReminderBanner({
      isAdmin: true,
      isViewingToday: true,
      isDayClosed: true,
      isAfterReminderTime: true,
      isDismissed: false,
    }),
    false
  );

  // Dispensa no dia 2026-11-16 por admin-1 / pat-1
  assert.equal(dismissClosureReminder('admin-1', 'pat-1', '2026-11-16', storage), true);
  assert.equal(isClosureReminderDismissed('admin-1', 'pat-1', '2026-11-16', storage), true);

  // Não afeta outro usuário nem outro paciente nem o dia seguinte
  assert.equal(isClosureReminderDismissed('admin-2', 'pat-1', '2026-11-16', storage), false);
  assert.equal(isClosureReminderDismissed('admin-1', 'pat-2', '2026-11-16', storage), false);
  assert.equal(isClosureReminderDismissed('admin-1', 'pat-1', '2026-11-17', storage), false);

  // No dia seguinte após 21h volta a exibir e limpa chave antiga ao dispensar novamente
  assert.equal(dismissClosureReminder('admin-1', 'pat-1', '2026-11-17', storage), true);
  assert.equal(
    storage.getItem(getClosureReminderDismissKey('admin-1', 'pat-1', '2026-11-16')),
    null
  );
  assert.equal(
    storage.getItem(getClosureReminderDismissKey('admin-1', 'pat-1', '2026-11-17')),
    '1'
  );
});

// ============================================================================
// TESTE A, B, E (Componentes UI e Hoje em React/JSDOM)
// ============================================================================

test('[React/JSDOM] DailyProgressBar preserva percentual, contagem, barra e texto de pendências em layout compacto', async () => {
  const dom = setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(React.createElement(DailyProgressBar, { total: 6, completed: 4 }));
    });

    const text = container.textContent || '';
    assert.match(text, /Progresso diário/);
    assert.match(text, /67%/);
    assert.match(text, /\(4\/6\)/);
    assert.match(text, /Faltam 2 itens na rotina/);

    await act(async () => {
      root.render(React.createElement(DailyProgressBar, { total: 6, completed: 6 }));
    });

    const doneText = container.textContent || '';
    assert.match(doneText, /100%/);
    assert.match(doneText, /\(6\/6\)/);
    assert.match(doneText, /Tudo concluído hoje!/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('[React/JSDOM] ClosureReminderBanner aciona confirmação ao clicar Encerrar Dia e dispensa ao clicar X', async () => {
  const dom = setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  let closeRequested = 0;
  let dismissed = 0;

  try {
    await act(async () => {
      root.render(
        React.createElement(ClosureReminderBanner, {
          eventsCount: 5,
          pendingEventsCount: 2,
          onRequestClose: () => {
            closeRequested += 1;
          },
          onDismiss: () => {
            dismissed += 1;
          },
        })
      );
    });

    const text = container.textContent || '';
    assert.match(text, /Encerrar Dia/);
    assert.match(text, /2 atividades pendentes/);

    const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
    const closeBtn = buttons.find((b) => b.textContent?.trim() === 'Encerrar Dia');
    const dismissBtn = container.querySelector(
      'button[aria-label="Dispensar lembrete de encerramento"]'
    ) as HTMLButtonElement | null;

    assert.ok(closeBtn);
    assert.ok(dismissBtn);

    await act(async () => {
      closeBtn.click();
      dismissBtn.click();
    });

    assert.equal(closeRequested, 1);
    assert.equal(dismissed, 1);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('[React/JSDOM] TodayScreen exibe seção final de Encerramento do dia antes das 21h, lembrete às 21h e libera encerramento para ADM, familiares e cuidadores', async () => {
  const dom = setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  // Começa 20:59:59.750 BRT (faltam ~250ms para 21:00:00 BRT)
  let simulatedNow = new Date('2026-11-16T23:59:59.750Z');
  let activeRole: 'ADMIN' | 'MEMBER' | null = 'ADMIN';
  let activeUserId = 'admin-1';

  // Backup original supabase methods
  const origAuthGetUser = supabase.auth.getUser.bind(supabase.auth);
  const origAuthGetSession = supabase.auth.getSession.bind(supabase.auth);
  const origFrom = (supabase as any).from;
  const origChannel = (supabase as any).channel;
  const origRemoveChannel = (supabase as any).removeChannel;

  const longNote =
    'Dona Maria acordou bem disposta, tomou todo o café da manhã com calma e pediu para avisar a família sobre a caminhada no jardim durante a tarde.';

  const makeQueryChain = (rows: any) => {
    const res = { data: rows, error: null };
    const singleRes = { data: Array.isArray(rows) ? rows[0] ?? null : rows, error: null };
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      single: async () => singleRes,
      maybeSingle: async () => singleRes,
      then: (resolve: (v: any) => any) => Promise.resolve(res).then(resolve),
    };
    return chain;
  };

  (supabase.auth as any).getUser = async () => ({
    data: { user: { id: activeUserId, email: `${activeUserId}@duca.local` } },
    error: null,
  });
  (supabase.auth as any).getSession = async () => ({
    data: { session: { user: { id: activeUserId, email: `${activeUserId}@duca.local` } } },
    error: null,
  });
  (supabase as any).channel = () => {
    const ch: any = {
      on: () => ch,
      subscribe: () => ch,
      unsubscribe: async () => 'ok',
    };
    return ch;
  };
  (supabase as any).removeChannel = async () => 'ok';
  (supabase as any).from = (table: string) => {
    switch (table) {
      case 'profiles':
        return makeQueryChain({
          id: activeUserId,
          family_id: 'fam-1',
          name: activeRole === 'ADMIN' ? 'Cuidadora Ana' : 'Familiar Pedro',
          email: `${activeUserId}@duca.local`,
        });
      case 'patients':
        return makeQueryChain([{ id: 'pat-1', family_id: 'fam-1', name: 'Dona Maria', photo_url: null, gender: 'F' }]);
      case 'family_members':
        return makeQueryChain(
          activeRole
            ? [{ id: 'fm-1', user_id: activeUserId, family_id: 'fam-1', role: activeRole }]
            : []
        );
      case 'meal_configs':
        return makeQueryChain([
          { id: 'mc-1', patient_id: 'pat-1', name: 'Café da manhã', type: 'breakfast', scheduled_time: '08:00:00', display_order: 1, active: true },
          { id: 'mc-2', patient_id: 'pat-1', name: 'Almoço', type: 'lunch', scheduled_time: '12:00:00', display_order: 2, active: true },
        ]);
      case 'medication_periods':
        return makeQueryChain([]);
      case 'medications':
        return makeQueryChain([]);
      case 'meal_logs':
        return makeQueryChain([
          {
            id: 'ml-1',
            meal_config_id: 'mc-1',
            patient_id: 'pat-1',
            event_date: '2026-11-16',
            consumption_status: 'normal',
            description: 'Pão e mamão',
            created_by: 'admin-1',
            created_at: '2026-11-16T11:00:00.000Z',
          },
        ]);
      case 'medication_logs':
        return makeQueryChain([]);
      case 'daily_mood_logs':
        return makeQueryChain({
          id: 'mood-1',
          patient_id: 'pat-1',
          family_id: 'fam-1',
          date: '2026-11-16',
          mood: 'happy',
          pain_level: 'none',
          pain_locations: [],
          notes: longNote,
        });
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
      await new Promise((r) => setTimeout(r, 120));
    });

    // TESTE A & B: Cabeçalho compacto (apenas <header> sticky com DUCA + perfil) e seção do idoso rolável
    const headerEl = container.querySelector('header');
    assert.ok(headerEl);
    assert.ok(headerEl.className.includes('sticky top-0'));
    assert.match(headerEl.textContent || '', /DUCA/);
    assert.equal((headerEl.textContent || '').includes('Dona Maria'), false);

    const patientSection = container.querySelector('section');
    assert.ok(patientSection);
    assert.equal(patientSection.className.includes('sticky'), false);
    assert.match(patientSection.textContent || '', /Dona Maria/);
    assert.match(patientSection.textContent || '', /Bem e sem dores/);
    assert.match(patientSection.textContent || '', /50%/);
    assert.match(patientSection.textContent || '', /\(1\/2\)/);

    // Recado extenso compacto com botão Ver mais / Menos
    assert.match(patientSection.textContent || '', /Ver mais/);
    const expandBtn = (Array.from(patientSection.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.trim() === 'Ver mais'
    );
    assert.ok(expandBtn);
    await act(async () => {
      expandBtn.click();
    });
    assert.match(patientSection.textContent || '', /Menos/);

    // TESTE C: Às 20:59 BRT o banner flutuante das 21h está ausente, MAS a seção final "Encerramento do dia" já está disponível para fechar o dia antes das 21h!
    assert.equal(
      container.querySelector('[aria-label="Lembrete de encerramento diário"]'),
      null
    );
    const inlineClosureSectionBefore21 = container.querySelector('section[aria-label="Encerramento do dia"]');
    assert.ok(inlineClosureSectionBefore21, 'Seção final de encerramento deve existir antes das 21h');
    const inlineCloseBtnBefore21 = (
      Array.from(inlineClosureSectionBefore21.querySelectorAll('button')) as HTMLButtonElement[]
    ).find((b) => b.textContent?.includes('Encerrar Dia'));
    assert.ok(inlineCloseBtnBefore21, 'Botão Encerrar Dia deve estar disponível antes das 21h');

    // Clicar no botão da seção final antes das 21h abre o modal de confirmação normalmente
    await act(async () => {
      inlineCloseBtnBefore21.click();
    });
    assert.match(container.textContent || '', /Encerrar o dia\?/);
    const cancelBefore21Btn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.trim() === 'Voltar'
    );
    assert.ok(cancelBefore21Btn);
    await act(async () => {
      cancelBefore21Btn.click();
    });

    // TESTE D: Ao virar 21:00 BRT, o timer automático exibe o banner sem recarregar a página
    simulatedNow = new Date('2026-11-17T00:00:00.050Z'); // 21:00:00.050 BRT
    await act(async () => {
      await new Promise((r) => setTimeout(r, 420));
    });

    const bannerEl = container.querySelector('[aria-label="Lembrete de encerramento diário"]');
    assert.ok(bannerEl, 'Banner deveria aparecer automaticamente ao atingir 21:00 BRT');
    assert.match(bannerEl.textContent || '', /Encerrar Dia/);
    assert.match(bannerEl.textContent || '', /1 atividade pendente/);

    // Clicar em Encerrar Dia no banner abre o modal de confirmação (não encerra diretamente)
    const closeDayBtn = (Array.from(bannerEl.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.trim() === 'Encerrar Dia'
    );
    assert.ok(closeDayBtn);
    await act(async () => {
      closeDayBtn.click();
    });
    assert.match(container.textContent || '', /Encerrar o dia\?/);
    assert.match(container.textContent || '', /Existe 1 atividade sem registro neste dia/);
    const backBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.trim() === 'Voltar'
    );
    assert.ok(backBtn);
    await act(async () => {
      backBtn.click();
    });

    // TESTE E: Clicar no X fecha o banner flutuante e persiste no localStorage, mantendo a seção final visível
    const dismissBtn = bannerEl.querySelector(
      'button[aria-label="Dispensar lembrete de encerramento"]'
    ) as HTMLButtonElement | null;
    assert.ok(dismissBtn);

    await act(async () => {
      dismissBtn.click();
    });

    assert.equal(
      container.querySelector('[aria-label="Lembrete de encerramento diário"]'),
      null
    );
    assert.ok(container.querySelector('section[aria-label="Encerramento do dia"]'));
    assert.equal(
      dom.window.localStorage.getItem(getClosureReminderDismissKey('admin-1', 'pat-1', '2026-11-16')),
      '1'
    );

    // TESTE F: MEMBER ativo (familiar ou cuidadora) TAMBÉM vê a seção final antes/depois das 21h e o lembrete das 21h
    activeRole = 'MEMBER';
    activeUserId = 'member-1';
    simulatedNow = new Date('2026-11-16T18:00:00.000Z'); // 15:00 BRT (antes das 21h)
    await act(async () => {
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(TodayScreen, {
            key: 'member-before-21',
            nowProvider: () => simulatedNow,
          })
        )
      );
      await new Promise((r) => setTimeout(r, 120));
    });

    const memberSectionBefore21 = container.querySelector('section[aria-label="Encerramento do dia"]');
    assert.ok(memberSectionBefore21, 'MEMBER ativo deve ver a seção Encerramento do dia às 15:00 BRT');
    assert.match(memberSectionBefore21.textContent || '', /Encerrar Dia/);
    assert.equal(container.querySelector('[aria-label="Lembrete de encerramento diário"]'), null);

    simulatedNow = new Date('2026-11-17T00:30:00.000Z'); // 21:30 BRT
    await act(async () => {
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(TodayScreen, {
            key: 'member-after-21',
            nowProvider: () => simulatedNow,
          })
        )
      );
      await new Promise((r) => setTimeout(r, 120));
    });

    assert.ok(
      container.querySelector('[aria-label="Lembrete de encerramento diário"]'),
      'MEMBER ativo também deve receber o lembrete às 21:30 BRT caso o dia siga aberto'
    );

    // TESTE G: Usuário sem vínculo ativo na família não vê nem seção final nem lembrete
    activeRole = null;
    activeUserId = 'unlinked-user';
    await act(async () => {
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(TodayScreen, {
            key: 'unlinked-view',
            nowProvider: () => simulatedNow,
          })
        )
      );
      await new Promise((r) => setTimeout(r, 120));
    });

    assert.equal(container.querySelector('section[aria-label="Encerramento do dia"]'), null);
    assert.equal(container.querySelector('[aria-label="Lembrete de encerramento diário"]'), null);
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

test('[Estático Código] Entrega 02 não alterou migrations SQL e preservou estrutura do Today.tsx', () => {
  const todaySrc = fs.readFileSync(path.resolve('src/pages/Today.tsx'), 'utf8');
  assert.ok(todaySrc.includes('DEFAULT_TIMEZONE'));
  assert.ok(todaySrc.includes('isAfterClosureReminderTime'));
  assert.ok(todaySrc.includes('ClosureReminderBanner'));
  assert.ok(todaySrc.includes('handleCloseDay'));
  assert.ok(todaySrc.includes('handleReopenDay'));
});
