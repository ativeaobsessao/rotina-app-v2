import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addToSyncQueue,
  processSyncQueue,
  retryFailedSyncItems,
  dismissFailedSyncItems,
  type SyncItem,
  type SyncQueueAdapter,
} from '../src/services/syncQueue.ts';

function createMemoryHarness(initialOnline = true) {
  let queue: SyncItem[] = [];
  let online = initialOnline;
  let userId: string | null = 'user-1';

  const dbOps: Array<{ table: string; op: string; payload?: any; match?: any }> = [];
  const storageUploads: Array<{ bucket: string; path: string }> = [];
  const storageDeletes: Array<{ bucket: string; paths: string[] }> = [];

  let nextInsertResult: ((table: string, payload: any) => { data: any; error: any }) | null = null;
  let nextUpdateResult: ((table: string, payload: any, id: string) => { data: any; error: any }) | null = null;
  let nextDeleteResult: ((table: string, match: any) => { data: any; error: any }) | null = null;
  let nextSelectResult: ((table: string, match: any) => { data: any; error: any }) | null = null;
  let nextUploadResult: (() => { data: any; error: any }) | null = null;

  const client = {
    from: (table: string) => {
      const filters: Record<string, any> = {};
      const builder: any = {
        insert: (payload: any) => {
          dbOps.push({ table, op: 'insert', payload });
          return {
            select: () => ({
              maybeSingle: async () =>
                nextInsertResult
                  ? nextInsertResult(table, payload)
                  : { data: { id: `srv_${Date.now()}`, ...payload }, error: null },
            }),
          };
        },
        update: (payload: any) => ({
          eq: (col: string, val: any) => {
            filters[col] = val;
            dbOps.push({ table, op: 'update', payload, match: { ...filters } });
            return {
              select: () => ({
                maybeSingle: async () =>
                  nextUpdateResult
                    ? nextUpdateResult(table, payload, val)
                    : { data: { id: val, ...payload }, error: null },
              }),
            };
          },
        }),
        upsert: (payload: any) => {
          dbOps.push({ table, op: 'upsert', payload });
          return {
            select: () => ({
              maybeSingle: async () => ({ data: { id: 'mood-1', ...payload }, error: null }),
            }),
          };
        },
        delete: () => {
          const delBuilder: any = {
            eq: (col: string, val: any) => {
              filters[col] = val;
              return delBuilder;
            },
            select: async () => {
              dbOps.push({ table, op: 'delete', match: { ...filters } });
              return nextDeleteResult
                ? nextDeleteResult(table, { ...filters })
                : { data: [{ id: 'deleted-1' }], error: null };
            },
          };
          return delBuilder;
        },
        select: () => {
          const selBuilder: any = {
            eq: (col: string, val: any) => {
              filters[col] = val;
              return selBuilder;
            },
            maybeSingle: async () =>
              nextSelectResult
                ? nextSelectResult(table, { ...filters })
                : { data: null, error: null },
          };
          return selBuilder;
        },
      };
      return builder;
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          storageUploads.push({ bucket, path });
          if (nextUploadResult) return nextUploadResult();
          return { data: { path }, error: null };
        },
        remove: async (paths: string[]) => {
          storageDeletes.push({ bucket, paths });
          return { data: [], error: null };
        },
      }),
    },
  };

  const adapter: SyncQueueAdapter = {
    getQueue: async () => queue.map((q) => ({ ...q })),
    saveQueue: async (items) => {
      queue = items.map((q) => ({ ...q }));
    },
    getSessionUserId: async () => userId,
    isOnline: () => online,
    client,
  };

  return {
    adapter,
    dbOps,
    storageUploads,
    storageDeletes,
    getQueueSnapshot: () => queue,
    setOnline: (v: boolean) => {
      online = v;
    },
    setUserId: (id: string | null) => {
      userId = id;
    },
    setNextInsert: (fn: typeof nextInsertResult) => {
      nextInsertResult = fn;
    },
    setNextUpdate: (fn: typeof nextUpdateResult) => {
      nextUpdateResult = fn;
    },
    setNextDelete: (fn: typeof nextDeleteResult) => {
      nextDeleteResult = fn;
    },
    setNextSelect: (fn: typeof nextSelectResult) => {
      nextSelectResult = fn;
    },
    setNextUpload: (fn: typeof nextUploadResult) => {
      nextUploadResult = fn;
    },
  };
}

