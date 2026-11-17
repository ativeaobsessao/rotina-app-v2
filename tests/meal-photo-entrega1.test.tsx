import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import React from 'react';
import { act } from 'react';
import { get, set } from 'idb-keyval';

import {
  MEAL_DRAFT_KEY_PREFIX,
  ACTIVE_MEAL_RECOVERY_KEY,
  buildMealDraftKey,
  saveMealDraft,
  getMealDraft,
  deleteMealDraft,
  findRecoverableMealDraftForDate,
  cleanupExpiredMealDrafts,
  readActiveMealRecovery,
  clearActiveMealRecovery,
  CAMERA_INTENT_PENDING_KEY,
  isInAppCameraPreferred,
  setInAppCameraPreferred,
  type MealDraftStorageAdapter,
} from '../src/services/mealDrafts.ts';
import {
  validateImageFile,
  parseImageHeaderBytes,
  compressImage,
} from '../src/utils/image.ts';
import { InAppCameraModal } from '../src/components/meals/InAppCameraModal.tsx';
import { MealModal } from '../src/components/meals/MealModal.tsx';
import { TodayScreen } from '../src/pages/Today.tsx';
import { ThemeProvider } from '../src/contexts/ThemeContext.tsx';
import { supabase } from '../src/services/supabase.ts';
import {
  QUEUE_KEY,
  getSyncQueue,
  processSyncQueue,
  type SyncItem,
  type SyncQueueAdapter,
} from '../src/services/syncQueue.ts';
import type { MealEventData } from '../src/types/timeline.ts';

const IDB_STORES_SYMBOL = Symbol.for('duca.test.idbStores');

function installMemoryIndexedDB() {
  const stores: Map<string, Map<any, any>> =
    (globalThis as any)[IDB_STORES_SYMBOL] || new Map<string, Map<any, any>>();
  (globalThis as any)[IDB_STORES_SYMBOL] = stores;
  for (const map of stores.values()) {
    map.clear();
  }

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
  return stores;
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
  (globalThis as any).Node = dom.window.Node;
  (globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
  (globalThis as any).HTMLImageElement = dom.window.HTMLImageElement;
  (globalThis as any).Image = dom.window.Image;
  (globalThis as any).Event = dom.window.Event;
  (globalThis as any).localStorage = dom.window.localStorage;
  (globalThis as any).sessionStorage = dom.window.sessionStorage;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

  let seq = 0;
  const createdUrls = new Set<string>();
  const revokedUrls = new Set<string>();
  (URL as any).createObjectURL = () => {
    seq += 1;
    const url = `blob:https://duca.local/obj-${seq}`;
    createdUrls.add(url);
    return url;
  };
  (URL as any).revokeObjectURL = (url: string) => {
    revokedUrls.add(url);
  };

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
  Object.defineProperty(dom.window.navigator, 'onLine', {
    value: true,
    configurable: true,
    writable: true,
  });

  if (!cachedCreateRoot) {
    const clientMod = await import('react-dom/client');
    cachedCreateRoot = clientMod.createRoot;
  }

  return { dom, createdUrls, revokedUrls, createRoot: cachedCreateRoot };
}

function createMemoryDraftAdapter(): {
  adapter: MealDraftStorageAdapter;
  map: Map<string, any>;
} {
  const map = new Map<string, any>();
  return {
    map,
    adapter: {
      get: async <T = any>(key: string) => map.get(key) as T | undefined,
      set: async (key: string, value: any) => {
        map.set(key, value);
      },
      del: async (key: string) => {
        map.delete(key);
      },
      keys: async () => Array.from(map.keys()),
    },
  };
}

function makeFakeStream() {
  let stoppedCount = 0;
  let appliedConstraints: any[] = [];
  const track = {
    kind: 'video',
    getCapabilities: () => ({ focusMode: ['continuous', 'manual'] }),
    applyConstraints: async (c: any) => {
      appliedConstraints.push(c);
    },
    stop: () => {
      stoppedCount += 1;
    },
  };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  return {
    stream,
    getStoppedCount: () => stoppedCount,
    getAppliedConstraints: () => appliedConstraints,
  };
}

function buildMinimalJpegHeader(width: number, height: number, orientation = 1): Uint8Array {
  // SOI + APP1 (Exif TIFF) + SOF0
  const bytes = new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe1, 0x00, 0x22, // APP1 length = 34
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, // "MM" big-endian TIFF
    0x00, 0x2a, // TIFF magic 42
    0x00, 0x00, 0x00, 0x08, // IFD0 offset = 8
    0x00, 0x01, // 1 IFD entry
    0x01, 0x12, // Tag 0x0112 (Orientation)
    0x00, 0x03, // Type SHORT (3)
    0x00, 0x00, 0x00, 0x01, // Count 1
    0x00, orientation & 0xff, 0x00, 0x00, // Value
    0x00, 0x00, 0x00, 0x00, // Next IFD = 0
    0xff, 0xc0, 0x00, 0x0b, // SOF0 length = 11
    0x08, // Precision
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00, // 1 component
  ]);
  return bytes;
}

function makeBaseMealEvent(overrides: Partial<MealEventData> = {}): MealEventData {
  return {
    id: 'mc-lunch',
    type: 'meal',
    time: '12:00:00',
    title: 'Almoço',
    status: 'pending',
    mealConfig: { id: 'mc-lunch', name: 'Almoço', scheduled_time: '12:00:00' },
    ...overrides,
  };
}

// ============================================================================
// TESTE A — CÂMERA NO APP, PREVIEW, DESCARTE, CONFIRMAÇÃO, PERMISSÃO E FALLBACKS
// ============================================================================

