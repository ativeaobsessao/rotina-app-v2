import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';

interface SwPushEvent extends Event {
  data?: {
    json: () => any;
    text: () => string;
  } | null;
  waitUntil: (promise: Promise<any>) => void;
}

interface SwNotificationEvent extends Event {
  action?: string;
  notification: {
    data?: Record<string, any>;
    close: () => void;
  };
  waitUntil: (promise: Promise<any>) => void;
}

interface SwPushSubscriptionChangeEvent extends Event {
  oldSubscription?: PushSubscription | null;
  newSubscription?: PushSubscription | null;
  waitUntil: (promise: Promise<any>) => void;
}

interface SwWindowClient {
  url: string;
  focus: () => Promise<SwWindowClient>;
  navigate?: (url: string) => Promise<SwWindowClient | null>;
  postMessage?: (message: any) => void;
}

interface SwGlobalScope {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
  skipWaiting: () => Promise<void>;
  registration: ServiceWorkerRegistration;
  location: Location;
  clients: {
    matchAll: (options?: { type?: string; includeUncontrolled?: boolean }) => Promise<SwWindowClient[]>;
    openWindow: (url: string) => Promise<SwWindowClient | null>;
  };
  addEventListener: (type: string, listener: (event: any) => void) => void;
}

declare global {
  interface Window {
    __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
  }
}

const swSelf = self as unknown as SwGlobalScope;

swSelf.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();

precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//, /\/[^/?]+\.[^/]+$/],
  })
);

registerRoute(
  ({ url }) => /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/sign\/.*/i.test(url.href),
  new CacheFirst({
    cacheName: 'supabase-images-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 60 * 60 * 24 * 5,
      }),
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
  })
);

async function broadcastToOpenClients(message: Record<string, any>): Promise<void> {
  try {
    const clientsList = await swSelf.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    for (const client of clientsList) {
      if (typeof client.postMessage === 'function') {
        client.postMessage(message);
      }
    }
  } catch {}
}

swSelf.addEventListener('push', (event: SwPushEvent) => {
  let payload: Record<string, any> = {
    title: 'DUCA',
    body: 'Você tem um lembrete de cuidado na rotina.',
    url: '/',
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      if (parsed && typeof parsed === 'object') {
        payload = { ...payload, ...parsed };
      }
    } catch {
      try {
        const text = event.data.text();
        if (text) payload.body = text;
      } catch {}
    }
  }

  const title = String(payload.title || 'DUCA');
  const body = String(payload.body || '');
  const notificationData = {
    url: String(payload.url || '/'),
    type: payload.type || null,
    milestoneDays: payload.milestoneDays ?? null,
    sourceId: payload.sourceId || null,
    receivedAt: Date.now(),
  };

  const options: NotificationOptions & {
    renotify?: boolean;
    vibrate?: number[];
    timestamp?: number;
    actions?: Array<{ action: string; title: string }>;
  } = {
    body,
    icon: '/web-app-manifest-192x192.png',
    badge: '/favicon-96x96.png',
    tag: payload.tag ? String(payload.tag) : undefined,
    renotify: Boolean(payload.tag),
    requireInteraction: Boolean(payload.requireInteraction),
    timestamp: typeof payload.timestamp === 'number' ? payload.timestamp : Date.now(),
    vibrate: [120, 60, 120],
    actions: [{ action: 'open', title: 'Abrir no DUCA' }],
    data: notificationData,
  };

  event.waitUntil(
    Promise.all([
      swSelf.registration.showNotification(title, options),
      broadcastToOpenClients({
        type: 'DUCA_PUSH_RECEIVED',
        payload: {
          title,
          body,
          ...notificationData,
        },
      }),
    ])
  );
});

swSelf.addEventListener('notificationclick', (event: SwNotificationEvent) => {
  event.notification.close();

  const rawUrl = String(event.notification.data?.url || '/');
  let targetUrl = '/';
  try {
    const resolved = new URL(rawUrl, swSelf.location.origin);
    targetUrl =
      resolved.origin === swSelf.location.origin ? resolved.href : swSelf.location.origin + '/';
  } catch {
    targetUrl = swSelf.location.origin + '/';
  }

  event.waitUntil(
    (async () => {
      const clientsList = await swSelf.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of clientsList) {
        if (client.url && client.url.startsWith(swSelf.location.origin)) {
          if (typeof client.navigate === 'function' && client.url !== targetUrl) {
            await client.navigate(targetUrl).catch(() => null);
          }
          if (typeof client.postMessage === 'function') {
            client.postMessage({
              type: 'DUCA_NOTIFICATION_CLICKED',
              data: event.notification.data || {},
            });
          }
          return client.focus();
        }
      }

      return swSelf.clients.openWindow(targetUrl);
    })()
  );
});

swSelf.addEventListener('pushsubscriptionchange', (event: SwPushSubscriptionChangeEvent) => {
  event.waitUntil(
    (async () => {
      let nextSub = event.newSubscription || null;
      if (!nextSub && event.oldSubscription?.options) {
        nextSub = await swSelf.registration.pushManager
          .subscribe(event.oldSubscription.options)
          .catch(() => null);
      }

      if (nextSub) {
        const serialized = typeof nextSub.toJSON === 'function' ? nextSub.toJSON() : null;
        await broadcastToOpenClients({
          type: 'DUCA_PUSH_SUBSCRIPTION_CHANGED',
          subscription: serialized,
        });
      }
    })()
  );
});
