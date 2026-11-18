import { useEffect, useSyncExternalStore, useCallback } from 'react';
import {
  initPWAInstallTracking,
  subscribePWAInstall,
  getPWAInstallSnapshot,
  triggerNativeInstall,
  runPWAInstallCheck,
  markManualInstallCompleted,
  dismissJustInstalledNotice,
  dismissStandaloneWelcome,
  openInstallGuideModal,
  closeInstallGuideModal,
} from '../services/pwaInstallStore';

export function usePWAInstall() {
  useEffect(() => {
    initPWAInstallTracking();
  }, []);

  const snapshot = useSyncExternalStore(
    subscribePWAInstall,
    getPWAInstallSnapshot,
    getPWAInstallSnapshot
  );

  const install = useCallback(async () => {
    const result = await triggerNativeInstall();
    return result.outcome === 'accepted';
  }, []);

  return {
    ...snapshot,
    isIOS: snapshot.env.isIOS,
    isAndroid: snapshot.env.isAndroid,
    isMobile: snapshot.env.isMobile,
    isInAppBrowser: snapshot.env.isInAppBrowser,
    install,
    triggerNativeInstall,
    runCheck: runPWAInstallCheck,
    markManualInstallCompleted,
    dismissJustInstalledNotice,
    dismissStandaloneWelcome,
    openInstallGuideModal,
    closeInstallGuideModal,
  };
}