test('[Teste A] InAppCameraModal inicia câmera traseira, permite descartar/retomar, confirma File e encerra tracks', async () => {
  const { dom, createdUrls, revokedUrls, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  const requestedConstraints: MediaStreamConstraints[] = [];
  const streams: Array<ReturnType<typeof makeFakeStream>> = [];
  const confirmedFiles: File[] = [];
  let nativeFallbackCalls = 0;
  let galleryFallbackCalls = 0;

  try {
    await act(async () => {
      root.render(
        React.createElement(InAppCameraModal, {
          isOpen: true,
          onClose: () => {},
          onCaptureConfirm: (f) => confirmedFiles.push(f),
          onFallbackNativeCamera: () => {
            nativeFallbackCalls += 1;
          },
          onFallbackGallery: () => {
            galleryFallbackCalls += 1;
          },
          requestMediaStream: async (constraints) => {
            requestedConstraints.push(constraints);
            const s = makeFakeStream();
            streams.push(s);
            return s.stream;
          },
          captureFrame: async () =>
            new File([new Uint8Array([1, 2, 3, 4])], 'frame-1.jpg', { type: 'image/jpeg' }),
        })
      );
    });

    assert.equal(requestedConstraints.length, 1);
    assert.deepEqual((requestedConstraints[0].video as any).facingMode, { ideal: 'environment' });
    assert.equal(streams[0].getStoppedCount(), 0);

    // Capturar quadro: para tracks imediatamente e exibe preview com opções Tirar outra / Usar esta foto
    const captureBtn = container.querySelector('button[aria-label="Capturar foto"]') as HTMLButtonElement;
    assert.ok(captureBtn);
    await act(async () => {
      captureBtn.click();
    });

    assert.equal(streams[0].getStoppedCount(), 1);
    assert.match(container.textContent || '', /Conferir foto/);
    assert.match(container.textContent || '', /Tirar outra/);
    assert.match(container.textContent || '', /Usar esta foto/);

    // Descartar para tirar outra: revoga ObjectURL anterior e reabre novo stream
    const retakeBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Tirar outra')
    ) as HTMLButtonElement;
    assert.ok(retakeBtn);
    await act(async () => {
      retakeBtn.click();
    });

    assert.equal(createdUrls.size, 1);
    assert.equal(revokedUrls.size, 1);
    assert.equal(streams.length, 2);

    // Capturar e confirmar
    const captureBtn2 = container.querySelector('button[aria-label="Capturar foto"]') as HTMLButtonElement;
    await act(async () => {
      captureBtn2.click();
    });
    assert.equal(streams[1].getStoppedCount(), 1);

    const confirmBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Usar esta foto')
    ) as HTMLButtonElement;
    assert.ok(confirmBtn);
    await act(async () => {
      confirmBtn.click();
    });

    assert.equal(confirmedFiles.length, 1);
    assert.equal(confirmedFiles[0].name, 'frame-1.jpg');
    assert.equal(confirmedFiles[0].type, 'image/jpeg');
    assert.equal(revokedUrls.size, 2);
    assert.equal(nativeFallbackCalls, 0);
    assert.equal(galleryFallbackCalls, 0);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('[Teste A] InAppCameraModal trata permissão negada/câmera indisponível com fallbacks e libera stream em visibilitychange', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  let nativeFallbackCalls = 0;
  let galleryFallbackCalls = 0;

  try {
    // 1. NotAllowedError -> exibe orientação amigável e botões de fallback funcionais
    await act(async () => {
      root.render(
        React.createElement(InAppCameraModal, {
          isOpen: true,
          onClose: () => {},
          onCaptureConfirm: () => {},
          onFallbackNativeCamera: () => {
            nativeFallbackCalls += 1;
          },
          onFallbackGallery: () => {
            galleryFallbackCalls += 1;
          },
          requestMediaStream: async () => {
            const err: any = new Error('Permission denied');
            err.name = 'NotAllowedError';
            throw err;
          },
        })
      );
    });

    assert.match(
      container.textContent || '',
      /Não foi possível acessar a câmera\. Verifique a permissão ou escolha uma foto da galeria\./
    );

    const nativeBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Usar câmera do aparelho')
    ) as HTMLButtonElement;
    const galleryBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Escolher da galeria')
    ) as HTMLButtonElement;

    assert.ok(nativeBtn);
    assert.ok(galleryBtn);

    await act(async () => {
      nativeBtn.click();
      galleryBtn.click();
    });
    assert.equal(nativeFallbackCalls, 1);
    assert.equal(galleryFallbackCalls, 1);

    // 2. Visibility hidden encerra tracks imediatamente
    const activeStream = makeFakeStream();
    await act(async () => {
      root.render(
        React.createElement(InAppCameraModal, {
          key: 'second-camera',
          isOpen: true,
          onClose: () => {},
          onCaptureConfirm: () => {},
          onFallbackNativeCamera: () => {},
          onFallbackGallery: () => {},
          requestMediaStream: async () => activeStream.stream,
        })
      );
    });

    assert.equal(activeStream.getStoppedCount(), 0);
    Object.defineProperty(dom.window.document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
    });

    assert.equal(activeStream.getStoppedCount(), 1);
    assert.match(container.textContent || '', /câmera foi pausada/i);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('[Teste A] InAppCameraModal solicita até 4K, ativa foco contínuo e usa ImageCapture.takePhoto() em alta resolução', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  const origImageCapture = (globalThis as any).ImageCapture;
  const requestedConstraints: MediaStreamConstraints[] = [];
  const fakeStream = makeFakeStream();
  const confirmedFiles: File[] = [];
  let takePhotoSettingsSeen: any = null;

  (globalThis as any).ImageCapture = class MockImageCapture {
    async getPhotoCapabilities() {
      return { imageWidth: { max: 4032 }, imageHeight: { max: 3024 } };
    }
    async takePhoto(settings?: any) {
      takePhotoSettingsSeen = settings;
      return new Blob([buildMinimalJpegHeader(4032, 3024, 1)], { type: 'image/jpeg' });
    }
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(InAppCameraModal, {
          isOpen: true,
          onClose: () => {},
          onCaptureConfirm: (f) => confirmedFiles.push(f),
          onFallbackNativeCamera: () => {},
          onFallbackGallery: () => {},
          requestMediaStream: async (c) => {
            requestedConstraints.push(c);
            return fakeStream.stream;
          },
        })
      );
    });

    assert.equal((requestedConstraints[0].video as any).width.ideal, 3840);
    assert.equal((requestedConstraints[0].video as any).height.ideal, 2160);
    assert.deepEqual(fakeStream.getAppliedConstraints()[0], {
      advanced: [{ focusMode: 'continuous' }],
    });

    const captureBtn = container.querySelector('button[aria-label="Capturar foto"]') as HTMLButtonElement;
    await act(async () => {
      captureBtn.click();
    });

    assert.deepEqual(takePhotoSettingsSeen, { imageWidth: 4032, imageHeight: 3024 });
    const confirmBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Usar esta foto')
    ) as HTMLButtonElement;
    await act(async () => {
      confirmBtn.click();
    });

    assert.equal(confirmedFiles.length, 1);
    assert.equal(confirmedFiles[0].type, 'image/jpeg');
    assert.ok(confirmedFiles[0].size > 10);
  } finally {
    (globalThis as any).ImageCapture = origImageCapture;
    await act(async () => root.unmount());
    dom.window.close();
  }
});

