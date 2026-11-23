import { supabase } from './supabase';
import {
  getMyPushSubscriptions,
  upsertMyPushSubscription,
  deleteMyPushSubscriptionByEndpoint,
  updateMyPushSubscriptionPreferences,
  type PushSubscriptionRow,
} from './api';
import {
  arrayBufferToBase64Url,
  DEFAULT_PUSH_PREFERENCES,
  urlBase64ToUint8Array,
  type NotificationLeadMinutes,
  type PushNotificationPreferences,
} from '../utils/notifications';

export const LIVE_PUSH_RECEIVED_EVENT = 'duca:push-received';
export const PUSH_SUBSCRIPTION_CHANGED_EVENT = 'duca:push-subscription-changed';

export interface LivePushPayload {
  title: string;
  body: string;
  url?: string;
  type?: string | null;
  milestoneDays?: number | null;
  sourceId?: string | null;
  receivedAt?: number;
}

export interface BrowserPushSupport {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  hasVapidKey: boolean;
}

export type PushServerConfigStatus =
  | 'ready'
  | 'missing_server_vapid'
  | 'function_unavailable';

export interface ResolvedPushServerConfig {
  status: PushServerConfigStatus;
  vapidPublicKey: string;
  errorMessage?: string;
}

let cachedServerVapidKey = '';
let swRuntimeInitialized = false;

export function resetPushConfigCacheForTests(): void {
  cachedServerVapidKey = '';
  swRuntimeInitialized = false;
}

function cleanKeyValue(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^["']|["']$/g, '').trim();
}

export function getVapidPublicKey(): string {
  const viteKey = cleanKeyValue((import.meta as any).env?.VITE_VAPID_PUBLIC_KEY);
  if (viteKey) {
    return viteKey;
  }
  const nodeKey =
    typeof process !== 'undefined' && process.env
      ? cleanKeyValue(process.env.VITE_VAPID_PUBLIC_KEY)
      : '';
  if (nodeKey) {
    return nodeKey;
  }
  return cachedServerVapidKey;
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

export function initWebPushRuntime(): void {
  if (swRuntimeInitialized || typeof window === 'undefined' || typeof navigator === 'undefined') {
    return;
  }
  if (!('serviceWorker' in navigator)) return;
  swRuntimeInitialized = true;

  const onSwMessage = (event: MessageEvent) => {
    const data = event?.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'DUCA_PUSH_RECEIVED' && data.payload) {
      window.dispatchEvent(
        new CustomEvent<LivePushPayload>(LIVE_PUSH_RECEIVED_EVENT, {
          detail: data.payload,
        })
      );
    } else if (data.type === 'DUCA_PUSH_SUBSCRIPTION_CHANGED') {
      window.dispatchEvent(
        new CustomEvent(PUSH_SUBSCRIPTION_CHANGED_EVENT, {
          detail: data.subscription || null,
        })
      );
    }
  };

  navigator.serviceWorker.addEventListener?.('message', onSwMessage);

  // Garante que o Service Worker esteja registrado em produção mesmo antes de o usuário abrir o modal
  if (typeof navigator.serviceWorker.getRegistration === 'function') {
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        if (!reg && typeof navigator.serviceWorker.register === 'function') {
          return navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => null);
        }
        return reg;
      })
      .catch(() => null);
  }
}

async function parseInvokeErrorPayload(error: any): Promise<any> {
  if (!error) return null;
  try {
    const ctx = error.context;
    if (ctx && typeof ctx.json === 'function') {
      return await ctx.clone().json();
    }
  } catch {}
  return null;
}

export async function resolvePushServerConfig(): Promise<ResolvedPushServerConfig> {
  const localKey = getVapidPublicKey();
  if (localKey) {
    return { status: 'ready', vapidPublicKey: localKey };
  }

  try {
    const { data, error } = await supabase.functions.invoke('dispatch-notifications', {
      body: { action: 'public_config' },
    });

    if (error) {
      const payload = await parseInvokeErrorPayload(error);
      if (payload?.missingVapid) {
        return {
          status: 'missing_server_vapid',
          vapidPublicKey: '',
          errorMessage:
            'As chaves de notificação (VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY) ainda não foram configuradas nos segredos do Supabase.',
        };
      }
      return {
        status: 'function_unavailable',
        vapidPublicKey: '',
        errorMessage: payload?.error || error.message || 'Serviço de notificações indisponível.',
      };
    }

    const remoteKey = cleanKeyValue(data?.vapidPublicKey);
    if (remoteKey && data?.configured !== false) {
      cachedServerVapidKey = remoteKey;
      return { status: 'ready', vapidPublicKey: remoteKey };
    }

    if (data?.configured === false || data?.missingVapid) {
      return {
        status: 'missing_server_vapid',
        vapidPublicKey: '',
        errorMessage:
          'As chaves de notificação (VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY) ainda não foram configuradas nos segredos do Supabase.',
      };
    }

    return {
      status: 'function_unavailable',
      vapidPublicKey: '',
      errorMessage: 'Não foi possível validar a configuração de notificações no servidor.',
    };
  } catch (err: any) {
    return {
      status: 'function_unavailable',
      vapidPublicKey: '',
      errorMessage: err?.message || 'Não foi possível contatar o serviço de notificações.',
    };
  }
}

