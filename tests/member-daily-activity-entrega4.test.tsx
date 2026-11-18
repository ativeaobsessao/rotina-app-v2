import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import React from 'react';
import { act } from 'react';
import { supabase } from '../src/services/supabase.ts';
import {
  clearAllUserCaches,
  createDailyClosure,
  createMealLog,
  createMedicationLog,
  deleteDailyClosure,
  getMyFamilyPermissions,
  hasActiveFamilyMembership,
  isRlsPermissionError,
  isTransientNetworkError,
  updateMealLog,
  upsertDailyMoodLog,
} from '../src/services/api.ts';
import {
  addToSyncQueue,
  processSyncQueue,
  type SyncItem,
  type SyncQueueAdapter,
} from '../src/services/syncQueue.ts';
import { ThemeProvider } from '../src/contexts/ThemeContext.tsx';
import { TodayScreen } from '../src/pages/Today.tsx';
import { HistoryScreen } from '../src/pages/History.tsx';
import { RoutineScreen } from '../src/pages/Routine.tsx';
import { FamilyModal } from '../src/components/ui/FamilyModal.tsx';
import { MealModal } from '../src/components/meals/MealModal.tsx';
import { MedicationModal } from '../src/components/medications/MedicationModal.tsx';
import { MoodAndPainModal } from '../src/components/mood/MoodAndPainModal.tsx';
import { getLocalDateString, shiftDateString } from '../src/utils/date.ts';
import type { MealEventData, MedicationEventData } from '../src/types/timeline.ts';

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
  (globalThis as any).File = dom.window.File;
  (globalThis as any).Blob = dom.window.Blob;
  (globalThis as any).localStorage = dom.window.localStorage;
  (globalThis as any).sessionStorage = dom.window.sessionStorage;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let objSeq = 0;
  (URL as any).createObjectURL = () => `blob:https://duca.local/obj-${++objSeq}`;
  (URL as any).revokeObjectURL = () => {};
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

function setReactInputValue(input: HTMLInputElement, value: string) {
  const proto = (globalThis as any).HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new (globalThis as any).Event('input', { bubbles: true }));
  input.dispatchEvent(new (globalThis as any).Event('change', { bubbles: true }));
}

interface MockMemberRecord {
  id: string;
  family_id: string;
  user_id: string;
  role: 'ADMIN' | 'MEMBER';
  member_type: 'FAMILY' | 'CAREGIVER';
  created_at: string;
}

