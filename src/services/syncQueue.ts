import { get, set } from 'idb-keyval';
import { supabase } from './supabase';

const QUEUE_KEY = 'offline_mutation_queue';

export type SyncAction = 
  | 'createMealLog'
  | 'updateMealLog'
  | 'createMedicationLog'
  | 'updateMedicationLog'
  | 'createDailyClosure'
  | 'deleteDailyClosure';

export interface SyncItem {
  id: string; // unique ID for the queue item
  action: SyncAction;
  payload: any;
  timestamp: number;
}

export async function addToSyncQueue(action: SyncAction, payload: any) {
  const currentQueue: SyncItem[] = (await get(QUEUE_KEY)) || [];
  const newItem: SyncItem = {
    id: crypto.randomUUID(),
    action,
    payload,
    timestamp: Date.now(),
  };
  currentQueue.push(newItem);
  await set(QUEUE_KEY, currentQueue);
  return newItem.id;
}

export async function getSyncQueue(): Promise<SyncItem[]> {
  return (await get(QUEUE_KEY)) || [];
}

export async function clearQueueItem(id: string) {
  const currentQueue: SyncItem[] = (await get(QUEUE_KEY)) || [];
  const updatedQueue = currentQueue.filter(item => item.id !== id);
  await set(QUEUE_KEY, updatedQueue);
}

export async function processSyncQueue() {
  if (!navigator.onLine) return; // Prevent processing if offline
  
  const queue = await getSyncQueue();
  if (queue.length === 0) return;

  console.log(`Processing ${queue.length} offline actions...`);
  
  for (const item of queue) {
    try {
      if (item.action === 'createMealLog') {
        await supabase.from('meal_logs').insert(item.payload as any);
      } else if (item.action === 'updateMealLog') {
        const { id, ...data } = item.payload;
        await supabase.from('meal_logs').update(data as any).eq('id', id);
      } else if (item.action === 'createMedicationLog') {
        await supabase.from('medication_logs').insert(item.payload as any);
      } else if (item.action === 'updateMedicationLog') {
        const { id, ...data } = item.payload;
        await supabase.from('medication_logs').update(data as any).eq('id', id);
      } else if (item.action === 'createDailyClosure') {
        await supabase.from('daily_closures').insert(item.payload as any);
      } else if (item.action === 'deleteDailyClosure') {
        await supabase.from('daily_closures').delete().eq('patient_id', item.payload.patient_id).eq('date', item.payload.date);
      }
      
      // If success, remove from queue
      await clearQueueItem(item.id);
    } catch (err) {
      console.error(`Failed to process queue item ${item.id}:`, err);
      // Depending on the error, we might want to stop processing or skip.
      // For now, we will leave it in the queue for the next attempt.
    }
  }
}