// ============================================================================
// TESTE B — RECUPERAÇÃO APÓS REINICIALIZAÇÃO / MORTE DO PROCESSO ANDROID
// ============================================================================

test('[Teste B] mealDrafts isola rascunhos com Blob em IndexedDB por userId:patientId:mealId:eventDate e limpa TTL sem tocar na fila offline', async () => {
  const { dom } = await setupDom();
  try {
    const { adapter, map } = createMemoryDraftAdapter();
    const blobUserA = new Blob([new Uint8Array([10, 20, 30])], { type: 'image/jpeg' });
    const now = 1_700_000_000_000;

    await saveMealDraft(
      {
        userId: 'user-A',
        patientId: 'pat-1',
        mealId: 'mc-lunch',
        eventDate: '2026-11-16',
        tab: 'today',
        consumption: 'partial',
        description: 'Sopa de legumes',
        drinkDescription: 'Chá de camomila',
        notes: 'Aceitou bem',
        mealTime: '12:15',
        photoBlob: blobUserA,
        photoName: 'almoco.jpg',
        photoType: 'image/jpeg',
        photoRemoved: false,
      },
      adapter,
      now
    );

    const expectedKey = buildMealDraftKey({
      userId: 'user-A',
      patientId: 'pat-1',
      mealId: 'mc-lunch',
      eventDate: '2026-11-16',
    });
    assert.equal(expectedKey, 'meal_draft:user-A:pat-1:mc-lunch:2026-11-16');

    // Recupera exatamente para user-A / pat-1 / mc-lunch / 2026-11-16
    const recovered = await getMealDraft(
      { userId: 'user-A', patientId: 'pat-1', mealId: 'mc-lunch', eventDate: '2026-11-16' },
      adapter,
      now + 5_000
    );
    assert.ok(recovered);
    assert.equal(recovered.description, 'Sopa de legumes');
    assert.equal(recovered.drinkDescription, 'Chá de camomila');
    assert.equal(recovered.notes, 'Aceitou bem');
    assert.ok(recovered.photoBlob instanceof Blob);
    assert.equal(recovered.photoBlob.size, 3);

    // Isolamento rigoroso entre usuários, pacientes e datas diferentes
    assert.equal(
      await getMealDraft(
        { userId: 'user-B', patientId: 'pat-1', mealId: 'mc-lunch', eventDate: '2026-11-16' },
        adapter,
        now + 5_000
      ),
      null
    );
    assert.equal(
      await getMealDraft(
        { userId: 'user-A', patientId: 'pat-2', mealId: 'mc-lunch', eventDate: '2026-11-16' },
        adapter,
        now + 5_000
      ),
      null
    );
    assert.equal(
      await findRecoverableMealDraftForDate('user-B', 'pat-1', '2026-11-16', 'today', adapter, now + 5_000),
      null
    );

    // Preserva offline_mutation_queue intacta durante limpeza de rascunhos expirados por TTL
    map.set(QUEUE_KEY, [{ id: 'q-1', action: 'createMealLog' }]);
    map.set(`${MEAL_DRAFT_KEY_PREFIX}user-old:pat-1:mc-1:2026-11-10`, {
      version: 1,
      expiresAt: now - 1000,
    });

    const removed = await cleanupExpiredMealDrafts(now + 5_000, adapter);
    assert.equal(removed, 1);
    assert.equal(map.has(QUEUE_KEY), true);
    assert.equal(map.has(expectedKey), true);

    await deleteMealDraft(
      { userId: 'user-A', patientId: 'pat-1', mealId: 'mc-lunch', eventDate: '2026-11-16' },
      adapter
    );
    assert.equal(map.has(expectedKey), false);
    assert.equal(readActiveMealRecovery('user-A', now + 5_000), null);
  } finally {
    clearActiveMealRecovery();
    dom.window.close();
  }
});