function installEntrega4SupabaseMock(options: {
  actorId: string;
  memberships: MockMemberRecord[];
  mealLogs?: any[];
  medLogs?: any[];
  moodLog?: any | null;
  closures?: any[];
  failClosedDayTrigger?: boolean;
}) {
  const origAuthGetUser = supabase.auth.getUser.bind(supabase.auth);
  const origAuthGetSession = supabase.auth.getSession.bind(supabase.auth);
  const origFrom = (supabase as any).from;
  const origRpc = (supabase as any).rpc;
  const origStorage = (supabase as any).storage;
  const origChannel = (supabase as any).channel;
  const origRemoveChannel = (supabase as any).removeChannel;

  let actorId = options.actorId;
  let memberships = [...options.memberships];
  const mealLogs = [...(options.mealLogs || [])];
  const medLogs = [...(options.medLogs || [])];
  let moodLog: any | null = options.moodLog ?? null;
  const closures = [...(options.closures || [])];
  const storageUploads: Array<{ bucket: string; path: string }> = [];
  const mealInsertPayloads: any[] = [];
  const mealUpdatePayloads: any[] = [];
  const medInsertPayloads: any[] = [];
  const moodUpsertPayloads: any[] = [];

  const profiles = new Map<string, any>([
    ['admin-1', { id: 'admin-1', family_id: 'fam-1', name: 'Gustavo (ADM)', email: 'gustavo@duca.local', avatar_url: null }],
    ['family-member-1', { id: 'family-member-1', family_id: 'fam-1', name: 'Filha Ana', email: 'ana@duca.local', avatar_url: null }],
    ['caregiver-member-1', { id: 'caregiver-member-1', family_id: 'fam-1', name: 'Cuidadora Carla', email: 'carla@duca.local', avatar_url: null }],
    ['removed-user-1', { id: 'removed-user-1', family_id: 'fam-1', name: 'Ex-Membro João', email: 'joao@duca.local', avatar_url: null }],
  ]);

  const activeMember = () => memberships.find((m) => m.user_id === actorId && m.family_id === 'fam-1') || null;
  const isMember = () => Boolean(activeMember());
  const isAdmin = () => activeMember()?.role === 'ADMIN';

  (supabase.auth as any).getUser = async () => ({
    data: { user: { id: actorId, email: `${actorId}@duca.local` } },
    error: null,
  });
  (supabase.auth as any).getSession = async () => ({
    data: { session: { user: { id: actorId, email: `${actorId}@duca.local` } } },
    error: null,
  });
  (supabase as any).channel = () => {
    const ch: any = { on: () => ch, subscribe: () => ch, unsubscribe: async () => 'ok' };
    return ch;
  };
  (supabase as any).removeChannel = async () => 'ok';

  (supabase as any).storage = {
    from: (bucket: string) => ({
      upload: async (filePath: string) => {
        if (bucket === 'meal-records' && !isMember()) {
          return { data: null, error: { statusCode: '403', code: '42501', message: 'new row violates row-level security policy' } };
        }
        if (bucket === 'patient-profile' && !filePath.startsWith(`avatars/${actorId}/`) && !isAdmin()) {
          return { data: null, error: { statusCode: '403', code: '42501', message: 'new row violates row-level security policy' } };
        }
        storageUploads.push({ bucket, path: filePath });
        return { data: { path: filePath }, error: null };
      },
      createSignedUrl: async (filePath: string) => ({
        data: { signedUrl: `https://duca.local/signed/${bucket}/${filePath}` },
        error: null,
      }),
      remove: async () => ({ data: [], error: null }),
    }),
  };

  (supabase as any).rpc = async (fn: string) => {
    if (!isAdmin() && ['create_family_invite', 'revoke_family_invite', 'update_family_member_role', 'remove_family_member'].includes(fn)) {
      return { data: null, error: { code: '42501', message: 'Apenas administradores podem executar esta ação.' } };
    }
    return { data: null, error: null };
  };

  (supabase as any).from = (table: string) => {
    const state: any = { eqs: {}, ins: {}, lts: {}, gtes: {}, ltes: {}, op: 'select', payload: null };

    const executeSelect = () => {
      switch (table) {
        case 'profiles': {
          if (state.ins.id) {
            return { data: state.ins.id.map((id: string) => profiles.get(id)).filter(Boolean), error: null };
          }
          const prof = profiles.get(state.eqs.id || actorId) || null;
          return { data: prof ? [prof] : [], error: null };
        }
        case 'family_members': {
          const rows = memberships.filter(
            (m) =>
              (!state.eqs.user_id || m.user_id === state.eqs.user_id) &&
              (!state.eqs.family_id || m.family_id === state.eqs.family_id)
          );
          return { data: rows, error: null };
        }
        case 'family_invites': {
          if (!isAdmin()) return { data: [], error: null };
          return { data: [], error: null };
        }
        case 'patients':
          return {
            data: [{ id: 'pat-1', family_id: 'fam-1', name: 'Vovó Dude', photo_url: null, gender: 'F' }],
            error: null,
          };
        case 'meal_configs':
          return {
            data: [
              { id: 'mc-1', patient_id: 'pat-1', name: 'Almoço', type: 'lunch', scheduled_time: '12:00:00', display_order: 1, active: true },
            ],
            error: null,
          };
        case 'medication_periods':
          return {
            data: [{ id: 'per-1', patient_id: 'pat-1', name: 'Manhã', scheduled_time: '08:00:00', display_order: 1, active: true }],
            error: null,
          };
        case 'medications':
          return {
            data: [{ id: 'med-1', patient_id: 'pat-1', period_id: 'per-1', name: 'Losartana', dosage: '50mg', weekdays: null, active: true }],
            error: null,
          };
        case 'meal_logs': {
          const rows = mealLogs.filter((r) => {
            if (state.eqs.id && r.id !== state.eqs.id) return false;
            if (state.eqs.patient_id && r.patient_id !== state.eqs.patient_id) return false;
            if (state.eqs.event_date && r.event_date !== state.eqs.event_date) return false;
            if (state.lts.event_date && !(r.event_date < state.lts.event_date)) return false;
            return true;
          });
          return { data: rows, error: null };
        }
        case 'medication_logs': {
          const rows = medLogs.filter((r) => {
            if (state.eqs.id && r.id !== state.eqs.id) return false;
            if (state.eqs.patient_id && r.patient_id !== state.eqs.patient_id) return false;
            if (state.eqs.event_date && r.event_date !== state.eqs.event_date) return false;
            if (state.lts.event_date && !(r.event_date < state.lts.event_date)) return false;
            return true;
          });
          return { data: rows, error: null };
        }
        case 'daily_mood_logs': {
          const match =
            moodLog &&
            (!state.eqs.patient_id || moodLog.patient_id === state.eqs.patient_id) &&
            (!state.eqs.date || moodLog.date === state.eqs.date)
              ? [moodLog]
              : [];
          return { data: match, error: null };
        }
        case 'daily_closures': {
          const rows = closures.filter((c) => {
            if (state.eqs.patient_id && c.patient_id !== state.eqs.patient_id) return false;
            if (state.eqs.date && c.date !== state.eqs.date) return false;
            if (state.lts.date && !(c.date < state.lts.date)) return false;
            return true;
          });
          return { data: rows, error: null };
        }
        default:
          return { data: [], error: null };
      }
    };

    const executeWrite = () => {
      if (table === 'daily_closures') {
        if (state.op === 'insert') {
          if (!isMember() || state.payload?.closed_by !== actorId) {
            return {
              data: null,
              error: { code: '42501', message: 'new row violates row-level security policy for table "daily_closures"' },
            };
          }
          const row = {
            id: `cl-${closures.length + 1}`,
            ...state.payload,
            closed_at: '2026-11-16T23:00:00.000Z',
            closed_by_profile: { name: profiles.get(actorId)?.name || 'Familiar' },
          };
          closures.push(row);
          return { data: row, error: null };
        }
        if (state.op === 'delete') {
          if (!isAdmin()) {
            return {
              data: null,
              error: { code: '42501', message: 'new row violates row-level security policy for table "daily_closures"' },
            };
          }
          return { data: null, error: null };
        }
      }

      if (table === 'meal_logs') {
        if (!isMember()) {
          return {
            data: null,
            error: { code: '42501', message: 'new row violates row-level security policy for table "meal_logs"' },
          };
        }
        const targetDate = state.payload?.event_date || mealLogs.find((m) => m.id === state.eqs.id)?.event_date;
        if (options.failClosedDayTrigger || closures.some((c) => c.date === targetDate)) {
          return {
            data: null,
            error: { code: 'P0001', message: 'Dia já foi encerrado. Reabra o dia antes de alterar refeições.' },
          };
        }
        if (state.op === 'insert') {
          mealInsertPayloads.push(state.payload);
          const created = {
            id: `ml-${mealLogs.length + 1}`,
            ...state.payload,
            created_at: '2026-11-16T15:00:00.000Z',
            updated_at: '2026-11-16T15:00:00.000Z',
            creator: { name: profiles.get(actorId)?.name || 'Familiar' },
            updater: { name: profiles.get(actorId)?.name || 'Familiar' },
          };
          mealLogs.push(created);
          return { data: created, error: null };
        }
        if (state.op === 'update') {
          mealUpdatePayloads.push(state.payload);
          const idx = mealLogs.findIndex((m) => m.id === state.eqs.id);
          const prev = idx >= 0 ? mealLogs[idx] : {};
          const updated = {
            ...prev,
            ...state.payload,
            created_by: prev.created_by, // trigger preserve_meal_log_creator mantém autoria original
            updated_at: '2026-11-16T16:00:00.000Z',
            updater: { name: profiles.get(actorId)?.name || 'Familiar' },
          };
          if (idx >= 0) mealLogs[idx] = updated;
          return { data: updated, error: null };
        }
      }

      if (table === 'medication_logs') {
        if (!isMember()) {
          return {
            data: null,
            error: { code: '42501', message: 'new row violates row-level security policy for table "medication_logs"' },
          };
        }
        if (options.failClosedDayTrigger || closures.some((c) => c.date === state.payload?.event_date)) {
          return {
            data: null,
            error: { code: 'P0001', message: 'Dia já foi encerrado. Reabra o dia antes de alterar medicamentos.' },
          };
        }
        if (state.op === 'insert') {
          medInsertPayloads.push(state.payload);
          const created = {
            id: `medl-${medLogs.length + 1}`,
            ...state.payload,
            created_at: '2026-11-16T11:00:00.000Z',
            updated_at: '2026-11-16T11:00:00.000Z',
          };
          medLogs.push(created);
          return { data: created, error: null };
        }
      }

      if (table === 'daily_mood_logs') {
        if (!isMember()) {
          return {
            data: null,
            error: { code: '42501', message: 'new row violates row-level security policy for table "daily_mood_logs"' },
          };
        }
        moodUpsertPayloads.push(state.payload);
        moodLog = {
          id: 'mood-1',
          ...state.payload,
          updater: { name: profiles.get(actorId)?.name || 'Familiar' },
        };
        return { data: moodLog, error: null };
      }

      return { data: null, error: { code: '42501', message: `permission denied for table ${table}` } };
    };

    const run = () => (state.op === 'select' ? executeSelect() : executeWrite());

    const builder: any = {
      select: () => builder,
      eq: (col: string, val: any) => {
        state.eqs[col] = val;
        return builder;
      },
      in: (col: string, vals: any[]) => {
        state.ins[col] = vals;
        return builder;
      },
      lt: (col: string, val: any) => {
        state.lts[col] = val;
        return builder;
      },
      gte: (col: string, val: any) => {
        state.gtes[col] = val;
        return builder;
      },
      lte: (col: string, val: any) => {
        state.ltes[col] = val;
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      insert: (payload: any) => {
        state.op = 'insert';
        state.payload = Array.isArray(payload) ? payload[0] : payload;
        return builder;
      },
      update: (payload: any) => {
        state.op = 'update';
        state.payload = payload;
        return builder;
      },
      upsert: (payload: any) => {
        state.op = 'upsert';
        state.payload = payload;
        return builder;
      },
      delete: () => {
        state.op = 'delete';
        return builder;
      },
      single: async () => {
        const res = run();
        const row = Array.isArray(res.data) ? res.data[0] ?? null : res.data;
        return { data: row, error: res.error };
      },
      maybeSingle: async () => {
        const res = run();
        const row = Array.isArray(res.data) ? res.data[0] ?? null : res.data;
        return { data: row, error: res.error };
      },
      then: (resolve: (v: any) => any, reject?: (e: any) => any) => Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  };

  return {
    setActor: (id: string) => {
      actorId = id;
    },
    setMemberships: (next: MockMemberRecord[]) => {
      memberships = [...next];
    },
    getStorageUploads: () => storageUploads,
    getMealInsertPayloads: () => mealInsertPayloads,
    getMealUpdatePayloads: () => mealUpdatePayloads,
    getMedInsertPayloads: () => medInsertPayloads,
    getMoodUpsertPayloads: () => moodUpsertPayloads,
    getMealLogs: () => mealLogs,
    getMedLogs: () => medLogs,
    getMoodLog: () => moodLog,
    restore: () => {
      (supabase.auth as any).getUser = origAuthGetUser;
      (supabase.auth as any).getSession = origAuthGetSession;
      (supabase as any).from = origFrom;
      (supabase as any).rpc = origRpc;
      (supabase as any).storage = origStorage;
      (supabase as any).channel = origChannel;
      (supabase as any).removeChannel = origRemoveChannel;
    },
  };
}

// ============================================================================
// 1. VALIDAÇÃO ESTÁTICA DA MIGRATION 0016 (ENTREGA 04) E PRESERVAÇÃO DE 0014/0015/0016_delete
// ============================================================================

test('[Estático SQL] Migration 0016_member_daily_activity_write_access libera cuidados diários a user_in_family mantendo admin-only e autoria', () => {
  const sql0016 = fs.readFileSync(
    path.resolve('supabase/migrations/0016_member_daily_activity_write_access.sql'),
    'utf8'
  );

  // Idempotência: toda CREATE POLICY possui DROP POLICY IF EXISTS prévio
  const createPolicyRegex = /CREATE POLICY\s+"([^"]+)"\s+ON\s+([a-zA-Z0-9_.]+)/g;
  const policies: Array<{ name: string; table: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = createPolicyRegex.exec(sql0016)) !== null) {
    policies.push({ name: m[1], table: m[2], index: m.index });
  }
  assert.equal(policies.length, 6, 'Esperadas 6 políticas (INSERT/UPDATE em meal_logs, medication_logs, daily_mood_logs)');
  for (const p of policies) {
    assert.ok(
      sql0016.slice(0, p.index).includes(`DROP POLICY IF EXISTS "${p.name}" ON ${p.table};`),
      `Faltou DROP POLICY IF EXISTS para "${p.name}" ON ${p.table}`
    );
  }

  // Sem comandos destrutivos
  assert.equal(/DROP TABLE/i.test(sql0016), false);
  assert.equal(/TRUNCATE/i.test(sql0016), false);
  assert.equal(/DELETE FROM/i.test(sql0016), false);

  // Políticas de logs diários usam user_in_family + autoria e NÃO concedem DELETE
  assert.match(sql0016, /ON public\.meal_logs[\s\S]*?FOR INSERT[\s\S]*?created_by = auth\.uid\(\)\s+AND updated_by = auth\.uid\(\)[\s\S]*?public\.user_in_family\(p\.family_id\)/);
  assert.match(sql0016, /ON public\.meal_logs[\s\S]*?FOR UPDATE[\s\S]*?public\.user_in_family\(p\.family_id\)[\s\S]*?updated_by = auth\.uid\(\)/);
  assert.match(sql0016, /ON public\.medication_logs[\s\S]*?FOR INSERT[\s\S]*?created_by = auth\.uid\(\)\s+AND updated_by = auth\.uid\(\)[\s\S]*?public\.user_in_family\(p\.family_id\)/);
  assert.match(sql0016, /ON public\.medication_logs[\s\S]*?FOR UPDATE[\s\S]*?public\.user_in_family\(p\.family_id\)[\s\S]*?updated_by = auth\.uid\(\)/);
  assert.match(sql0016, /ON public\.daily_mood_logs[\s\S]*?FOR INSERT[\s\S]*?updated_by = auth\.uid\(\)\s+AND public\.user_in_family\(family_id\)/);
  assert.match(sql0016, /ON public\.daily_mood_logs[\s\S]*?FOR UPDATE[\s\S]*?public\.user_in_family\(family_id\)[\s\S]*?updated_by = auth\.uid\(\)/);
  assert.equal(/CREATE POLICY[\s\S]*?FOR DELETE/i.test(sql0016), false);

  // Storage: meal-records para user_in_family; patient-profile/{patient_id} segue user_is_family_admin; avatars próprio usuário
  assert.match(
    sql0016,
    /IF bucket_name = 'meal-records' THEN\s+RETURN public\.user_in_family\(patient_family_id\);\s+END IF;/
  );
  assert.match(
    sql0016,
    /RETURN public\.user_is_family_admin\(patient_family_id\);/
  );
  assert.match(
    sql0016,
    /IF bucket_name = 'patient-profile' AND first_segment = 'avatars' THEN[\s\S]*?second_segment = auth\.uid\(\)::text/
  );
  assert.ok(sql0016.includes("NOTIFY pgrst, 'reload schema';"));

  // Verifica que 0014, 0015 e 0016_delete_family_invites permaneceram intactas
  const sql0014 = fs.readFileSync(path.resolve('supabase/migrations/0014_rbac_and_rls_hardening.sql'), 'utf8');
  const sql0015 = fs.readFileSync(path.resolve('supabase/migrations/0015_family_caregiver_distinction.sql'), 'utf8');
  const sql0016Delete = fs.readFileSync(path.resolve('supabase/migrations/0016_delete_family_invites.sql'), 'utf8');
  assert.ok(sql0014.includes('CREATE TRIGGER preserve_meal_log_creator'));
  assert.ok(sql0015.includes('member_type'));
  assert.ok(sql0016Delete.includes('delete_family_invite'));
});

