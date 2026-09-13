import React, { createContext, useContext, useEffect, useState } from 'react';
import { processSyncQueue, getSyncQueue } from '../services/syncQueue';

interface NetworkContextType {
  isOnline: boolean;
  pendingSyncCount: number;
}

const NetworkContext = createContext<NetworkContextType>({
  isOnline: true,
  pendingSyncCount: 0,
});

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);

  useEffect(() => {
    // Check initial queue
    getSyncQueue().then(q => setPendingSyncCount(q.length));

    const handleOnline = async () => {
      setIsOnline(true);
      await processSyncQueue();
      const q = await getSyncQueue();
      setPendingSyncCount(q.length);
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Periodically check queue if online, just in case
    const interval = setInterval(async () => {
      const q = await getSyncQueue();
      setPendingSyncCount(q.length);
      if (navigator.onLine && q.length > 0) {
        await processSyncQueue();
        const q2 = await getSyncQueue();
        setPendingSyncCount(q2.length);
      }
    }, 5000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  return (
    <NetworkContext.Provider value={{ isOnline, pendingSyncCount }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  return useContext(NetworkContext);
}