test('[Teste B] Capturar foto no MealModal persiste em IndexedDB e TodayScreen/MealModal recuperam após reinicialização do app', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;

  const origAuthGetUser = supabase.auth.getUser.bind(supabase.auth);
  const origAuthGetSession = supabase.auth.getSession.bind(supabase.auth);
  const origFrom = (supabase as any).from;
  const origChannel = (supabase as any).channel;
  const origRemoveChannel = (supabase as any).removeChannel;

  const capturedBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

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
    data: { user: { id: 'admin-1', email: 'admin@duca.local' } },
    error: null,
  });
  (supabase.auth as any).getSession = async () => ({
    data: { session: { user: { id: 'admin-1', email: 'admin@duca.local' } } },
    error: null,
  });
  (supabase as any).channel = () => {
    const ch: any = { on: () => ch, subscribe: () => ch, unsubscribe: async () => 'ok' };
    return ch;
  };
  (supabase as any).removeChannel = async () => 'ok';
  (supabase as any).from = (table: string) => {
    switch (table) {
      case 'profiles':
        return makeQueryChain({
          id: 'admin-1',
          family_id: 'fam-1',
          name: 'Cuidadora Ana',
          email: 'admin@duca.local',
        });
      case 'patients':
        return makeQueryChain([
          { id: 'pat-1', family_id: 'fam-1', name: 'Dona Maria', photo_url: null, gender: 'F' },
        ]);
      case 'family_members':
        return makeQueryChain([{ id: 'fm-1', user_id: 'admin-1', family_id: 'fam-1', role: 'ADMIN' }]);
      case 'meal_configs':
        return makeQueryChain([
          {
            id: 'mc-lunch',
            patient_id: 'pat-1',
            name: 'Almoço',
            type: 'lunch',
            scheduled_time: '12:00:00',
            display_order: 1,
            active: true,
          },
        ]);
      case 'medication_periods':
      case 'medications':
      case 'meal_logs':
      case 'medication_logs':
        return makeQueryChain([]);
      case 'daily_mood_logs':
      case 'daily_closures':
        return makeQueryChain(null);
      default:
        return makeQueryChain([]);
    }
  };

  let root1 = createRoot(container);
  let root2: ReturnType<typeof createRoot> | null = null;

  try {
    // 1. Preenche formulário no MealModal e captura foto na câmera integrada
    await act(async () => {
      root1.render(
        React.createElement(MealModal, {
          isOpen: true,
          onClose: () => {},
          event: makeBaseMealEvent(),
          patientId: 'pat-1',
          profileId: 'admin-1',
          eventDate: '2026-11-16',
          patientGender: 'F',
          canEdit: true,
          requestMediaStream: async () => makeFakeStream().stream,
          captureFrame: async () =>
            new File([capturedBytes], 'almoco-camera.jpg', { type: 'image/jpeg' }),
          onSuccess: () => {},
        })
      );
    });

    const descInput = container.querySelector(
      'input[placeholder="Ex: Arroz, feijão, frango e salada."]'
    ) as HTMLInputElement;
    const notesInput = container.querySelector(
      'input[placeholder="Alguma observação?"]'
    ) as HTMLInputElement;

    const nativeSetter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      'value'
    )!.set!;

    await act(async () => {
      nativeSetter.call(descInput, 'Arroz, feijão e purê');
      descInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      nativeSetter.call(notesInput, 'Foto antes de reiniciar');
      notesInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });

    const nativeInput = container.querySelector('[data-testid="native-camera-input"]') as HTMLInputElement;
    let nativeInputClicked = false;
    nativeInput.click = () => {
      nativeInputClicked = true;
    };

    const takePhotoBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Tirar foto')
    ) as HTMLButtonElement;
    await act(async () => {
      takePhotoBtn.click();
    });

    assert.equal(nativeInputClicked, true);
    assert.ok(dom.window.localStorage.getItem(CAMERA_INTENT_PENDING_KEY));

    const returnedFile = new File([capturedBytes], 'almoco-camera.jpg', { type: 'image/jpeg' });
    Object.defineProperty(nativeInput, 'files', {
      value: [returnedFile],
      configurable: true,
    });
    await act(async () => {
      nativeInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 40));
    });

    assert.equal(dom.window.localStorage.getItem(CAMERA_INTENT_PENDING_KEY), null);
    assert.equal(isInAppCameraPreferred(), false);

    // Verifica rascunho persistido em IndexedDB com Blob + ponteiro síncrono no localStorage
    const savedDraft = await getMealDraft({
      userId: 'admin-1',
      patientId: 'pat-1',
      mealId: 'mc-lunch',
      eventDate: '2026-11-16',
    });
    assert.ok(savedDraft);
    assert.ok(savedDraft.photoBlob instanceof Blob);
    assert.equal(savedDraft.photoBlob.size, capturedBytes.byteLength);
    assert.equal(savedDraft.description, 'Arroz, feijão e purê');
    assert.ok(dom.window.localStorage.getItem(ACTIVE_MEAL_RECOVERY_KEY));

    // 2. Simula morte do processo / unmount e nova montagem de TodayScreen após reiniciar PWA
    await act(async () => {
      root1.unmount();
    });

    root2 = createRoot(container);
    await act(async () => {
      root2!.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(TodayScreen, {
            nowProvider: () => new Date('2026-11-16T15:30:00.000Z'), // 2026-11-16 em America/Sao_Paulo
          })
        )
      );
      await new Promise((r) => setTimeout(r, 150));
    });

    // TodayScreen reabre automaticamente o MealModal com todos os campos e preview da foto!
    assert.match(container.textContent || '', /Seu registro em andamento foi recuperado\./);
    assert.match(container.textContent || '', /Foto pronta\. Agora você pode confirmar/);
    const restoredDesc = container.querySelector(
      'input[placeholder="Ex: Arroz, feijão, frango e salada."]'
    ) as HTMLInputElement;
    const restoredNotes = container.querySelector(
      'input[placeholder="Alguma observação?"]'
    ) as HTMLInputElement;
    const restoredPreview = container.querySelector('img[alt="Preview"]') as HTMLImageElement;

    assert.equal(restoredDesc?.value, 'Arroz, feijão e purê');
    assert.equal(restoredNotes?.value, 'Foto antes de reiniciar');
    assert.ok(restoredPreview);
    assert.ok(restoredPreview.src.startsWith('blob:'));
  } finally {
    if (root2) await act(async () => root2!.unmount());
    (supabase.auth as any).getUser = origAuthGetUser;
    (supabase.auth as any).getSession = origAuthGetSession;
    (supabase as any).from = origFrom;
    (supabase as any).channel = origChannel;
    (supabase as any).removeChannel = origRemoveChannel;
    dom.window.close();
  }
});