// ============================================================================
// 2. TESTE A — FAMILIAR + MEMBER REGISTRA REFEIÇÃO (COM FOTO), MEDICAMENTO, BEM-ESTAR E EDITA
// ============================================================================

test('[Teste A] FAMILY + MEMBER registra refeição com foto, medicamento, bem-estar e edita registro preservando created_by', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const mock = installEntrega4SupabaseMock({
    actorId: 'family-member-1',
    memberships: [
      { id: 'fm-fam', family_id: 'fam-1', user_id: 'family-member-1', role: 'MEMBER', member_type: 'FAMILY', created_at: '2026-11-01T10:00:00Z' },
    ],
  });

  try {
    await clearAllUserCaches();
    const perms = await getMyFamilyPermissions('fam-1');
    assert.deepEqual(perms, { isMember: true, isAdmin: false, role: 'MEMBER' });
    assert.equal(await hasActiveFamilyMembership('fam-1'), true);

    // 1. TodayScreen libera botão "+ Bem-estar" para FAMILY + MEMBER
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
      await new Promise((r) => setTimeout(r, 120));
    });

    const todayText = container.textContent || '';
    assert.match(todayText, /\+\s*Bem-estar/);

    // 2. Registra refeição com foto no MealModal como FAMILY + MEMBER
    const pendingMeal: MealEventData = {
      id: 'mc-1',
      type: 'meal',
      time: '12:00:00',
      title: 'Almoço',
      status: 'pending',
      mealConfig: { id: 'mc-1', name: 'Almoço', scheduled_time: '12:00:00' },
      log: null,
    };

    let mealSaved = 0;
    await act(async () => {
      root.render(
        React.createElement(MealModal, {
          isOpen: true,
          onClose: () => {},
          event: pendingMeal,
          patientId: 'pat-1',
          profileId: 'family-member-1',
          eventDate: '2026-11-16',
          canEdit: true,
          onSuccess: () => {
            mealSaved += 1;
          },
        })
      );
    });

    // Simula seleção de foto via galeria + descrição e confirmação
    const galleryInput = container.querySelector('[data-testid="gallery-input"]') as HTMLInputElement;
    assert.ok(galleryInput);
    const jpegBytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
      0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12,
      0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x03, 0x84, 0x04, 0xb0, 0x01,
      0x01, 0x11, 0x00,
    ]);
    const photoFile = new dom.window.File([jpegBytes], 'almoco.jpg', { type: 'image/jpeg' });
    Object.defineProperty(galleryInput, 'files', { value: [photoFile], configurable: true });
    await act(async () => {
      galleryInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
    });

    const descInput = container.querySelector('input[placeholder*="Arroz"]') as HTMLInputElement;
    assert.ok(descInput);
    await act(async () => {
      setReactInputValue(descInput, 'Arroz, feijão e frango grelhado');
    });

    const confirmMealBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Confirmar Refeição')
    );
    assert.ok(confirmMealBtn);
    await act(async () => {
      confirmMealBtn.click();
      await new Promise((r) => setTimeout(r, 80));
    });

    assert.equal(mealSaved, 1);
    assert.equal(mock.getStorageUploads().length, 1);
    assert.equal(mock.getStorageUploads()[0].bucket, 'meal-records');
    assert.equal(mock.getMealInsertPayloads()[0].created_by, 'family-member-1');
    assert.equal(mock.getMealInsertPayloads()[0].description, 'Arroz, feijão e frango grelhado');

    // 3. Registra medicamento como FAMILY + MEMBER
    const pendingMed: MedicationEventData = {
      id: 'per-1',
      type: 'medication_period',
      time: '08:00:00',
      title: 'Manhã',
      status: 'pending',
      period: { id: 'per-1', name: 'Manhã', scheduled_time: '08:00:00' },
      medications: [{ id: 'med-1', name: 'Losartana', dosage: '50mg' }],
      logs: [],
    };
    let medSaved = 0;
    await act(async () => {
      root.render(
        React.createElement(MedicationModal, {
          isOpen: true,
          onClose: () => {},
          event: pendingMed,
          patientId: 'pat-1',
          profileId: 'family-member-1',
          eventDate: '2026-11-16',
          canEdit: true,
          onSuccess: () => {
            medSaved += 1;
          },
        })
      );
    });

    const medCheckBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Losartana')
    );
    assert.ok(medCheckBtn);
    await act(async () => {
      medCheckBtn.click();
    });
    const confirmMedBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Confirmar Medicamentos')
    );
    assert.ok(confirmMedBtn);
    await act(async () => {
      confirmMedBtn.click();
      await new Promise((r) => setTimeout(r, 60));
    });

    assert.equal(medSaved, 1);
    assert.equal(mock.getMedInsertPayloads()[0].created_by, 'family-member-1');
    assert.equal(mock.getMedInsertPayloads()[0].status, 'administered');

    // 4. Registra bem-estar como FAMILY + MEMBER
    let moodSaved: any = null;
    await act(async () => {
      root.render(
        React.createElement(MoodAndPainModal, {
          isOpen: true,
          onClose: () => {},
          patientId: 'pat-1',
          familyId: 'fam-1',
          profileId: 'family-member-1',
          patientName: 'Vovó Dude',
          dateStr: '2026-11-16',
          currentLog: null,
          canEdit: true,
          onSuccess: (res) => {
            moodSaved = res;
          },
        })
      );
    });

    const saveMoodBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Salvar Bem-Estar de Hoje')
    );
    assert.ok(saveMoodBtn);
    await act(async () => {
      saveMoodBtn.click();
      await new Promise((r) => setTimeout(r, 60));
    });
    assert.ok(moodSaved);
    assert.equal(mock.getMoodUpsertPayloads()[0].updated_by, 'family-member-1');

    // 5. Atualiza refeição criada por outro usuário preservando created_by e definindo updated_by
    const adminMeal = await mock.getMealLogs()[0];
    adminMeal.created_by = 'admin-1';
    const updated = await updateMealLog(adminMeal.id, {
      patient_id: 'pat-1',
      event_date: '2026-11-16',
      notes: 'Comeu todo o prato e repetiu o suco.',
      updated_by: 'family-member-1',
    });
    assert.equal(updated.created_by, 'admin-1');
    assert.equal(updated.updated_by, 'family-member-1');
  } finally {
    await act(async () => root.unmount());
    mock.restore();
    await clearAllUserCaches();
    dom.window.close();
  }
});

