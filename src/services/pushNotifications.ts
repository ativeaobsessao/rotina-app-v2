import { supabase } from './supabase';
import {
  upsertMyPushSubscription,
  deleteMyPushSubscriptionByEndpoint,
  updateMyPushSubscriptionPreferences,
  type PushSubscriptionRow,
} from './api';
import {
  arrayBufferToBase64Url,
  urlBase64ToUint8Array,
  type PushNotificationPreferences,
} from '../utils/notifications';

export interface BrowserPushSupport {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  hasVapidKey: boolean;
}

export function getVapidPublicKey(): string {
  const viteKey = (import.meta as any).env?.VITE_VAPID_PUBLIC_KEY;
  if (typeof viteKey === 'string' && viteKey.trim()) {
    return viteKey.trim();
  }
  const nodeKey =
    typeof process !== 'undefined' && process.env ? process.env.VITE_VAPID_PUBLIC_KEY : '';
  return typeof nodeKey === 'string' ? nodeKey.trim() : '';
}

export function getBrowserPushSupport(): BrowserPushSupport {
  const hasWindow = typeof window !== 'undefined';
  const hasNavigator = typeof navigator !== 'undefined';
  const supported = Boolean(
    hasWindow &&
      hasNavigator &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
  );

  let permission: NotificationPermission | 'unsupported' = 'unsupported';
  if (hasWindow && 'Notification' in window) {
    permission = Notification.permission;
  }

  return {
    supported,
    permission,
    hasVapidKey: Boolean(getVapidPublicKey()),
  };
}

export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
  } catch {
    return 'America/Sao_Paulo';
  }
}

export async function getActiveServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export async function getCurrentBrowserPushSubscription(): Promise<PushSubscription | null> {
  const reg = await getActiveServiceWorkerRegistration();
  if (!reg || !reg.pushManager) return null;
  try {
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

function extractSubscriptionKeys(sub: PushSubscription): { p256dh: string; auth: string } {
  const json = typeof sub.toJSON === 'function' ? sub.toJSON() : null;
  const p256dhFromJson = json?.keys?.p256dh;
  const authFromJson = json?.keys?.auth;

  if (p256dhFromJson && authFromJson) {
    return { p256dh: p256dhFromJson, auth: authFromJson };
  }

  const p256dh = arrayBufferToBase64Url(sub.getKey ? sub.getKey('p256dh') : null);
  const auth = arrayBufferToBase64Url(sub.getKey ? sub.getKey('auth') : null);
  return { p256dh, auth };
}

export async function subscribeBrowserAndSaveToSupabase(input: {
  familyId: string;
  patientId: string | null;
  preferences: PushNotificationPreferences;
}): Promise<PushSubscriptionRow> {
  const support = getBrowserPushSupport();
  if (!support.supported) {
    throw new Error(
      'Este navegador não suporta notificações Web Push. Em dispositivos iOS, adicione o DUCA à Tela de Início primeiro.'
    );
  }

  const vapidPublicKey = getVapidPublicKey();
  if (!vapidPublicKey) {
    throw new Error(
      'Chave pública VAPID (VITE_VAPID_PUBLIC_KEY) não configurada no ambiente do aplicativo.'
    );
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') {
    throw new Error(
      'Permissão de notificações bloqueada neste aparelho. Libere as notificações nas configurações do navegador.'
    );
  }

  const reg = await getActiveServiceWorkerRegistration();
  if (!reg || !reg.pushManager) {
    throw new Error('Serviço em segundo plano (Service Worker) ainda não está ativo neste navegador.');
  }

  let browserSub = await reg.pushManager.getSubscription();
  if (!browserSub) {
    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource;
    browserSub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  }

  const { p256dh, auth } = extractSubscriptionKeys(browserSub);
  if (!browserSub.endpoint || !p256dh || !auth) {
    throw new Error('Não foi possível obter as chaves de segurança da inscrição Web Push.');
  }

  return upsertMyPushSubscription({
    familyId: input.familyId,
    patientId: input.patientId,
    endpoint: browserSub.endpoint,
    keysP256dh: p256dh,
    keysAuth: auth,
    enabled: input.preferences.enabled,
    notifyMedications: input.preferences.notify_medications,
    notifyMeals: input.preferences.notify_meals,
    notifyActivities: input.preferences.notify_activities,
    leadMinutes: input.preferences.lead_minutes,
    timezone: getBrowserTimezone(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
  });
}

export async function savePushPreferencesForSubscription(
  subscriptionId: string,
  patientId: string | null,
  preferences: PushNotificationPreferences
): Promise<PushSubscriptionRow> {
  return updateMyPushSubscriptionPreferences(subscriptionId, {
    patient_id: patientId,
    enabled: preferences.enabled,
    notify_medications: preferences.notify_medications,
    notify_meals: preferences.notify_meals,
    notify_activities: preferences.notify_activities,
    lead_minutes: preferences.lead_minutes,
    timezone: getBrowserTimezone(),
  });
}

export async function unsubscribeBrowserFromWebPush(): Promise<void> {
  const browserSub = await getCurrentBrowserPushSubscription();
  if (!browserSub) return;

  const endpoint = browserSub.endpoint;
  try {
    await browserSub.unsubscribe();
  } catch {}
  await deleteMyPushSubscriptionByEndpoint(endpoint);
}

export interface TestPushResult {
  ok: boolean;
  sent: number;
  failed: number;
  message: string;
}

export async function sendTestPushNotification(endpoint?: string): Promise<TestPushResult> {
  const { data, error } = await supabase.functions.invoke('dispatch-notifications', {
    body: {
      action: 'test',
      ...(endpoint ? { endpoint } : {}),
    },
  });

  if (error) {
    throw new Error(
      error.message ||
        'Não foi possível contatar a função dispatch-notifications no Supabase. Verifique se ela já foi publicada com as chaves VAPID.'
    );
  }

  if (data?.missingVapid) {
    throw new Error(
      'Chaves VAPID ainda não configuradas nos segredos do Supabase Edge Functions.'
    );
  }

  if (data?.error) {
    throw new Error(String(data.error));
  }

  const sent = Number(data?.sent || 0);
  const failed = Number(data?.failed || 0);

  if (sent === 0) {
    throw new Error(
      'Nenhuma inscrição ativa encontrada para este aparelho no servidor. Tente desativar e ativar novamente.'
    );
  }

  return {
    ok: true,
    sent,
    failed,
    message: 'Notificação de teste enviada via Supabase! Confira os avisos do seu aparelho.',
  };
}