export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
  } catch {
    return 'America/Sao_Paulo';
  }
}

export async function getActiveServiceWorkerRegistration(
  options: { attemptRegister?: boolean } = {}
): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;

    if (options.attemptRegister && typeof navigator.serviceWorker.register === 'function') {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        if (reg) return reg;
      } catch {}
    }

    const readyWithTimeout = await Promise.race<ServiceWorkerRegistration | null>([
      navigator.serviceWorker.ready.catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
    return readyWithTimeout;
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

  let vapidPublicKey = getVapidPublicKey();
  if (!vapidPublicKey) {
    const serverConfig = await resolvePushServerConfig();
    vapidPublicKey = serverConfig.vapidPublicKey;
    if (!vapidPublicKey) {
      throw new Error(
        serverConfig.status === 'missing_server_vapid'
          ? 'As chaves de notificação (VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY) ainda precisam ser salvas nos segredos do Supabase.'
          : serverConfig.errorMessage ||
              'Não foi possível preparar o serviço de notificações no servidor. Verifique se a função dispatch-notifications está publicada no Supabase.'
      );
    }
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

  const reg = await getActiveServiceWorkerRegistration({ attemptRegister: true });
  if (!reg || !reg.pushManager) {
    throw new Error('Serviço em segundo plano (Service Worker) ainda não está ativo neste navegador.');
  }

  let browserSub = await reg.pushManager.getSubscription();
  if (!browserSub) {
    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource;
    try {
      browserSub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    } catch (subErr: any) {
      if (subErr?.name === 'InvalidStateError') {
        const stale = await reg.pushManager.getSubscription().catch(() => null);
        if (stale) {
          await stale.unsubscribe().catch(() => false);
        }
        browserSub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
      } else {
        throw subErr;
      }
    }
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

export async function syncBrowserPushSubscriptionWithSupabase(input: {
  familyId: string;
  patientId: string | null;
}): Promise<PushSubscriptionRow | null> {
  if (!input.familyId) return null;
  const support = getBrowserPushSupport();
  if (!support.supported || support.permission !== 'granted') return null;

  const browserSub = await getCurrentBrowserPushSubscription();
  if (!browserSub) return null;

  const { p256dh, auth } = extractSubscriptionKeys(browserSub);
  if (!browserSub.endpoint || !p256dh || !auth) return null;

  try {
    const serverSubs = await getMyPushSubscriptions(input.familyId);
    const matching = serverSubs.find((s) => s.endpoint === browserSub.endpoint);

    const needsSync =
      !matching ||
      matching.keys_p256dh !== p256dh ||
      matching.keys_auth !== auth ||
      (input.patientId && matching.patient_id !== input.patientId);

    if (!needsSync) {
      return matching;
    }

    const basePrefs: PushNotificationPreferences = matching
      ? {
          enabled: matching.enabled,
          notify_medications: matching.notify_medications,
          notify_meals: matching.notify_meals,
          notify_activities: matching.notify_activities,
          lead_minutes: ([0, 5, 10, 15, 30].includes(matching.lead_minutes)
            ? matching.lead_minutes
            : 0) as NotificationLeadMinutes,
        }
      : serverSubs[0]
      ? {
          enabled: serverSubs[0].enabled,
          notify_medications: serverSubs[0].notify_medications,
          notify_meals: serverSubs[0].notify_meals,
          notify_activities: serverSubs[0].notify_activities,
          lead_minutes: ([0, 5, 10, 15, 30].includes(serverSubs[0].lead_minutes)
            ? serverSubs[0].lead_minutes
            : 0) as NotificationLeadMinutes,
        }
      : DEFAULT_PUSH_PREFERENCES;

    return await upsertMyPushSubscription({
      familyId: input.familyId,
      patientId: input.patientId,
      endpoint: browserSub.endpoint,
      keysP256dh: p256dh,
      keysAuth: auth,
      enabled: basePrefs.enabled,
      notifyMedications: basePrefs.notify_medications,
      notifyMeals: basePrefs.notify_meals,
      notifyActivities: basePrefs.notify_activities,
      leadMinutes: basePrefs.lead_minutes,
      timezone: getBrowserTimezone(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    });
  } catch {
    return null;
  }
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
    const payload = await parseInvokeErrorPayload(error);
    if (payload?.missingVapid) {
      throw new Error(
        'Chaves VAPID ainda não configuradas nos segredos do Supabase Edge Functions.'
      );
    }
    throw new Error(
      payload?.error ||
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

export { notifyFamilyEventRecorded } from './eventPush';