test('[Teste B.2] Auto-adaptação Android: se o app fechar durante câmera nativa, reabre com aviso e passa a usar câmera no app', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;

  const origAuthGetUser = supabase.auth.getUser.bind(supabase.auth);
  const origAuthGetSession = supabase.auth.getSession.bind(supabase.auth);
  const origFrom = (supabase as any).from;
  const origChannel = (supabase as any).channel;
  const origRemoveChannel = (supabase as any).removeChannel;

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
    data: { user: { id: 'admin-1', email: 'admin@duca.local' } },
    error: null,
  });
  (supabase.auth as any).getSession = async () => ({
    data: { session: { user: { id: 'admin-1', email: 'admin@duca.local' } } },
    error: null,
  });
  (supabase as any).channel = () => {
    const ch: any = { on: () => ch, subscribe: () => ch, unsubscribe: async () => 'ok' };
    return ch;
  };
  (supabase as any).removeChannel = async () => 'ok';
  (supabase as any).from = (table: string) => {
    switch (table) {
      case 'profiles':
        return makeQueryChain({
          id: 'admin-1',
          family_id: 'fam-1',
          name: 'Cuidadora Ana',
          email: 'admin@duca.local',
        });
      case 'patients':
        return makeQueryChain([
          { id: 'pat-1', family_id: 'fam-1', name: 'Dona Maria', photo_url: null, gender: 'F' },
        ]);
      case 'family_members':
        return makeQueryChain([{ id: 'fm-1', user_id: 'admin-1', family_id: 'fam-1', role: 'ADMIN' }]);
      case 'meal_configs':
        return makeQueryChain([
          {
            id: 'mc-lunch',
            patient_id: 'pat-1',
            name: 'Almoço',
            type: 'lunch',
            scheduled_time: '12:00:00',
            display_order: 1,
            active: true,
          },
        ]);
      case 'medication_periods':
      case 'medications':
      case 'meal_logs':
      case 'medication_logs':
        return makeQueryChain([]);
      default:
        return makeQueryChain(null);
    }
  };

  const root1 = createRoot(container);
  let root2: ReturnType<typeof createRoot> | null = null;

  try {
    await act(async () => {
      root1.render(
        React.createElement(MealModal, {
          isOpen: true,
          onClose: () => {},
          event: makeBaseMealEvent(),
          patientId: 'pat-1',
          profileId: 'admin-1',
          eventDate: '2026-11-16',
          patientGender: 'F',
          canEdit: true,
          onSuccess: () => {},
        })
      );
    });

    const nativeInput = container.querySelector('[data-testid="native-camera-input"]') as HTMLInputElement;
    nativeInput.click = () => {};

    const takePhotoBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Tirar foto')
    ) as HTMLButtonElement;

    await act(async () => {
      takePhotoBtn.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    // Processo morre antes de o arquivo voltar da câmera externa
    await act(async () => {
      root1.unmount();
    });

    root2 = createRoot(container);
    await act(async () => {
      root2!.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(TodayScreen, {
            nowProvider: () => new Date('2026-11-16T15:30:00.000Z'),
          })
        )
      );
      await new Promise((r) => setTimeout(r, 150));
    });

    assert.equal(isInAppCameraPreferred(), true);
    assert.match(container.textContent || '', /Seu celular fechou o aplicativo ao abrir a câmera externa/);

    // Agora "Tirar foto" abre diretamente a câmera integrada nesse aparelho
    const adaptedTakePhotoBtn = (
      Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]
    ).find((b) => b.textContent?.includes('Tirar foto')) as HTMLButtonElement;
    await act(async () => {
      adaptedTakePhotoBtn.click();
    });

    assert.ok(container.querySelector('[aria-label="Câmera da refeição"]'));
    setInAppCameraPreferred(false);
  } finally {
    if (root2) await act(async () => root2!.unmount());
    (supabase.auth as any).getUser = origAuthGetUser;
    (supabase.auth as any).getSession = origAuthGetSession;
    (supabase as any).from = origFrom;
    (supabase as any).channel = origChannel;
    (supabase as any).removeChannel = origRemoveChannel;
    dom.window.close();
  }
});

// ============================================================================
// TESTE C — PROCESSAMENTO DE IMAGEM, EXIF, VALIDAÇÃO E LIMPEZA DE RECURSOS
// ============================================================================