// ============================================================================
// 3. TESTE B — CAREGIVER + MEMBER REGISTRA CUIDADOS + HISTÓRICO ABERTO
// ============================================================================

test('[Teste B] CAREGIVER + MEMBER registra cuidados diários e edita dias em aberto no Histórico sem poderes administrativos', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const yesterdayStr = shiftDateString(getLocalDateString(), -1);
  const mock = installEntrega4SupabaseMock({
    actorId: 'caregiver-member-1',
    memberships: [
      { id: 'fm-care', family_id: 'fam-1', user_id: 'caregiver-member-1', role: 'MEMBER', member_type: 'CAREGIVER', created_at: '2026-11-02T10:00:00Z' },
    ],
    mealLogs: [
      {
        id: 'ml-open-1',
        meal_config_id: 'mc-1',
        patient_id: 'pat-1',
        event_date: yesterdayStr,
        consumption_status: 'normal',
        description: 'Sopa de legumes',
        meal_time: '12:15:00',
        created_by: 'admin-1',
        created_at: `${yesterdayStr}T15:15:00.000Z`,
        meal_config: { id: 'mc-1', name: 'Almoço', scheduled_time: '12:00:00' },
        creator: { name: 'Gustavo (ADM)' },
      },
    ],
  });

  try {
    await clearAllUserCaches();
    const perms = await getMyFamilyPermissions('fam-1');
    assert.deepEqual(perms, { isMember: true, isAdmin: false, role: 'MEMBER' });

    // 1. Cuidadora MEMBER cria registro + foto e atualiza bem-estar
    const createdMeal = await createMealLog({
      patient_id: 'pat-1',
      meal_config_id: 'mc-1',
      event_date: '2026-11-16',
      consumption_status: 'partial',
      description: 'Vitamina de frutas',
      created_by: 'caregiver-member-1',
      updated_by: 'caregiver-member-1',
    });
    assert.equal(createdMeal.created_by, 'caregiver-member-1');

    const mood = await upsertDailyMoodLog({
      patient_id: 'pat-1',
      family_id: 'fam-1',
      date: '2026-11-16',
      mood: 'calm',
      pain_level: 'mild',
      pain_locations: ['legs'],
      notes: 'Caminhou 10 minutos no quintal.',
      updated_by: 'caregiver-member-1',
    });
    assert.equal(mood?.updated_by, 'caregiver-member-1');

    // 2. HistoryScreen para CAREGIVER + MEMBER permite editar registros e encerrar dia aberto
    let requestedEditDate: string | null = null;
    await act(async () => {
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(HistoryScreen, {
            onEditPastDay: (d) => {
              requestedEditDate = d;
            },
          })
        )
      );
      await new Promise((r) => setTimeout(r, 150));
    });

    const dayHeaderBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Dia em aberto')
    );
    assert.ok(dayHeaderBtn, 'Deveria exibir dia em aberto no Histórico');
    await act(async () => {
      dayHeaderBtn.click();
    });

    const histText = container.textContent || '';
    assert.match(histText, /Editar registros deste dia/);
    assert.match(histText, /Encerrar Dia/);

    const editDayBtn = (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.textContent?.includes('Editar registros deste dia')
    );
    assert.ok(editDayBtn);
    await act(async () => {
      editDayBtn.click();
    });
    assert.equal(requestedEditDate, yesterdayStr);
  } finally {
    await act(async () => root.unmount());
    mock.restore();
    await clearAllUserCaches();
    dom.window.close();
  }
});

