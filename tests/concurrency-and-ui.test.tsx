import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { mapWithConcurrency } from '../src/services/api.ts';
import { ErrorBoundary } from '../src/components/ErrorBoundary.tsx';
import { TimelineItem } from '../src/components/timeline/TimelineItem.tsx';
import { MealModal } from '../src/components/meals/MealModal.tsx';
import { MedicationModal } from '../src/components/medications/MedicationModal.tsx';
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

test('mapWithConcurrency executes all tasks preserving order and capping parallelism', async () => {
  let active = 0;
  let maxObserved = 0;
  const inputs = [10, 20, 30, 40, 50, 60, 70, 80];

  const results = await mapWithConcurrency(inputs, 3, async (val) => {
    active += 1;
    maxObserved = Math.max(maxObserved, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
    return val * 2;
  });

  assert.equal(maxObserved <= 3, true);
  assert.deepEqual(results, [20, 40, 60, 80, 100, 120, 140, 160]);
});

test('ErrorBoundary displays friendly recovery UI and recovers on retry', async () => {
  const dom = setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  let shouldThrow = true;
  function FlakyChild() {
    if (shouldThrow) {
      throw new Error('Simulated render crash');
    }
    return React.createElement('div', { 'data-testid': 'recovered' }, 'Conteúdo recuperado');
  }

  const origConsoleError = console.error;
  console.error = () => {};

  try {
    await act(async () => {
      root.render(React.createElement(ErrorBoundary, null, React.createElement(FlakyChild)));
    });

    assert.match(container.textContent || '', /Algo inesperado aconteceu/);
    assert.match(container.textContent || '', /Tentar novamente/);
    assert.match(container.textContent || '', /Detalhes técnicos/);

    shouldThrow = false;
    const retryBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Tentar novamente')
    );
    assert.ok(retryBtn);

    await act(async () => {
      retryBtn.click();
    });

    assert.match(container.textContent || '', /Conteúdo recuperado/);
  } finally {
    console.error = origConsoleError;
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('TimelineItem clearly distinguishes offline pending, failed sync, and synced entries', async () => {
  const dom = setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  const baseMeal: MealEventData = {
    id: 'mc-1',
    type: 'meal',
    time: '12:30:00',
    title: 'Almoço',
    status: 'confirmed',
    mealConfig: { id: 'mc-1', name: 'Almoço', scheduled_time: '12:30:00' },
    log: {
      id: 'log-1',
      consumption_status: 'normal',
      description: 'Arroz e feijão',
      drink_description: 'Suco de laranja',
      meal_time: '12:35:00',
      created_by: 'u1',
      created_at: '2026-11-15T15:35:00.000Z',
    },
    _syncStatus: 'pending',
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(TimelineItem, {
          event: baseMeal,
          profileId: 'u1',
          onClick: () => {},
        })
      );
    });

    assert.match(container.textContent || '', /Salvo no aparelho • Aguardando envio/);

    await act(async () => {
      root.render(
        React.createElement(TimelineItem, {
          event: { ...baseMeal, _syncStatus: 'failed', _syncError: 'Dia encerrado no servidor.' },
          profileId: 'u1',
          onClick: () => {},
        })
      );
    });

    assert.match(container.textContent || '', /Falha ao sincronizar: Dia encerrado no servidor\./);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('MealModal enforces closed-day read-only protection', async () => {
  const dom = setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  const mealEvent: MealEventData = {
    id: 'mc-2',
    type: 'meal',
    time: '08:00:00',
    title: 'Café da manhã',
    status: 'confirmed',
    mealConfig: { id: 'mc-2', name: 'Café da manhã', scheduled_time: '08:00:00' },
    log: {
      id: 'log-2',
      consumption_status: 'partial',
      description: 'Pão com manteiga',
      drink_description: 'Café com leite',
      meal_time: '08:15:00',
      created_by: 'u1',
      created_at: '2026-11-15T11:15:00.000Z',
      updated_by: 'u1',
    },
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(MealModal, {
          isOpen: true,
          onClose: () => {},
          event: mealEvent,
          patientId: 'pat-1',
          profileId: 'u1',
          eventDate: '2026-11-14',
          patientGender: 'F',
          isDayClosed: true,
          onSuccess: () => {},
        })
      );
    });

    const text = container.textContent || '';
    assert.match(text, /Dia encerrado/);
    assert.match(text, /Pão com manteiga/);
    assert.match(text, /Café com leite/);
    assert.equal(text.includes('EDITAR REGISTRO'), false);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('MedicationModal prompts inline partial confirmation instead of native window.confirm', async () => {
  const dom = setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  let nativeConfirmCalled = false;
  (dom.window as any).confirm = () => {
    nativeConfirmCalled = true;
    return false;
  };
  (globalThis as any).confirm = (dom.window as any).confirm;

  const medEvent: MedicationEventData = {
    id: 'per-1',
    type: 'medication_period',
    time: '08:30:00',
    title: 'Depois do café',
    status: 'pending',
    period: { id: 'per-1', name: 'Depois do café', scheduled_time: '08:30:00' },
    medications: [
      { id: 'med-1', name: 'Losartana', dosage: '50mg' },
      { id: 'med-2', name: 'AAS', dosage: '100mg' },
    ],
    logs: [],
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(MedicationModal, {
          isOpen: true,
          onClose: () => {},
          event: medEvent,
          patientId: 'pat-1',
          profileId: 'u1',
          eventDate: '2026-11-15',
          onSuccess: () => {},
        })
      );
    });

    const confirmBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Confirmar Medicamentos')
    );
    assert.ok(confirmBtn);

    await act(async () => {
      confirmBtn.click();
    });

    assert.equal(nativeConfirmCalled, false);
    assert.match(container.textContent || '', /Ainda existem medicamentos sem confirmação/);
    assert.match(container.textContent || '', /Confirmar mesmo assim/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
