import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addToSyncQueue,
  processSyncQueue,
  type SyncItem,
  type SyncQueueAdapter,
} from '../src/services/syncQueue.ts';

function createEtapa2Harness(initialOnline = true) {
  let queue: SyncItem[] = [];
  let online = initialOnline;
  let userId: string | null = 'caregiver-a';

  const dbOps: Array<{ table: string; op: string; payload?: any; match?: any }> = [];
  const storageUploads: Array<{ bucket: string; path: string }> = [];
  const storageDeletes: Array<{ bucket: string; paths: string[] }> = [];

  let nextInsertResult: ((table: string, payload: any) => { data: any; error: any }) | null = null;
  let nextUpdateResult: ((table: string, payload: any, id: string) => { data: any; error: any }) | null = null;
  let nextDeleteResult: ((table: string, match: any) => { data: any; error: any }) | null = null;
  let nextSelectResult: ((table: string, match: any) => { data: any; error: any }) | null = null;

  const client = {
    from: (table: string) => {
      const filters: Record<string, any> = {};
      return {
        insert: (payload: any) => {
          dbOps.push({ table, op: 'insert', payload });
          return {
            select: () => ({
              maybeSingle: async () =>
                nextInsertResult
                  ? nextInsertResult(table, payload)
                  : { data: { id: `srv_${dbOps.length}`, ...payload }, error: null },
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
              nextSelectResult ? nextSelectResult(table, { ...filters }) : { data: null, error: null },
          };
          return selBuilder;
        },
      };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          storageUploads.push({ bucket, path });
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
    setNextInsert: (fn: typeof nextInsertResult) => {
      nextInsertResult = fn;
    },
    setNextDelete: (fn: typeof nextDeleteResult) => {
      nextDeleteResult = fn;
    },
    setNextSelect: (fn: typeof nextSelectResult) => {
      nextSelectResult = fn;
    },
  };
}

test('23505 on createMealLog succeeds idempotently ONLY when existing record belongs to same creator', async () => {
  const h = createEtapa2Harness(true);
  const blob = new Blob(['photo'], { type: 'image/jpeg' });

  await addToSyncQueue(
    'createMealLog',
    {
      patient_id: 'p1',
      meal_config_id: 'mc1',
      event_date: '2026-11-15',
      consumption_status: 'normal',
      created_by: 'caregiver-a',
    },
    {
      patientId: 'p1',
      eventDate: '2026-11-15',
      userId: 'caregiver-a',
      offlinePhoto: { bucket: 'meal-records', patientId: 'p1', fileName: 'retry.jpg', blob },
    },
    h.adapter
  );

  // Simulate retry of caregiver-a's own timed-out request (already saved on server)
  h.setNextInsert(() => ({
    data: null,
    error: { code: '23505', message: 'duplicate key value violates unique constraint' },
  }));
  h.setNextSelect((table) => {
    assert.equal(table, 'meal_logs');
    return {
      data: {
        id: 'srv-meal-1',
        created_by: 'caregiver-a',
        photo_url: 'p1/earlier.jpg',
      },
      error: null,
    };
  });

  const res = await processSyncQueue({ adapter: h.adapter });
  assert.equal(res.processed, 1);
  assert.equal(res.failed, 0);
  assert.equal(res.remainingPending, 0);
  // Duplicate uploaded retry.jpg is removed while earlier.jpg remains intact
  assert.deepEqual(h.storageDeletes, [{ bucket: 'meal-records', paths: ['p1/retry.jpg'] }]);
});

test('23505 from DIFFERENT caregiver marks conflict as failed instead of silently discarding data', async () => {
  const h = createEtapa2Harness(true);
  const blob = new Blob(['caregiver-a-photo'], { type: 'image/jpeg' });

  await addToSyncQueue(
    'createMealLog',
    {
      patient_id: 'p1',
      meal_config_id: 'mc1',
      event_date: '2026-11-15',
      consumption_status: 'partial',
      description: 'Comeu pouco',
      created_by: 'caregiver-a',
    },
    {
      patientId: 'p1',
      eventDate: '2026-11-15',
      userId: 'caregiver-a',
      offlinePhoto: { bucket: 'meal-records', patientId: 'p1', fileName: 'conflict.jpg', blob },
    },
    h.adapter
  );

  h.setNextInsert(() => ({
    data: null,
    error: { code: '23505', message: 'duplicate key value violates unique constraint' },
  }));
  h.setNextSelect(() => ({
    data: {
      id: 'srv-other',
      created_by: 'caregiver-b',
      photo_url: 'p1/caregiver-b.jpg',
    },
    error: null,
  }));

  const res = await processSyncQueue({ adapter: h.adapter });
  assert.equal(res.processed, 0);
  assert.equal(res.failed, 1);
  assert.equal(res.remainingFailed, 1);
  assert.match(h.getQueueSnapshot()[0].lastError || '', /Outro cuidador/);
  // Rolls back caregiver-a's orphan upload cleanly without touching caregiver-b's photo
  assert.deepEqual(h.storageDeletes, [{ bucket: 'meal-records', paths: ['p1/conflict.jpg'] }]);
});

test('Stale offline updateMealLog refuses to silently overwrite newer edit from another caregiver', async () => {
  const h = createEtapa2Harness(false);
  const blob = new Blob(['stale-edit-photo'], { type: 'image/jpeg' });

  await addToSyncQueue(
    'updateMealLog',
    {
      id: 'meal-row-1',
      patient_id: 'p1',
      event_date: '2026-11-15',
      consumption_status: 'normal',
      updated_by: 'caregiver-a',
    },
    {
      patientId: 'p1',
      eventDate: '2026-11-15',
      userId: 'caregiver-a',
      expectedUpdatedAt: '2026-11-15T12:00:00.000Z',
      offlinePhoto: { bucket: 'meal-records', patientId: 'p1', fileName: 'stale.jpg', blob },
      oldPhotoPathToDelete: 'p1/original.jpg',
    },
    h.adapter
  );

  // Meanwhile caregiver-b edited the row at 12:10 online
  h.setOnline(true);
  h.setNextSelect((table) => {
    assert.equal(table, 'meal_logs');
    return {
      data: {
        id: 'meal-row-1',
        updated_at: '2026-11-15T12:10:00.000Z',
        updated_by: 'caregiver-b',
      },
      error: null,
    };
  });

  const res = await processSyncQueue({ adapter: h.adapter });
  assert.equal(res.processed, 0);
  assert.equal(res.failed, 1);
  assert.match(h.getQueueSnapshot()[0].lastError || '', /Outro cuidador atualizou/);
  assert.equal(h.dbOps.some((o) => o.op === 'update'), false);
  // Stale upload rolled back; original.jpg preserved
  assert.deepEqual(h.storageDeletes, [{ bucket: 'meal-records', paths: ['p1/stale.jpg'] }]);
});

test('Mid-sync photo interruption checkpoints upload and coalesced offline replacement resets checkpoint cleanly', async () => {
  const h = createEtapa2Harness(true);
  const photoA = new Blob(['photo-a'], { type: 'image/jpeg' });
  const photoB = new Blob(['photo-b'], { type: 'image/jpeg' });
  const tempId = 'offline_meal_mc1_2026-11-15_99';

  await addToSyncQueue(
    'createMealLog',
    {
      patient_id: 'p1',
      meal_config_id: 'mc1',
      event_date: '2026-11-15',
      consumption_status: 'normal',
      created_by: 'caregiver-a',
    },
    {
      patientId: 'p1',
      eventDate: '2026-11-15',
      userId: 'caregiver-a',
      localTempId: tempId,
      offlinePhoto: { bucket: 'meal-records', patientId: 'p1', fileName: 'photoA.jpg', blob: photoA },
    },
    h.adapter
  );

  // Storage upload succeeds, then DB insert hits transient network drop
  h.setNextInsert(() => ({ data: null, error: { message: 'Failed to fetch' } }));
  const firstRun = await processSyncQueue({ adapter: h.adapter });
  assert.equal(firstRun.processed, 0);
  assert.equal(firstRun.remainingPending, 1);
  assert.equal(h.storageUploads.length, 1);
  assert.equal(h.getQueueSnapshot()[0]._uploadedPhotoPath, 'p1/photoA.jpg');

  // Retrying DB without modifying photo does NOT re-upload photoA.jpg!
  h.setNextInsert(() => ({ data: null, error: { message: 'Network timeout' } }));
  await processSyncQueue({ adapter: h.adapter });
  assert.equal(h.storageUploads.length, 1);

  // Now caregiver swaps photo offline to photoB.jpg before final sync
  await addToSyncQueue(
    'updateMealLog',
    { id: tempId, patient_id: 'p1', event_date: '2026-11-15', description: 'Com foto B' },
    {
      patientId: 'p1',
      eventDate: '2026-11-15',
      userId: 'caregiver-a',
      offlinePhoto: { bucket: 'meal-records', patientId: 'p1', fileName: 'photoB.jpg', blob: photoB },
    },
    h.adapter
  );

  // Checkpoint was cleared and photoA scheduled for deletion post-DB!
  assert.equal(h.getQueueSnapshot()[0]._uploadedPhotoPath, null);
  assert.equal(h.getQueueSnapshot()[0].oldPhotoPathToDelete, 'p1/photoA.jpg');

  // Final reconnect succeeds: uploads photoB, confirms DB, then removes photoA
  h.setNextInsert(null);
  const finalRun = await processSyncQueue({ adapter: h.adapter });
  assert.equal(finalRun.processed, 1);
  assert.equal(h.storageUploads.length, 2);
  assert.deepEqual(h.storageDeletes, [{ bucket: 'meal-records', paths: ['p1/photoA.jpg'] }]);
});

test('Offline reopen + edit preserves FIFO order and catches silent RLS deleteDailyClosure failure', async () => {
  const h = createEtapa2Harness(true);

  await addToSyncQueue(
    'deleteDailyClosure',
    { patient_id: 'p1', date: '2026-11-14' },
    { patientId: 'p1', eventDate: '2026-11-14', userId: 'caregiver-a' },
    h.adapter
  );
  await addToSyncQueue(
    'updateMealLog',
    { id: 'meal-1', patient_id: 'p1', event_date: '2026-11-14', notes: 'Editado após reabrir' },
    { patientId: 'p1', eventDate: '2026-11-14', userId: 'caregiver-a' },
    h.adapter
  );

  // Simulate silent RLS block: delete returns 0 error, but closure still exists on select
  h.setNextDelete(() => ({ data: [], error: null }));
  h.setNextSelect((table) =>
    table === 'daily_closures' ? { data: { id: 'still-there' }, error: null } : { data: null, error: null }
  );

  const blockedRes = await processSyncQueue({ adapter: h.adapter });
  assert.equal(blockedRes.failed, 1);
  assert.equal(blockedRes.processed, 0);
  // Dependent updateMealLog in same p1:2026-11-14 scope MUST NOT execute!
  assert.equal(h.dbOps.some((o) => o.op === 'update'), false);
});

test('localStorage fallback cross-tab lock prevents concurrent sync and recovers abandoned expired locks', async () => {
  const h = createEtapa2Harness(true);
  const prevLocalStorage = (globalThis as any).localStorage;
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  };

  try {
    await addToSyncQueue(
      'createDailyClosure',
      { family_id: 'f1', patient_id: 'p1', date: '2026-11-15', closed_by: 'caregiver-a', status: 'closed' },
      { patientId: 'p1', eventDate: '2026-11-15', userId: 'caregiver-a' },
      h.adapter
    );

    // 1. Active lock from another tab -> skips cleanly
    store.set('duca_sync_tab_lock', JSON.stringify({ token: 'other-tab', expiresAt: Date.now() + 10_000 }));
    const skipped = await processSyncQueue({ adapter: h.adapter });
    assert.equal(skipped.skippedDueToLock, true);
    assert.equal(skipped.processed, 0);

    // 2. Abandoned/expired lock -> recovers cleanly and executes sync
    store.set('duca_sync_tab_lock', JSON.stringify({ token: 'crashed-tab', expiresAt: Date.now() - 5_000 }));
    const recovered = await processSyncQueue({ adapter: h.adapter });
    assert.equal(recovered.skippedDueToLock, undefined);
    assert.equal(recovered.processed, 1);
    assert.equal(store.has('duca_sync_tab_lock'), false);
  } finally {
    (globalThis as any).localStorage = prevLocalStorage;
  }
});