// ============================================================================
// 4. TESTE C & D — ADMIN MANTÉM TUDO vs MEMBER BLOQUEADO DE AÇÕES ADMINISTRATIVAS
// ============================================================================

test('[Testes C & D] ADMIN mantém ações administrativas enquanto MEMBER fica restrito exclusivamente a registros diários', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const mock = installEntrega4SupabaseMock({
    actorId: 'admin-1',
    memberships: [
      { id: 'fm-adm', family_id: 'fam-1', user_id: 'admin-1', role: 'ADMIN', member_type: 'FAMILY', created_at: '2026-11-01T10:00:00Z' },
      { id: 'fm-mem', family_id: 'fam-1', user_id: 'family-member-1', role: 'MEMBER', member_type: 'FAMILY', created_at: '2026-11-02T10:00:00Z' },
    ],
  });

  try {
    await clearAllUserCaches();

    // 1. Teste C: ADMIN vê banner às 21:30 BRT e botões administrativos na Rotina
    await act(async () => {
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(TodayScreen, {
            nowProvider: () => new Date('2026-11-17T00:30:00.000Z'), // 21:30 BRT de 2026-11-16
          })
        )
      );
      await new Promise((r) => setTimeout(r, 120));
    });
    assert.ok(container.querySelector('[aria-label="Lembrete de encerramento diário"]'));

    await act(async () => {
      root.render(React.createElement(ThemeProvider, null, React.createElement(RoutineScreen)));
      await new Promise((r) => setTimeout(r, 120));
    });
    assert.match(container.textContent || '', /Editar perfil/);
    assert.match(container.textContent || '', /Adicionar/);

    // 2. Teste D: Troca para MEMBER — vê seção final de encerramento e lembrete 21h, encerra o dia, mas Rotina/FamilyModal/Reabrir seguem restritos a ADMIN
    mock.setActor('family-member-1');
    await clearAllUserCaches();

    await act(async () => {
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(TodayScreen, {
            key: 'today-member',
            nowProvider: () => new Date('2026-11-17T00:30:00.000Z'),
          })
        )
      );
      await new Promise((r) => setTimeout(r, 120));
    });
    assert.ok(container.querySelector('section[aria-label="Encerramento do dia"]'));
    assert.ok(container.querySelector('[aria-label="Lembrete de encerramento diário"]'));
    assert.match(container.textContent || '', /\+\s*Bem-estar/);

    await act(async () => {
      root.render(React.createElement(ThemeProvider, null, React.createElement(RoutineScreen, { key: 'routine-member' })));
      await new Promise((r) => setTimeout(r, 120));
    });
    const routineMemberText = container.textContent || '';
    assert.match(routineMemberText, /Almoço/);
    assert.equal(routineMemberText.includes('Editar perfil'), false);
    assert.equal(routineMemberText.includes('Adicionar Período'), false);
    assert.equal(routineMemberText.includes('Adicionar medicamento'), false);
    assert.equal(routineMemberText.includes('Editar horário'), false);
    assert.match(routineMemberText, /Atividades/);

    await act(async () => {
      root.render(
        React.createElement(FamilyModal, {
          familyId: 'fam-1',
          currentUserId: 'family-member-1',
          lovedOneName: 'Vovó Dude',
          onClose: () => {},
        })
      );
      await new Promise((r) => setTimeout(r, 80));
    });
    const familyText = container.textContent || '';
    assert.equal(familyText.includes('+ Novo Convite'), false);
    assert.equal(familyText.includes('Convites Pendentes'), false);
    assert.equal(container.querySelectorAll('button[title="Remover Membro"]').length, 0);

    // Encerrar dia como MEMBER é permitido com autoria própria, mas reabrir dia encerrado continua restrito a ADMIN
    const closureCreateRes = await createDailyClosure('fam-1', 'pat-1', '2026-11-16', 'family-member-1');
    assert.equal(closureCreateRes.success, true);
    assert.equal(closureCreateRes.closure?.closed_by, 'family-member-1');

    const closureDeleteRes = await deleteDailyClosure('pat-1', '2026-11-16');
    assert.equal(closureDeleteRes.success, false);
    assert.equal(closureDeleteRes.queued, undefined);
    assert.match(closureDeleteRes.error || '', /Apenas administradores/);
  } finally {
    await act(async () => root.unmount());
    mock.restore();
    await clearAllUserCaches();
    dom.window.close();
  }
});

