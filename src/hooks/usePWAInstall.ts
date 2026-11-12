import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // ─── Verificação Exaustiva e Rigorosa de Standalone (Instalado) ───
    // Cobre todos os sistemas operacionais e navegadores:
    // 1. Padrão W3C (Chrome, Edge, Android, Desktop PWA): display-mode: standalone
    const matchStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const matchFullscreen = window.matchMedia('(display-mode: fullscreen)').matches;
    const matchMinimalUi = window.matchMedia('(display-mode: minimal-ui)').matches;

    // 2. iOS Safari (iPhone / iPad): window.navigator.standalone === true
    const isIOSStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    // 3. Android TWA / WebAPK / referrer
    const isAndroidApp = document.referrer.includes('android-app://');

    // 4. Marca persistida após confirmação de evento appinstalled
    const storedInstalled = localStorage.getItem('duca_app_installed') === 'true';

    const runningAsInstalled = matchStandalone || matchFullscreen || matchMinimalUi || isIOSStandalone || isAndroidApp || storedInstalled;

    setIsInstalled(runningAsInstalled);

    // Detecção de Sistema Operacional
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent) && !(window as any).MSStream;
    const isMobileDevice = /iphone|ipad|ipod|android|mobile/.test(userAgent);

    setIsIOS(isIOSDevice);
    setIsMobile(isMobileDevice);

    // Evento disparado pelo Chromium (Desktop, Android) quando o app está pronto para ser instalado
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    // Evento disparado imediatamente após o app ser instalado no dispositivo
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      localStorage.setItem('duca_app_installed', 'true');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      localStorage.setItem('duca_app_installed', 'true');
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    isMobile,
    install,
  };
}