test('Supabase { data: null, error } transient failure preserves item as pending and stops FIFO loop', async () => {
  const h = createMemoryHarness(true);
  await addToSyncQueue(
    'createMealLog',
    { patient_id: 'p1', meal_config_id: 'mc1', event_date: '2026-11-15', consumption_status: 'normal' },
    { patientId: 'p1', eventDate: '2026-11-15', userId: 'user-1', localTempId: 'offline_1' },
    h.adapter
  );
  await addToSyncQueue(
    'createDailyClosure',
    { family_id: 'f1', patient_id: 'p1', date: '2026-11-15', closed_by: 'user-1', status: 'closed' },
    { patientId: 'p1', eventDate: '2026-11-15', userId: 'user-1' },
    h.adapter
  );

  // First item gets network timeout error
  h.setNextInsert(() => ({
    data: null,
    error: { message: 'Failed to fetch (timeout)' },
  }));

  const res = await processSyncQueue({ adapter: h.adapter });
  assert.equal(res.processed, 0);
  assert.equal(res.remainingPending, 2);
  assert.equal(h.dbOps.length, 1); // Broke immediately on first transient error; did NOT skip to createDailyClosure!
  assert.equal(h.getQueueSnapshot()[0].status, 'pending');
  assert.equal(h.getQueueSnapshot()[0].retryCount, 1);
});

test('Permanent error marks item failed, blocks same patient+date scope, and preserves old photo', async () => {
  const h = createMemoryHarness(true);
  const blob = new Blob(['jpeg-bytes'], { type: 'image/jpeg' });

  await addToSyncQueue(
    'createMealLog',
    { patient_id: 'p1', meal_config_id: 'mc1', event_date: '2026-11-15', consumption_status: 'normal' },
    {
      patientId: 'p1',
      eventDate: '2026-11-15',
      userId: 'user-1',
      offlinePhoto: { bucket: 'meal-records', patientId: 'p1', fileName: 'new.jpg', blob },
      oldPhotoPathToDelete: 'p1/old.jpg',
    },
    h.adapter
  );

  // Dependent closure on same day must be blocked if previous fails
  await addToSyncQueue(
    'createDailyClosure',
    { family_id: 'f1', patient_id: 'p1', date: '2026-11-15', closed_by: 'user-1', status: 'closed' },
    { patientId: 'p1', eventDate: '2026-11-15', userId: 'user-1' },
    h.adapter
  );

  // Independent operation on different patient must still succeed
  await addToSyncQueue(
    'upsertDailyMoodLog',
    {
      patient_id: 'p2',
      family_id: 'f1',
      date: '2026-11-15',
      mood: 'happy',
      pain_level: 'none',
      pain_locations: [],
    },
    { patientId: 'p2', eventDate: '2026-11-15', userId: 'user-1' },
    h.adapter
  );

  h.setNextInsert(() => ({
    data: null,
    error: { message: 'Este dia já foi encerrado. Reabra o dia antes de salvar.' },
  }));

  const res = await processSyncQueue({ adapter: h.adapter });
  assert.equal(res.failed, 1);
  assert.equal(res.processed, 1); // p2 mood log processed cleanly
  assert.equal(res.remainingFailed, 1);
  assert.equal(res.remainingPending, 1); // createDailyClosure still blocked & waiting in p1:2026-11-15

  // New orphan photo cleaned up, old.jpg NEVER deleted!
  assert.deepEqual(h.storageDeletes, [{ bucket: 'meal-records', paths: ['p1/new.jpg'] }]);

  // Retry resets failed -> pending
  await retryFailedSyncItems(h.adapter);
  assert.equal(h.getQueueSnapshot().filter((i) => i.status === 'failed').length, 0);

  // Dismiss removes failed cleanly
  await addToSyncQueue(
    'createMealLog',
    { patient_id: 'p1', meal_config_id: 'mc2', event_date: '2026-11-14' },
    { patientId: 'p1', eventDate: '2026-11-14', userId: 'user-1' },
    h.adapter
  );
  await dismissFailedSyncItems(h.adapter);
  assert.equal(h.getQueueSnapshot().filter((i) => i.status === 'failed').length, 0);
});