// ============================================================================
// 5. TESTE E — USUÁRIO REMOVIDO DA FAMÍLIA (FAIL-CLOSED SEM FALLBACK PARA PROFILES)
// ============================================================================

test('[Teste E] Usuário sem vínculo ativo em family_members falha fechado (isMember=false) e permanece bloqueado em UI/API', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  // removed-user-1 ainda tem profiles.family_id = 'fam-1', mas NÃO tem linha em family_members
  const mock = installEntrega4SupabaseMock({
    actorId: 'removed-user-1',
    memberships: [],
  });

  try {
    await clearAllUserCaches();

    const perms = await getMyFamilyPermissions('fam-1');
    assert.deepEqual(perms, { isMember: false, isAdmin: false, role: null });
    assert.equal(await hasActiveFamilyMembership('fam-1'), false);

    // TodayScreen não exibe "+ Bem-estar"
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
      await new Promise((r) => setTimeout(r, 120));
    });
    assert.equal(/\+\s*Bem-estar/.test(container.textContent || ''), false);

    // MoodAndPainModal com canEdit=false bloqueia salvamento
    await act(async () => {
      root.render(
        React.createElement(MoodAndPainModal, {
          isOpen: true,
          onClose: () => {},
          patientId: 'pat-1',
          familyId: 'fam-1',
          profileId: 'removed-user-1',
          patientName: 'Vovó Dude',
          dateStr: '2026-11-16',
          currentLog: null,
          canEdit: false,
          onSuccess: () => {},
        })
      );
    });
    assert.match(container.textContent || '', /Aguardando atualização de hoje/);
    assert.equal((container.textContent || '').includes('Salvar Bem-Estar de Hoje'), false);

    // Mutações diretas de API rejeitam com erro permanente de vínculo ativo (não enfileiram)
    await assert.rejects(
      () =>
        createMealLog({
          patient_id: 'pat-1',
          meal_config_id: 'mc-1',
          event_date: '2026-11-16',
          consumption_status: 'normal',
          created_by: 'removed-user-1',
          updated_by: 'removed-user-1',
        }),
      { message: /vínculo ativo/i }
    );
    await assert.rejects(
      () =>
        upsertDailyMoodLog({
          patient_id: 'pat-1',
          family_id: 'fam-1',
          date: '2026-11-16',
          mood: 'happy',
          pain_level: 'none',
          pain_locations: [],
          updated_by: 'removed-user-1',
        }),
      { message: /vínculo ativo/i }
    );
  } finally {
    await act(async () => root.unmount());
    mock.restore();
    await clearAllUserCaches();
    dom.window.close();
  }
});

