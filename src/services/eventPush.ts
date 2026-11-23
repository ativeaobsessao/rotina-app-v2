import { supabase } from './supabase';

export async function notifyFamilyEventRecorded(input: {
  kind: 'meal' | 'medication';
  logId: string;
}): Promise<void> {
  const cleanLogId = typeof input.logId === 'string' ? input.logId.trim() : '';
  if (!cleanLogId || cleanLogId.startsWith('offline_')) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (typeof (supabase as any)?.functions?.invoke !== 'function') return;

  try {
    await supabase.functions.invoke('dispatch-notifications', {
      body: {
        action: 'event_recorded',
        kind: input.kind,
        logId: cleanLogId,
      },
    });
  } catch (err) {
    console.warn('[WebPush] Falha silenciosa ao notificar familiares:', err);
  }
}