test('23505 duplicate daily_closure is verified idempotently without overwriting original closed_by', async () => {
  const h = createMemoryHarness(true);
  await addToSyncQueue(
    'createDailyClosure',
    { family_id: 'f1', patient_id: 'p1', date: '2026-11-15', closed_by: 'user-2', status: 'closed' },
    { patientId: 'p1', eventDate: '2026-11-15', userId: 'user-1' },
    h.adapter
  );

  h.setNextInsert(() => ({
    data: null,
    error: { code: '23505', message: 'duplicate key value violates unique constraint' },
  }));
  h.setNextSelect((table) => {
    assert.equal(table, 'daily_closures');
    return { data: { id: 'closure-orig', closed_by: 'user-original' }, error: null };
  });

  const res = await processSyncQueue({ adapter: h.adapter });
  assert.equal(res.processed, 1);
  assert.equal(res.remainingPending, 0);
  // Never called update on daily_closures!
  assert.equal(h.dbOps.some((o) => o.op === 'update'), false);
});

test('Offline createMealLog + offline updateMealLog coalesce and replace old photo only after DB confirms', async () => {
  const h = createMemoryHarness(false);
  const blob = new Blob(['photo'], { type: 'image/jpeg' });
  const tempId = 'offline_meal_mc1_2026-11-15_1';

  await addToSyncQueue(
    'createMealLog',
    {
      patient_id: 'p1',
      meal_config_id: 'mc1',
      event_date: '2026-11-15',
      consumption_status: 'partial',
      description: 'Sopa',
      drink_description: null,
    },
    { patientId: 'p1', eventDate: '2026-11-15', userId: 'user-1', localTempId: tempId },
    h.adapter
  );

  // Caregiver edits the same offline meal adding drink & photo while still offline
  await addToSyncQueue(
    'updateMealLog',
    {
      id: tempId,
      patient_id: 'p1',
      event_date: '2026-11-15',
      consumption_status: 'normal',
      drink_description: '200ml de suco',
    },
    {
      patientId: 'p1',
      eventDate: '2026-11-15',
      userId: 'user-1',
      offlinePhoto: { bucket: 'meal-records', patientId: 'p1', fileName: 'dinner.jpg', blob },
      oldPhotoPathToDelete: 'p1/previous.jpg',
    },
    h.adapter
  );

  // Coalesced into a single createMealLog item!
  assert.equal(h.getQueueSnapshot().length, 1);
  assert.equal(h.getQueueSnapshot()[0].payload.drink_description, '200ml de suco');
  assert.equal(h.getQueueSnapshot()[0].payload.consumption_status, 'normal');

  // Reconnect and sync
  h.setOnline(true);
  const res = await processSyncQueue({ adapter: h.adapter });
  assert.equal(res.processed, 1);
  assert.equal(res.remainingPending, 0);
  assert.deepEqual(h.storageUploads, [{ bucket: 'meal-records', path: 'p1/dinner.jpg' }]);
  assert.deepEqual(h.storageDeletes, [{ bucket: 'meal-records', paths: ['p1/previous.jpg'] }]);
});

test('deleteDailyClosure and unauthenticated guard behave safely', async () => {
  const h = createMemoryHarness(true);
  await addToSyncQueue(
    'deleteDailyClosure',
    { patient_id: 'p1', date: '2026-11-14' },
    { patientId: 'p1', eventDate: '2026-11-14', userId: 'user-1' },
    h.adapter
  );

  // If no active auth session, do NOT sync or fail items
  h.setUserId(null);
  const resNoUser = await processSyncQueue({ adapter: h.adapter });
  assert.equal(resNoUser.processed, 0);
  assert.equal(resNoUser.remainingPending, 1);

  // Once session restored, deleteDailyClosure executes cleanly
  h.setUserId('user-1');
  const resAuth = await processSyncQueue({ adapter: h.adapter });
  assert.equal(resAuth.processed, 1);
  assert.equal(resAuth.remainingPending, 0);
  assert.equal(h.dbOps.some((o) => o.table === 'daily_closures' && o.op === 'delete'), true);
});