// ============================================================================
// 6. TESTE F — PROTEÇÃO CONTRA ALTERAÇÃO EM DIA ENCERRADO PARA MEMBER
// ============================================================================

test('[Teste F] Dia encerrado bloqueia alteração na UI e no backend sem enfileirar erro de trigger offline', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const mock = installEntrega4SupabaseMock({
    actorId: 'caregiver-member-1',
    memberships: [
      { id: 'fm-care', family_id: 'fam-1', user_id: 'caregiver-member-1', role: 'MEMBER', member_type: 'CAREGIVER', created_at: '2026-11-02T10:00:00Z' },
    ],
    closures: [{ id: 'cl-1', patient_id: 'pat-1', family_id: 'fam-1', date: '2026-11-14', closed_at: '2026-11-14T23:00:00Z' }],
    failClosedDayTrigger: true,
  });

  try {
    await clearAllUserCaches();

    const closedMeal: MealEventData = {
      id: 'mc-1',
      type: 'meal',
      time: '12:00:00',
      title: 'Almoço',
      status: 'confirmed',
      mealConfig: { id: 'mc-1', name: 'Almoço', scheduled_time: '12:00:00' },
      log: {
        id: 'ml-1',
        consumption_status: 'normal',
        description: 'Peixe assado',
        created_by: 'admin-1',
        created_at: '2026-11-14T15:00:00Z',
      },
    };

    await act(async () => {
      root.render(
        React.createElement(MealModal, {
          isOpen: true,
          onClose: () => {},
          event: closedMeal,
          patientId: 'pat-1',
          profileId: 'caregiver-member-1',
          eventDate: '2026-11-14',
          isDayClosed: true,
          canEdit: true,
          onSuccess: () => {},
        })
      );
    });
    assert.match(container.textContent || '', /Dia encerrado/);
    assert.equal((container.textContent || '').includes('EDITAR REGISTRO'), false);

    // Erro de trigger de dia encerrado NÃO deve ser classificado como erro transitório nem ir para fila offline
    const closedErr = { code: 'P0001', message: 'Dia já foi encerrado. Reabra o dia antes de alterar refeições.' };
    assert.equal(isTransientNetworkError(closedErr), false);

    await assert.rejects(
      () =>
        createMealLog({
          patient_id: 'pat-1',
          meal_config_id: 'mc-1',
          event_date: '2026-11-14',
          consumption_status: 'normal',
          created_by: 'caregiver-member-1',
          updated_by: 'caregiver-member-1',
        }),
      { message: /Dia já foi encerrado/ }
    );
  } finally {
    await act(async () => root.unmount());
    mock.restore();
    await clearAllUserCaches();
    dom.window.close();
  }
});

// ============================================================================
// 7. TESTE G — CONCORRÊNCIA & PRESERVAÇÃO DE AUTORIA ENTRE DOIS FAMILIARES
// ============================================================================

test('[Teste G] Concorrência e autoria: conflito 23505 e updated_at obsoleto disparam aviso sem sobrescrever created_by', async () => {
  const origFrom = (supabase as any).from;
  try {
    // 1. Erro 23505 quando outro membro inseriu segundos antes -> informa conflito amigável
    (supabase as any).from = () => {
      let op = 'select';
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        insert: () => {
          op = 'insert';
          return builder;
        },
        single: async () =>
          op === 'insert'
            ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
            : { data: null, error: null },
        maybeSingle: async () => ({
          data: {
            id: 'ml-race',
            created_by: 'caregiver-member-1',
            creator: { name: 'Cuidadora Carla' },
          },
          error: null,
        }),
      };
      return builder;
    };

    await assert.rejects(
      () =>
        createMealLog({
          patient_id: 'pat-1',
          meal_config_id: 'mc-1',
          event_date: '2026-11-16',
          consumption_status: 'normal',
          created_by: 'family-member-1',
          updated_by: 'family-member-1',
        }),
      { message: /Cuidadora Carla/ }
    );

    // 2. Edição concorrente com expectedUpdatedAt desatualizado por outro usuário -> aborta com mensagem clara
    (supabase as any).from = () => {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({
          data: {
            id: 'ml-race',
            updated_at: '2026-11-16T12:05:00.000Z',
            updated_by: 'admin-1',
            updater: { name: 'Gustavo (ADM)' },
          },
          error: null,
        }),
      };
      return builder;
    };

    await assert.rejects(
      () =>
        updateMealLog(
          'ml-race',
          { patient_id: 'pat-1', event_date: '2026-11-16', notes: 'Alteração tardia', updated_by: 'family-member-1' },
          { expectedUpdatedAt: '2026-11-16T12:00:00.000Z' }
        ),
      { message: /Gustavo \(ADM\)/ }
    );
  } finally {
    (supabase as any).from = origFrom;
  }
});

// ============================================================================
// 8. TESTE H — FILA OFFLINE DO MEMBER SINCRONIZA NA RECONEXÃO EM ORDEM FIFO
// ============================================================================