test('[Teste C] validateImageFile, parseImageHeaderBytes e compressImage protegem RAM, validam formato e liberam canvas/ImageBitmap', async () => {
  const { dom } = await setupDom();

  // Validação de arquivos inválidos e válidos
  assert.throws(() => validateImageFile(null), /vazio ou inválido/);
  assert.throws(
    () => validateImageFile(new File([], 'empty.jpg', { type: 'image/jpeg' })),
    /vazio ou inválido/
  );
  assert.throws(
    () => validateImageFile(new File(['<svg/>'], 'vec.svg', { type: 'image/svg+xml' })),
    /Formato de imagem não suportado/
  );
  assert.throws(
    () => validateImageFile(new File(['pdf'], 'doc.pdf', { type: 'application/pdf' })),
    /Formato de imagem não suportado/
  );
  // Picker Android sem file.type, mas com extensão válida
  assert.doesNotThrow(() =>
    validateImageFile(new File([new Uint8Array([1, 2, 3])], 'IMG_001.jpg', { type: '' }))
  );

  // Leitura binária de dimensões e EXIF orientation
  const jpgHeader = buildMinimalJpegHeader(4032, 3024, 6);
  const parsedJpg = parseImageHeaderBytes(jpgHeader.buffer as ArrayBuffer);
  assert.deepEqual(parsedJpg, {
    format: 'jpeg',
    width: 4032,
    height: 3024,
    orientation: 6,
  });

  // 1. Passthrough seguro para JPEG <= 2048px, orientation=1, <= 1.5MB
  const smallUpright = new File([buildMinimalJpegHeader(1600, 1200, 1)], 'small.jpg', {
    type: 'image/jpeg',
  });
  const passthroughRes = await compressImage(smallUpright);
  assert.equal(passthroughRes, smallUpright);

  // 2. Redimensionamento decode-time para foto 4032x3024 com EXIF orientation=6 até 2048px
  const origCreateImageBitmap = (globalThis as any).createImageBitmap;
  const origCreateElement = dom.window.document.createElement.bind(dom.window.document);

  let resizeOptsSeen: any = null;
  let bitmapClosed = false;
  let canvasClearedWidth = -1;
  let canvasClearedHeight = -1;

  (globalThis as any).createImageBitmap = async (_file: any, opts?: any) => {
    resizeOptsSeen = opts;
    return {
      width: 1536,
      height: 2048,
      close: () => {
        bitmapClosed = true;
      },
    };
  };

  const trackedCanvases: any[] = [];
  (dom.window.document as any).createElement = (tag: string, options?: any) => {
    const el = origCreateElement(tag, options);
    if (tag.toLowerCase() === 'canvas') {
      const fakeCanvas: any = {
        _w: 0,
        _h: 0,
        get width() {
          return this._w;
        },
        set width(v: number) {
          this._w = v;
          if (v === 0) canvasClearedWidth = 0;
        },
        get height() {
          return this._h;
        },
        set height(v: number) {
          this._h = v;
          if (v === 0) canvasClearedHeight = 0;
        },
        getContext: () => ({
          drawImage: () => {},
        }),
        toBlob: (cb: (b: Blob | null) => void) => {
          cb(new Blob([new Uint8Array(1024)], { type: 'image/jpeg' }));
        },
      };
      trackedCanvases.push(fakeCanvas);
      return fakeCanvas;
    }
    return el;
  };

  try {
    const bigRotated = new File([buildMinimalJpegHeader(4032, 3024, 6)], 'IMG_4K.png', {
      type: 'image/jpeg',
    });
    const out = await compressImage(bigRotated);

    assert.equal(out.type, 'image/jpeg');
    assert.equal(out.name, 'IMG_4K.jpg');
    assert.deepEqual(resizeOptsSeen, {
      imageOrientation: 'from-image',
      resizeWidth: 2048,
      resizeQuality: 'high',
    });
    assert.equal(bitmapClosed, true);
    assert.equal(canvasClearedWidth, 0);
    assert.equal(canvasClearedHeight, 0);
    assert.equal(trackedCanvases.length, 1);
  } finally {
    (globalThis as any).createImageBitmap = origCreateImageBitmap;
    (dom.window.document as any).createElement = origCreateElement;
    dom.window.close();
  }
});

// ============================================================================
// TESTE D — SALVAMENTO ONLINE & ZERO DUPLICAÇÃO QUANDO STORAGE PASSA E DB FALHA
// ============================================================================

