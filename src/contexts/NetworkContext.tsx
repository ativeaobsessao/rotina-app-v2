import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  processSyncQueue,
  getSyncQueue,
  subscribeSyncQueueChange,
  retryFailedSyncItems,
  dismissFailedSyncItems,
} from '../services/syncQueue';

interface NetworkContextType {
  isOnline: boolean;
  isSyncing: boolean;
  pendingSyncCount: number;
  failedSyncCount: number;
  lastSyncError: string | null;
  syncVersion: number;
  triggerSync: (includeFailed?: boolean) => Promise<void>;
  dismissFailed: () => Promise<void>;
}

const NetworkContext = createContext<NetworkContextType>({
  isOnline: true,
  isSyncing: false,
  pendingSyncCount: 0,
  failedSyncCount: 0,
  lastSyncError: null,
  syncVersion: 0,
  triggerSync: async () => {},
  dismissFailed: async () => {},
});

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [failedSyncCount, setFailedSyncCount] = useState(0);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [syncVersion, setSyncVersion] = useState(0);
  const mountedRef = useRef(true);

  const refreshCounts = useCallback(async () => {
    try {
      const q = await getSyncQueue();
      if (!mountedRef.current) return q;
      const pending = q.filter((i) => i.status === 'pending').length;
      const failedItems = q.filter((i) => i.status === 'failed');
      setPendingSyncCount(pending);
      setFailedSyncCount(failedItems.length);
      setLastSyncError(failedItems[0]?.lastError || null);
      return q;
    } catch {
      return [];
    }
  }, []);

  const triggerSync = useCallback(
    async (includeFailed = false) => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setIsOnline(false);
        await refreshCounts();
        return;
      }

      if (includeFailed) {
        await retryFailedSyncItems();
      }

      const q = await refreshCounts();
      const hasPending = q.some((i) => i.status === 'pending');
      if (!hasPending) return;

      if (mountedRef.current) setIsSyncing(true);
      try {
        const res = await processSyncQueue({ includeFailed });
        if (!mountedRef.current) return;
        setPendingSyncCount(res.remainingPending);
        setFailedSyncCount(res.remainingFailed);
        if (res.lastError && res.remainingFailed > 0) {
          setLastSyncError(res.lastError);
        } else if (res.remainingFailed === 0) {
          setLastSyncError(null);
        }
        if (res.processed > 0) {
          setSyncVersion((v) => v + 1);
        }
      } finally {
        if (mountedRef.current) setIsSyncing(false);
      }
    },
    [refreshCounts]
  );

  const dismissFailed = useCallback(async () => {
    await dismissFailedSyncItems();
    await refreshCounts();
  }, [refreshCounts]);

  useEffect(() => {
    mountedRef.current = true;
    refreshCounts().then((q) => {
      if (typeof navigator !== 'undefined' && navigator.onLine && q.some((i) => i.status === 'pending')) {
        triggerSync(false);
      }
    });

    const unsubQueue = subscribeSyncQueueChange(() => {
      refreshCounts();
    });

    const handleOnline = () => {
      if (!mountedRef.current) return;
      setIsOnline(true);
      triggerSync(false);
    };

    const handleOffline = () => {
      if (!mountedRef.current) return;
      setIsOnline(false);
      refreshCounts();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const interval = setInterval(async () => {
      const q = await refreshCounts();
      const hasPending = q.some((i) => i.status === 'pending');
      if (typeof navigator !== 'undefined' && navigator.onLine && hasPending) {
        await triggerSync(false);
      }
    }, 8000);

    return () => {
      mountedRef.current = false;
      unsubQueue();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [refreshCounts, triggerSync]);

  return (
    <NetworkContext.Provider
      value={{
        isOnline,
        isSyncing,
        pendingSyncCount,
        failedSyncCount,
        lastSyncError,
        syncVersion,
        triggerSync,
        dismissFailed,
      }}
    >
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  return useContext(NetworkContext);
}