test('[Teste H] MEMBER registra offline (refeição com foto, medicamento e bem-estar) e sincroniza FIFO ao reconectar', async () => {
  await setupDom();
  let queue: SyncItem[] = [];
  const executionOrder: string[] = [];
  const uploadedPaths: string[] = [];

  const adapter: SyncQueueAdapter = {
    getQueue: async () => queue.map((q) => ({ ...q })),
    saveQueue: async (items) => {
      queue = items.map((q) => ({ ...q }));
    },
    getSessionUserId: async () => 'caregiver-member-1',
    isOnline: () => true,
    client: {
      storage: {
        from: (bucket: string) => ({
          upload: async (filePath: string) => {
            uploadedPaths.push(`${bucket}/${filePath}`);
            return { data: { path: filePath }, error: null };
          },
          remove: async () => ({ data: [], error: null }),
        }),
      },
      from: (table: string) => {
        const state: any = { op: 'select', payload: null };
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          insert: (p: any) => {
            state.op = 'insert';
            state.payload = p;
            return builder;
          },
          upsert: (p: any) => {
            state.op = 'upsert';
            state.payload = p;
            return builder;
          },
          single: async () => {
            executionOrder.push(`${table}:${state.op}`);
            return { data: { id: `srv-${executionOrder.length}`, ...state.payload }, error: null };
          },
          maybeSingle: async () => {
            executionOrder.push(`${table}:${state.op}`);
            return { data: { id: `srv-${executionOrder.length}`, ...state.payload }, error: null };
          },
        };
        return builder;
      },
    },
  };

  await addToSyncQueue(
    'createMealLog',
    {
      patient_id: 'pat-1',
      meal_config_id: 'mc-1',
      event_date: '2026-11-16',
      consumption_status: 'normal',
      created_by: 'caregiver-member-1',
      updated_by: 'caregiver-member-1',
    },
    {
      patientId: 'pat-1',
      eventDate: '2026-11-16',
      userId: 'caregiver-member-1',
      offlinePhoto: {
        bucket: 'meal-records',
        patientId: 'pat-1',
        fileName: 'offline-almoco.jpg',
        blob: new (globalThis as any).Blob(['jpeg'], { type: 'image/jpeg' }),
      },
    },
    adapter
  );
  await addToSyncQueue(
    'createMedicationLog',
    {
      patient_id: 'pat-1',
      medication_id: 'med-1',
      event_date: '2026-11-16',
      status: 'administered',
      created_by: 'caregiver-member-1',
      updated_by: 'caregiver-member-1',
    },
    { patientId: 'pat-1', eventDate: '2026-11-16', userId: 'caregiver-member-1' },
    adapter
  );
  await addToSyncQueue(
    'upsertDailyMoodLog',
    {
      patient_id: 'pat-1',
      family_id: 'fam-1',
      date: '2026-11-16',
      mood: 'happy',
      pain_level: 'none',
      pain_locations: [],
      updated_by: 'caregiver-member-1',
    },
    { patientId: 'pat-1', eventDate: '2026-11-16', userId: 'caregiver-member-1' },
    adapter
  );

  const res = await processSyncQueue({ adapter });
  assert.equal(res.processed, 3);
  assert.equal(res.failed, 0);
  assert.equal(res.remainingPending, 0);
  assert.deepEqual(uploadedPaths, ['meal-records/pat-1/offline-almoco.jpg']);
  assert.deepEqual(executionOrder, ['meal_logs:insert', 'medication_logs:insert', 'daily_mood_logs:upsert']);
});

// ============================================================================
// 9. TESTE I — REGRESSÃO DE COPY EXPLICATIVA E MENSAGENS DE ERRO
// ============================================================================

test('[Teste I] Textos explicativos em FamilyModal refletem papel colaborativo de MEMBER e mantêm distinção entre Familiar/Cuidador e ADM', async () => {
  const { dom, createRoot } = await setupDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const mock = installEntrega4SupabaseMock({
    actorId: 'admin-1',
    memberships: [
      { id: 'fm-adm', family_id: 'fam-1', user_id: 'admin-1', role: 'ADMIN', member_type: 'FAMILY', created_at: '2026-11-01T10:00:00Z' },
    ],
  });

  try {
    await act(async () => {
      root.render(
        React.createElement(FamilyModal, {
          familyId: 'fam-1',
          currentUserId: 'admin-1',
          lovedOneName: 'Vovó Dude',
          onClose: () => {},
        })
      );
      await new Promise((r) => setTimeout(r, 80));
    });

    const text = container.textContent || '';
    assert.match(text, /pode acompanhar, registrar refeições, medicamentos, bem-estar e encerrar o dia, mas não pode administrar/i);
    assert.match(text, /configurar a rotina e gerenciar membros e convites/i);
    assert.match(text, /Cuidadores podem acompanhar e registrar os cuidados diários desde a entrada/i);
    assert.equal(text.includes('entra apenas para acompanhar a rotina'), false);

    // Mensagens permanentes de erro em pt-BR são reconhecidas por isRlsPermissionError
    assert.equal(
      isRlsPermissionError(new Error('Sua conta não possui vínculo ativo com esta família para registrar refeições.')),
      true
    );
    assert.equal(
      isRlsPermissionError(new Error('Sua conta não possui permissão ativa nesta família para registrar ou alterar o bem-estar.')),
      true
    );
  } finally {
    await act(async () => root.unmount());
    mock.restore();
    dom.window.close();
  }
});

test('[Estático SQL] Migration 0018 permite INSERT em daily_closures para todos os membros ativos mantendo DELETE restrito a ADMIN', () => {
  const sql0018 = fs.readFileSync(path.resolve('supabase/migrations/0018_member_daily_closure_access.sql'), 'utf8');
  assert.match(sql0018, /CREATE POLICY "Family members can insert daily closures for their family"[\s\S]*ON public\.daily_closures[\s\S]*FOR INSERT/);
  assert.match(sql0018, /public\.user_in_family\(family_id\)/);
  assert.match(sql0018, /closed_by = auth\.uid\(\)/);
  assert.match(sql0018, /CREATE POLICY "Admins can delete daily closures of their family"[\s\S]*FOR DELETE[\s\S]*public\.user_is_family_admin\(family_id\)/);
  assert.equal(/DROP TABLE/i.test(sql0018), false);
  assert.equal(/TRUNCATE/i.test(sql0018), false);
});