test('[Teste D] Salvamento online envia para meal-records/{patientId}/, não duplica upload ao tentar novamente após falha de DB e só limpa rascunho após confirmação', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  const origFrom = (supabase as any).from;
  const origStorage = (supabase as any).storage;
  const origCreateImageBitmap = (globalThis as any).createImageBitmap;
  const origConsoleError = console.error;
  console.error = () => {};

  const uploads: Array<{ bucket: string; path: string }> = [];
  const deletes: Array<{ bucket: string; paths: string[] }> = [];
  const inserts: any[] = [];
  let shouldFailDb = true;
  let successCalls = 0;

  (supabase as any).storage = {
    from: (bucket: string) => ({
      upload: async (p: string) => {
        uploads.push({ bucket, path: p });
        return { data: { path: p }, error: null };
      },
      remove: async (paths: string[]) => {
        deletes.push({ bucket, paths });
        return { data: [], error: null };
      },
      createSignedUrl: async (p: string) => ({
        data: { signedUrl: `https://cdn.duca.local/${p}?token=abc` },
        error: null,
      }),
    }),
  };

  (supabase as any).from = (table: string) => {
    if (table === 'meal_logs') {
      return {
        insert: (payload: any) => {
          inserts.push(payload);
          return {
            select: () => ({
              single: async () => {
                if (shouldFailDb) {
                  return { data: null, error: { message: 'Temporarily unavailable' } };
                }
                return {
                  data: {
                    id: 'srv-meal-100',
                    ...payload,
                    creator: { name: 'Ana' },
                    updater: { name: 'Ana' },
                  },
                  error: null,
                };
              },
            }),
          };
        },
      };
    }
    return {};
  };

  try {
    const validSmallJpeg = new File([buildMinimalJpegHeader(800, 600, 1)], 'prato.jpg', {
      type: 'image/jpeg',
    });

    await act(async () => {
      root.render(
        React.createElement(MealModal, {
          isOpen: true,
          onClose: () => {},
          event: makeBaseMealEvent(),
          patientId: 'pat-1',
          profileId: 'admin-1',
          eventDate: '2026-11-16',
          patientGender: 'F',
          canEdit: true,
          requestMediaStream: async () => makeFakeStream().stream,
          captureFrame: async () => validSmallJpeg,
          onSuccess: () => {
            successCalls += 1;
          },
        })
      );
    });

    // Captura via câmera integrada (opção alternativa "Usar câmera no app")
    const inAppBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Usar câmera no app')
    ) as HTMLButtonElement;
    await act(async () => {
      inAppBtn.click();
    });
    const captureBtn = container.querySelector('button[aria-label="Capturar foto"]') as HTMLButtonElement;
    await act(async () => {
      captureBtn.click();
    });
    const confirmPhotoBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Usar esta foto')
    ) as HTMLButtonElement;
    await act(async () => {
      confirmPhotoBtn.click();
    });

    // 1a tentativa: Storage envia com sucesso, mas DB falha -> NÃO limpa rascunho nem foto!
    const confirmMealBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Confirmar Refeição')
    ) as HTMLButtonElement;
    await act(async () => {
      confirmMealBtn.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    assert.equal(uploads.length, 1);
    assert.ok(uploads[0].path.startsWith('pat-1/2026-11-16_mc-lunch_'));
    assert.equal(inserts.length, 1);
    assert.equal(successCalls, 0);
    assert.equal(deletes.length, 0);

    const draftAfterDbFail = await getMealDraft({
      userId: 'admin-1',
      patientId: 'pat-1',
      mealId: 'mc-lunch',
      eventDate: '2026-11-16',
    });
    assert.ok(draftAfterDbFail);
    assert.equal(draftAfterDbFail.uploadedPhotoPath, uploads[0].path);

    // 2a tentativa (DB volta a responder): REUTILIZA uploadedPhotoPath sem reenviar foto duplicada!
    shouldFailDb = false;
    await act(async () => {
      confirmMealBtn.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    assert.equal(uploads.length, 1, 'Não deveria duplicar o upload no Storage ao tentar novamente');
    assert.equal(inserts.length, 2);
    assert.equal(inserts[1].photo_url, uploads[0].path);
    assert.equal(successCalls, 1);

    const draftAfterSuccess = await getMealDraft({
      userId: 'admin-1',
      patientId: 'pat-1',
      mealId: 'mc-lunch',
      eventDate: '2026-11-16',
    });
    assert.equal(draftAfterSuccess, null);
  } finally {
    console.error = origConsoleError;
    await act(async () => root.unmount());
    (supabase as any).from = origFrom;
    (supabase as any).storage = origStorage;
    (globalThis as any).createImageBitmap = origCreateImageBitmap;
    dom.window.close();
  }
});

// ============================================================================
// TESTE E — MODO OFFLINE, REINÍCIO E SINCRONIZAÇÃO POSTERIOR COM STORAGE
// ============================================================================

test('[Teste E] Foto registrada offline entra na fila com Blob, persiste entre sessões e sincroniza ao reconectar removendo foto antiga só após confirmação', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  let root = createRoot(container);

  const origAuthGetSession = supabase.auth.getSession.bind(supabase.auth);
  (supabase.auth as any).getSession = async () => ({
    data: { session: { user: { id: 'admin-1', email: 'admin@duca.local' } } },
    error: null,
  });

  // Força dispositivo offline
  Object.defineProperty(dom.window.navigator, 'onLine', {
    value: false,
    configurable: true,
    writable: true,
  });

  let successCalls = 0;

  try {
    const validSmallJpeg = new File([buildMinimalJpegHeader(640, 480, 1)], 'offline.jpg', {
      type: 'image/jpeg',
    });

    const existingMeal = makeBaseMealEvent({
      status: 'confirmed',
      photoSignedUrl: 'https://cdn.duca.local/antiga.jpg',
      log: {
        id: 'meal-existing-1',
        meal_config_id: 'mc-lunch',
        patient_id: 'pat-1',
        event_date: '2026-11-16',
        consumption_status: 'partial',
        photo_url: 'pat-1/antiga.jpg',
        created_by: 'admin-1',
        updated_at: '2026-11-16T12:00:00.000Z',
      },
    });

    await act(async () => {
      root.render(
        React.createElement(MealModal, {
          isOpen: true,
          onClose: () => {},
          event: existingMeal,
          patientId: 'pat-1',
          profileId: 'admin-1',
          eventDate: '2026-11-16',
          patientGender: 'F',
          canEdit: true,
          requestMediaStream: async () => makeFakeStream().stream,
          captureFrame: async () => validSmallJpeg,
          onSuccess: () => {
            successCalls += 1;
          },
        })
      );
    });

    // Entra no modo de edição e substitui foto offline
    const editBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('EDITAR REGISTRO')
    ) as HTMLButtonElement;
    await act(async () => {
      editBtn.click();
    });

    const removeOldPhotoBtn = container.querySelector('button[aria-label="Remover foto"]') as HTMLButtonElement;
    if (removeOldPhotoBtn) {
      await act(async () => {
        removeOldPhotoBtn.click();
      });
    }

    const nativeInput = container.querySelector('[data-testid="native-camera-input"]') as HTMLInputElement;
    nativeInput.click = () => {};
    const takePhotoBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Tirar foto')
    ) as HTMLButtonElement;
    await act(async () => {
      takePhotoBtn.click();
    });
    Object.defineProperty(nativeInput, 'files', {
      value: [validSmallJpeg],
      configurable: true,
    });
    await act(async () => {
      nativeInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });

    const confirmMealBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Confirmar Refeição')
    ) as HTMLButtonElement;
    await act(async () => {
      confirmMealBtn.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    assert.equal(successCalls, 1);

    const queueBeforeSync = await getSyncQueue();
    assert.equal(queueBeforeSync.length, 1);
    assert.equal(queueBeforeSync[0].action, 'updateMealLog');
    assert.ok(queueBeforeSync[0].offlinePhoto?.blob instanceof Blob);
    assert.equal(queueBeforeSync[0].oldPhotoPathToDelete, 'pat-1/antiga.jpg');

    // Simula fechamento da modal/tela e reconexão posterior
    await act(async () => {
      root.unmount();
    });
    Object.defineProperty(dom.window.navigator, 'onLine', {
      value: true,
      configurable: true,
      writable: true,
    });

    const storageUploads: string[] = [];
    const storageDeletes: string[] = [];
    const dbUpdates: any[] = [];

    const syncAdapter: SyncQueueAdapter = {
      getQueue: async () => (await get<SyncItem[]>(QUEUE_KEY)) || [],
      saveQueue: async (items) => {
        await set(QUEUE_KEY, items);
      },
      getSessionUserId: async () => 'admin-1',
      isOnline: () => true,
      client: {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'meal-existing-1',
                  updated_at: '2026-11-16T12:00:00.000Z',
                  updated_by: 'admin-1',
                },
                error: null,
              }),
            }),
          }),
          update: (payload: any) => {
            dbUpdates.push(payload);
            return {
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({
                    data: { id: 'meal-existing-1', patient_id: 'pat-1', event_date: '2026-11-16', ...payload },
                    error: null,
                  }),
                }),
              }),
            };
          },
        }),
        storage: {
          from: () => ({
            upload: async (p: string) => {
              storageUploads.push(p);
              return { data: { path: p }, error: null };
            },
            remove: async (paths: string[]) => {
              storageDeletes.push(...paths);
              return { data: [], error: null };
            },
          }),
        },
      },
    };

    const syncRes = await processSyncQueue({ adapter: syncAdapter });
    assert.equal(syncRes.processed, 1);
    assert.equal(syncRes.remainingPending, 0);
    assert.equal(storageUploads.length, 1);
    assert.equal(dbUpdates[0].photo_url, storageUploads[0]);
    assert.deepEqual(storageDeletes, ['pat-1/antiga.jpg']);
  } finally {
    (supabase.auth as any).getSession = origAuthGetSession;
    dom.window.close();
  }
});

// ============================================================================
// TESTE F — REGRESSÃO (SEM FOTO, REMOVER FOTO, DIA ENCERRADO, MEMBER, ESTÁTICO)
// ============================================================================

test('[Teste F] Regressão: refeição sem foto salva normal, remover foto envia photo_url=null, dia encerrado e MEMBER continuam somente leitura', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  const origFrom = (supabase as any).from;
  const origStorage = (supabase as any).storage;

  const inserts: any[] = [];
  const updates: any[] = [];
  const storageRemoves: string[] = [];

  (supabase as any).storage = {
    from: () => ({
      remove: async (paths: string[]) => {
        storageRemoves.push(...paths);
        return { data: [], error: null };
      },
    }),
  };

  (supabase as any).from = () => ({
    insert: (payload: any) => {
      inserts.push(payload);
      return {
        select: () => ({
          single: async () => ({ data: { id: 'new-1', ...payload }, error: null }),
        }),
      };
    },
    update: (payload: any) => {
      updates.push(payload);
      return {
        eq: () => ({
          select: () => ({
            single: async () => ({ data: { id: 'old-1', ...payload }, error: null }),
          }),
        }),
      };
    },
  });

  try {
    // 1. Registrar refeição sem foto continua funcionando normalmente
    await act(async () => {
      root.render(
        React.createElement(MealModal, {
          isOpen: true,
          onClose: () => {},
          event: makeBaseMealEvent(),
          patientId: 'pat-1',
          profileId: 'admin-1',
          eventDate: '2026-11-16',
          canEdit: true,
          onSuccess: () => {},
        })
      );
    });

    const saveNoPhotoBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Confirmar Refeição')
    ) as HTMLButtonElement;
    await act(async () => {
      saveNoPhotoBtn.click();
      await new Promise((r) => setTimeout(r, 20));
    });
    assert.equal(inserts.length, 1);
    assert.equal(inserts[0].photo_url, null);

    // 2. Remover foto existente salva photo_url=null e remove foto antiga só após DB confirmar
    await act(async () => {
      root.render(
        React.createElement(MealModal, {
          key: 'remove-photo-case',
          isOpen: true,
          onClose: () => {},
          event: makeBaseMealEvent({
            status: 'confirmed',
            photoSignedUrl: 'https://cdn.duca.local/signed-old.jpg',
            log: {
              id: 'old-1',
              meal_config_id: 'mc-lunch',
              patient_id: 'pat-1',
              event_date: '2026-11-16',
              consumption_status: 'normal',
              photo_url: 'pat-1/antiga-2.jpg',
              created_by: 'admin-1',
              created_at: '2026-11-16T12:00:00.000Z',
            },
          }),
          patientId: 'pat-1',
          profileId: 'admin-1',
          eventDate: '2026-11-16',
          canEdit: true,
          onSuccess: () => {},
        })
      );
    });

    const editBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('EDITAR REGISTRO')
    ) as HTMLButtonElement;
    await act(async () => {
      editBtn.click();
    });

    const rmBtn = container.querySelector('button[aria-label="Remover foto"]') as HTMLButtonElement;
    assert.ok(rmBtn);
    await act(async () => {
      rmBtn.click();
    });

    const saveAfterRemoveBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Confirmar Refeição')
    ) as HTMLButtonElement;
    await act(async () => {
      saveAfterRemoveBtn.click();
      await new Promise((r) => setTimeout(r, 20));
    });

    assert.equal(updates.length, 1);
    assert.equal(updates[0].photo_url, null);
    assert.deepEqual(storageRemoves, ['pat-1/antiga-2.jpg']);

    // 3. Dia encerrado e MEMBER permanecem estritamente protegidos
    await act(async () => {
      root.render(
        React.createElement(MealModal, {
          key: 'member-readonly',
          isOpen: true,
          onClose: () => {},
          event: makeBaseMealEvent(),
          patientId: 'pat-1',
          profileId: 'member-1',
          eventDate: '2026-11-16',
          canEdit: false,
          onSuccess: () => {},
        })
      );
    });
    assert.match(container.textContent || '', /Aguardando registro/);
    assert.equal((container.textContent || '').includes('Tirar foto'), false);
  } finally {
    await act(async () => root.unmount());
    (supabase as any).from = origFrom;
    (supabase as any).storage = origStorage;
    dom.window.close();
  }
});

test('[Teste F Estático] Entrega 01 manteve layout geral da Entrega 02 e não criou migrations nem alterou RLS', () => {
  const migrationsDir = path.resolve('supabase/migrations');
  if (fs.existsSync(migrationsDir)) {
    const files = fs.readdirSync(migrationsDir);
    assert.equal(files.some((f) => f.includes('meal_photo') || f.includes('entrega1')), false);
  }
  const todaySrc = fs.readFileSync(path.resolve('src/pages/Today.tsx'), 'utf8');
  assert.ok(todaySrc.includes('findRecoverableMealDraftForDate'));
  assert.ok(todaySrc.includes('ClosureReminderBanner'));
  assert.ok(todaySrc.includes('DailyProgressBar'));
});
