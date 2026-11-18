export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type InstallOS = 'ios' | 'android' | 'desktop';
export type InstallBrowser =
  | 'safari'
  | 'chrome'
  | 'edge'
  | 'samsung'
  | 'firefox'
  | 'ios_chrome'
  | 'ios_edge'
  | 'ios_firefox'
  | 'in_app_webview'
  | 'other';

export type InAppSource = 'whatsapp' | 'instagram' | 'facebook' | 'webview' | null;

export type RecommendedInstallFlow =
  | 'already_in_app'
  | 'just_installed'
  | 'native_prompt'
  | 'in_app_browser'
  | 'ios_safari'
  | 'ios_other_browser'
  | 'android_manual'
  | 'desktop_manual';

export type ServiceWorkerCheckState =
  | 'active'
  | 'installing'
  | 'registered'
  | 'missing'
  | 'unsupported';

export interface InstallEnvironment {
  os: InstallOS;
  browser: InstallBrowser;
  inAppSource: InAppSource;
  isIOS: boolean;
  isAndroid: boolean;
  isMobile: boolean;
  isInAppBrowser: boolean;
  isStandalone: boolean;
}

export interface InstallCheckReport {
  isSecureContext: boolean;
  hasManifestLink: boolean;
  serviceWorkerState: ServiceWorkerCheckState;
  isInAppBrowser: boolean;
  hasNativePrompt: boolean;
  isRunningStandalone: boolean;
  isInstalledOnDevice: boolean;
  relatedAppsCount: number;
  canTriggerNativePrompt: boolean;
  recommendedFlow: RecommendedInstallFlow;
  failureReason: string | null;
  checkedAt: number;
}

export type InstallActionStatus =
  | 'idle'
  | 'prompting'
  | 'installing'
  | 'installed'
  | 'dismissed'
  | 'error';

export interface PWAInstallSnapshot {
  env: InstallEnvironment;
  checks: InstallCheckReport;
  isInstallable: boolean;
  isInstalled: boolean;
  isRunningStandalone: boolean;
  justInstalled: boolean;
  installStatus: InstallActionStatus;
  installMessage: string | null;
  isModalOpen: boolean;
  standaloneWelcomePending: boolean;
}

const INSTALLED_STORAGE_KEY = 'duca_app_installed';
const JUST_INSTALLED_AT_KEY = 'duca_just_installed_at';
const STANDALONE_WELCOMED_KEY = 'duca_standalone_welcomed';
const JUST_INSTALLED_TTL_MS = 1000 * 60 * 60 * 12; // 12 horas

let initialized = false;
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let listeners = new Set<() => void>();
let cleanupFns: Array<() => void> = [];

function safeGetStorage(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSetStorage(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
    }
  } catch {}
}

function safeRemoveStorage(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  } catch {}
}

export function detectStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const matchStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches ?? false;
    const matchFullscreen = window.matchMedia?.('(display-mode: fullscreen)')?.matches ?? false;
    const matchMinimalUi = window.matchMedia?.('(display-mode: minimal-ui)')?.matches ?? false;
    const isIOSStandalone =
      (window.navigator as unknown as { standalone?: boolean })?.standalone === true;
    const isAndroidApp =
      typeof document !== 'undefined' && document.referrer.includes('android-app://');

    return Boolean(
      matchStandalone || matchFullscreen || matchMinimalUi || isIOSStandalone || isAndroidApp
    );
  } catch {
    return false;
  }
}

export function detectInstallEnvironment(customUserAgent?: string): InstallEnvironment {
  const isStandalone = detectStandaloneMode();
  if (typeof window === 'undefined' && !customUserAgent) {
    return {
      os: 'desktop',
      browser: 'other',
      inAppSource: null,
      isIOS: false,
      isAndroid: false,
      isMobile: false,
      isInAppBrowser: false,
      isStandalone: false,
    };
  }

  const uaRaw = customUserAgent ?? window.navigator.userAgent ?? '';
  const ua = uaRaw.toLowerCase();
  const maxTouchPoints =
    typeof navigator !== 'undefined' ? Number(navigator.maxTouchPoints || 0) : 0;

  const isIPadOSDesktopUA = /macintosh/.test(ua) && maxTouchPoints > 1;
  const isIOS = (/iphone|ipad|ipod/.test(ua) || isIPadOSDesktopUA) && !(window as any)?.MSStream;
  const isAndroid = /android/.test(ua);
  const os: InstallOS = isIOS ? 'ios' : isAndroid ? 'android' : 'desktop';
  const isMobile = isIOS || isAndroid || /mobile/.test(ua);

  // Detecção precisa de navegadores internos (WhatsApp, Instagram, Facebook, WebView Android)
  // onde o sistema operacional impede a instalação direta de PWAs.
  let inAppSource: InAppSource = null;
  if (/whatsapp/.test(ua)) {
    inAppSource = 'whatsapp';
  } else if (/instagram/.test(ua)) {
    inAppSource = 'instagram';
  } else if (/fban|fbav|fb_iab|messenger/.test(ua)) {
    inAppSource = 'facebook';
  } else if (isAndroid && /; wv\)|\bwv\b/.test(ua)) {
    inAppSource = 'webview';
  } else if (isIOS && !/safari/.test(ua) && !/crios|fxios|edgios|opios/.test(ua)) {
    inAppSource = 'webview';
  }

  const isInAppBrowser = inAppSource !== null;

  let browser: InstallBrowser = 'other';
  if (isInAppBrowser) {
    browser = 'in_app_webview';
  } else if (isIOS) {
    if (/crios/.test(ua)) browser = 'ios_chrome';
    else if (/edgios/.test(ua)) browser = 'ios_edge';
    else if (/fxios/.test(ua)) browser = 'ios_firefox';
    else if (/safari/.test(ua)) browser = 'safari';
  } else {
    if (/samsungbrowser/.test(ua)) browser = 'samsung';
    else if (/edg|edga/.test(ua)) browser = 'edge';
    else if (/firefox|fxios/.test(ua)) browser = 'firefox';
    else if (/chrome|crios/.test(ua)) browser = 'chrome';
    else if (/safari/.test(ua)) browser = 'safari';
  }

  return {
    os,
    browser,
    inAppSource,
    isIOS,
    isAndroid,
    isMobile,
    isInAppBrowser,
    isStandalone,
  };
}

function readRecentJustInstalled(): boolean {
  const ts = Number(safeGetStorage(JUST_INSTALLED_AT_KEY) || '0');
  if (!ts) return false;
  if (Date.now() - ts <= JUST_INSTALLED_TTL_MS) {
    return true;
  }
  safeRemoveStorage(JUST_INSTALLED_AT_KEY);
  return false;
}

function computeRecommendedFlow(params: {
  env: InstallEnvironment;
  justInstalled: boolean;
  isInstalledOnDevice: boolean;
  hasNativePrompt: boolean;
}): RecommendedInstallFlow {
  const { env, justInstalled, isInstalledOnDevice, hasNativePrompt } = params;
  if (env.isStandalone) return 'already_in_app';
  if (justInstalled || isInstalledOnDevice) return 'just_installed';
  if (env.isInAppBrowser) return 'in_app_browser';
  if (hasNativePrompt) return 'native_prompt';
  if (env.os === 'ios') {
    return env.browser === 'safari' ? 'ios_safari' : 'ios_other_browser';
  }
  if (env.os === 'android') return 'android_manual';
  return 'desktop_manual';
}

function computeFailureReason(params: {
  env: InstallEnvironment;
  isSecureContext: boolean;
  hasManifestLink: boolean;
  serviceWorkerState: ServiceWorkerCheckState;
  hasNativePrompt: boolean;
  isInstalledOnDevice: boolean;
}): string | null {
  const {
    env,
    isSecureContext,
    hasManifestLink,
    serviceWorkerState,
    hasNativePrompt,
    isInstalledOnDevice,
  } = params;

  if (env.isStandalone || isInstalledOnDevice) return null;
  if (!isSecureContext) {
    return 'O endereço atual não está em HTTPS seguro, o que bloqueia o download do aplicativo pelo navegador.';
  }
  if (env.isInAppBrowser) {
    const label =
      env.inAppSource === 'whatsapp'
        ? 'WhatsApp'
        : env.inAppSource === 'instagram'
          ? 'Instagram'
          : env.inAppSource === 'facebook'
            ? 'Facebook'
            : 'aplicativo interno';
    return `Você abriu este link dentro do navegador interno do ${label}. Por restrição do aparelho, é preciso abrir no Chrome ou Safari para instalar.`;
  }
  if (env.os === 'ios') {
    return env.browser === 'safari'
      ? 'No iPhone e iPad, a Apple não permite download por botão único: é necessário usar Compartilhar → Adicionar à Tela de Início.'
      : 'No iPhone/iPad, abra este link no Safari (ou toque no botão Compartilhar) e escolha Adicionar à Tela de Início.';
  }
  if (!hasManifestLink) {
    return 'O manifesto do aplicativo ainda não foi carregado nesta página.';
  }
  if (serviceWorkerState === 'missing' || serviceWorkerState === 'unsupported') {
    return 'O componente de aplicativo offline (Service Worker) ainda está sendo ativado neste navegador.';
  }
  if (!hasNativePrompt) {
    return 'O navegador ainda não liberou o botão automático (geralmente ocorre quando o aviso já foi fechado antes ou no Firefox/Samsung). Use a instalação pelo menu do navegador abaixo.';
  }
  return null;
}

function buildInitialSnapshot(): PWAInstallSnapshot {
  const env = detectInstallEnvironment();
  const storedInstalled = safeGetStorage(INSTALLED_STORAGE_KEY) === 'true';
  const justInstalled = !env.isStandalone && readRecentJustInstalled();
  const hasPrompt = Boolean(deferredPrompt);
  const isInstalledOnDevice = !hasPrompt && (env.isStandalone || storedInstalled || justInstalled);
  const standaloneWelcomePending =
    env.isStandalone && safeGetStorage(STANDALONE_WELCOMED_KEY) !== 'true';

  const isSecureContext =
    typeof window !== 'undefined'
      ? Boolean(window.isSecureContext || window.location?.hostname === 'localhost')
      : true;
  const hasManifestLink =
    typeof document !== 'undefined' ? Boolean(document.querySelector('link[rel="manifest"]')) : true;

  const serviceWorkerState: ServiceWorkerCheckState =
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? 'registered' : 'unsupported';

  const recommendedFlow = computeRecommendedFlow({
    env,
    justInstalled,
    isInstalledOnDevice,
    hasNativePrompt: hasPrompt,
  });

  return {
    env,
    checks: {
      isSecureContext,
      hasManifestLink,
      serviceWorkerState,
      isInAppBrowser: env.isInAppBrowser,
      hasNativePrompt: hasPrompt,
      isRunningStandalone: env.isStandalone,
      isInstalledOnDevice,
      relatedAppsCount: 0,
      canTriggerNativePrompt: hasPrompt,
      recommendedFlow,
      failureReason: computeFailureReason({
        env,
        isSecureContext,
        hasManifestLink,
        serviceWorkerState,
        hasNativePrompt: hasPrompt,
        isInstalledOnDevice,
      }),
      checkedAt: Date.now(),
    },
    isInstallable: hasPrompt,
    isInstalled: env.isStandalone || isInstalledOnDevice,
    isRunningStandalone: env.isStandalone,
    justInstalled,
    installStatus: env.isStandalone || justInstalled ? 'installed' : 'idle',
    installMessage: null,
    isModalOpen: false,
    standaloneWelcomePending,
  };
}

let snapshot: PWAInstallSnapshot = buildInitialSnapshot();

function emit() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
}

function setSnapshot(updater: (prev: PWAInstallSnapshot) => PWAInstallSnapshot) {
  snapshot = updater(snapshot);
  emit();
}

function applyCapturedPrompt(promptEvent: BeforeInstallPromptEvent) {
  deferredPrompt = promptEvent;
  // Se o navegador disparou beforeinstallprompt, o app NÃO está instalado no perfil atual.
  safeRemoveStorage(INSTALLED_STORAGE_KEY);
  safeRemoveStorage(JUST_INSTALLED_AT_KEY);

  setSnapshot((prev) => {
    const env = detectInstallEnvironment();
    const checks: InstallCheckReport = {
      ...prev.checks,
      hasNativePrompt: true,
      canTriggerNativePrompt: true,
      isInstalledOnDevice: env.isStandalone,
      recommendedFlow: computeRecommendedFlow({
        env,
        justInstalled: false,
        isInstalledOnDevice: env.isStandalone,
        hasNativePrompt: true,
      }),
      failureReason: null,
      checkedAt: Date.now(),
    };

    return {
      ...prev,
      env,
      checks,
      isInstallable: true,
      isInstalled: env.isStandalone,
      justInstalled: false,
      installStatus: env.isStandalone ? 'installed' : 'idle',
      installMessage: null,
    };
  });
}

function applyAppInstalledState(sourceMessage?: string) {
  deferredPrompt = null;
  if (typeof window !== 'undefined') {
    (window as any).__ducaInstallPrompt = null;
    (window as any).__ducaAppInstalled = true;
  }
  safeSetStorage(INSTALLED_STORAGE_KEY, 'true');
  safeSetStorage(JUST_INSTALLED_AT_KEY, String(Date.now()));

  setSnapshot((prev) => {
    const env = detectInstallEnvironment();
    const justInstalled = !env.isStandalone;
    const checks: InstallCheckReport = {
      ...prev.checks,
      hasNativePrompt: false,
      canTriggerNativePrompt: false,
      isInstalledOnDevice: true,
      recommendedFlow: env.isStandalone ? 'already_in_app' : 'just_installed',
      failureReason: null,
      checkedAt: Date.now(),
    };

    return {
      ...prev,
      env,
      checks,
      isInstallable: false,
      isInstalled: true,
      isRunningStandalone: env.isStandalone,
      justInstalled,
      isModalOpen: false,
      installStatus: 'installed',
      installMessage:
        sourceMessage ||
        'Aplicativo DUCA baixado e instalado! Você já pode acessar direto pelo ícone na tela inicial.',
    };
  });
}

export async function runPWAInstallCheck(): Promise<InstallCheckReport> {
  if (typeof window !== 'undefined') {
    const earlyPrompt = (window as any).__ducaInstallPrompt as BeforeInstallPromptEvent | null;
    if (earlyPrompt && !deferredPrompt) {
      deferredPrompt = earlyPrompt;
      safeRemoveStorage(INSTALLED_STORAGE_KEY);
      safeRemoveStorage(JUST_INSTALLED_AT_KEY);
    }
    if ((window as any).__ducaAppInstalled && safeGetStorage(INSTALLED_STORAGE_KEY) !== 'true') {
      safeSetStorage(INSTALLED_STORAGE_KEY, 'true');
      safeSetStorage(JUST_INSTALLED_AT_KEY, String(Date.now()));
    }
  }

  const env = detectInstallEnvironment();
  const isSecureContext =
    typeof window !== 'undefined'
      ? Boolean(window.isSecureContext || window.location?.hostname === 'localhost')
      : true;
  const hasManifestLink =
    typeof document !== 'undefined' ? Boolean(document.querySelector('link[rel="manifest"]')) : false;

  let serviceWorkerState: ServiceWorkerCheckState = 'unsupported';
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.active) serviceWorkerState = 'active';
      else if (reg?.installing || reg?.waiting) serviceWorkerState = 'installing';
      else if (reg) serviceWorkerState = 'registered';
      else serviceWorkerState = 'missing';
    } catch {
      serviceWorkerState = 'missing';
    }
  }

  let relatedAppsCount = 0;
  if (typeof navigator !== 'undefined' && typeof (navigator as any).getInstalledRelatedApps === 'function') {
    try {
      const relatedApps = await (navigator as any).getInstalledRelatedApps();
      if (Array.isArray(relatedApps)) {
        relatedAppsCount = relatedApps.length;
      }
    } catch {}
  }

  const hasPrompt = Boolean(deferredPrompt);
  const storedInstalled = safeGetStorage(INSTALLED_STORAGE_KEY) === 'true';
  const justInstalled = !env.isStandalone && (readRecentJustInstalled() || relatedAppsCount > 0);
  const isInstalledOnDevice =
    !hasPrompt && (env.isStandalone || relatedAppsCount > 0 || storedInstalled || justInstalled);

  const checks: InstallCheckReport = {
    isSecureContext,
    hasManifestLink,
    serviceWorkerState,
    isInAppBrowser: env.isInAppBrowser,
    hasNativePrompt: hasPrompt,
    isRunningStandalone: env.isStandalone,
    isInstalledOnDevice,
    relatedAppsCount,
    canTriggerNativePrompt: hasPrompt,
    recommendedFlow: computeRecommendedFlow({
      env,
      justInstalled,
      isInstalledOnDevice,
      hasNativePrompt: hasPrompt,
    }),
    failureReason: computeFailureReason({
      env,
      isSecureContext,
      hasManifestLink,
      serviceWorkerState,
      hasNativePrompt: hasPrompt,
      isInstalledOnDevice,
    }),
    checkedAt: Date.now(),
  };

  setSnapshot((prev) => ({
    ...prev,
    env,
    checks,
    isInstallable: hasPrompt,
    isInstalled: env.isStandalone || isInstalledOnDevice,
    isRunningStandalone: env.isStandalone,
    justInstalled: prev.justInstalled || justInstalled,
    installStatus: env.isStandalone || isInstalledOnDevice ? 'installed' : prev.installStatus,
    standaloneWelcomePending:
      env.isStandalone && safeGetStorage(STANDALONE_WELCOMED_KEY) !== 'true',
  }));

  return checks;
}

export function initPWAInstallTracking() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  // Sincroniza evento capturado pelo script inline em index.html antes do bundle React
  const earlyPrompt = (window as any).__ducaInstallPrompt as BeforeInstallPromptEvent | null;
  if (earlyPrompt) {
    applyCapturedPrompt(earlyPrompt);
  } else if ((window as any).__ducaAppInstalled) {
    applyAppInstalledState();
  }

  const onBeforeInstallPrompt = (e: Event) => {
    e.preventDefault();
    (window as any).__ducaInstallPrompt = e;
    applyCapturedPrompt(e as BeforeInstallPromptEvent);
  };

  const onCapturedCustom = () => {
    const promptEv = (window as any).__ducaInstallPrompt as BeforeInstallPromptEvent | null;
    if (promptEv) applyCapturedPrompt(promptEv);
  };

  const onAppInstalled = () => {
    applyAppInstalledState();
  };

  const displayMediaQuery = window.matchMedia?.('(display-mode: standalone)');
  const onDisplayModeChange = () => {
    void runPWAInstallCheck();
  };

  const onSwControllerChange = () => {
    void runPWAInstallCheck();
  };

  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  window.addEventListener('duca:pwa-prompt-captured', onCapturedCustom);
  window.addEventListener('appinstalled', onAppInstalled);
  window.addEventListener('duca:pwa-app-installed', onAppInstalled);
  displayMediaQuery?.addEventListener?.('change', onDisplayModeChange);
  navigator.serviceWorker?.addEventListener?.('controllerchange', onSwControllerChange);

  cleanupFns.push(() => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.removeEventListener('duca:pwa-prompt-captured', onCapturedCustom);
    window.removeEventListener('appinstalled', onAppInstalled);
    window.removeEventListener('duca:pwa-app-installed', onAppInstalled);
    displayMediaQuery?.removeEventListener?.('change', onDisplayModeChange);
    navigator.serviceWorker?.removeEventListener?.('controllerchange', onSwControllerChange);
  });

  void runPWAInstallCheck();
}

export async function triggerNativeInstall(): Promise<{
  outcome: 'accepted' | 'dismissed' | 'unavailable';
  error?: string;
}> {
  if (!deferredPrompt && typeof window !== 'undefined') {
    const early = (window as any).__ducaInstallPrompt as BeforeInstallPromptEvent | null;
    if (early) deferredPrompt = early;
  }

  if (!deferredPrompt) {
    await runPWAInstallCheck();
    return { outcome: 'unavailable' };
  }

  const promptRef = deferredPrompt;
  setSnapshot((prev) => ({
    ...prev,
    installStatus: 'prompting',
    installMessage: 'Confirmando download no navegador...',
  }));

  try {
    await promptRef.prompt();
    const { outcome } = await promptRef.userChoice;

    if (outcome === 'accepted') {
      setSnapshot((prev) => ({
        ...prev,
        installStatus: 'installing',
        installMessage: 'Baixando e adicionando o aplicativo DUCA na sua tela inicial...',
      }));

      applyAppInstalledState(
        'Aplicativo DUCA baixado com sucesso! Você já pode fechar o navegador e acessar direto pelo ícone na tela inicial.'
      );
      return { outcome: 'accepted' };
    }

    // Usuário fechou/recusou o diálogo nativo; o prompt atual não pode ser reutilizado.
    deferredPrompt = null;
    if (typeof window !== 'undefined') {
      (window as any).__ducaInstallPrompt = null;
    }

    setSnapshot((prev) => ({
      ...prev,
      isInstallable: false,
      installStatus: 'dismissed',
      installMessage:
        'O aviso de instalação foi fechado antes de concluir. Siga o passo rápido pelo menu do navegador ou tente novamente.',
      isModalOpen: true,
      checks: {
        ...prev.checks,
        hasNativePrompt: false,
        canTriggerNativePrompt: false,
        recommendedFlow: computeRecommendedFlow({
          env: prev.env,
          justInstalled: false,
          isInstalledOnDevice: false,
          hasNativePrompt: false,
        }),
      },
    }));
    return { outcome: 'dismissed' };
  } catch (err: any) {
    const msg = err?.message || 'Não foi possível abrir o instalador automático deste navegador.';
    setSnapshot((prev) => ({
      ...prev,
      installStatus: 'error',
      installMessage: msg,
      isModalOpen: true,
    }));
    return { outcome: 'unavailable', error: msg };
  }
}

export function markManualInstallCompleted() {
  applyAppInstalledState(
    'Perfeito! O ícone do DUCA já está na sua tela inicial. Feche o navegador e abra direto pelo aplicativo.'
  );
}

export function dismissJustInstalledNotice() {
  safeRemoveStorage(JUST_INSTALLED_AT_KEY);
  setSnapshot((prev) => ({
    ...prev,
    justInstalled: false,
    isModalOpen: false,
  }));
}

export function dismissStandaloneWelcome() {
  safeSetStorage(STANDALONE_WELCOMED_KEY, 'true');
  setSnapshot((prev) => ({
    ...prev,
    standaloneWelcomePending: false,
  }));
}

export function openInstallGuideModal() {
  void runPWAInstallCheck();
  setSnapshot((prev) => ({
    ...prev,
    isModalOpen: true,
  }));
}

export function closeInstallGuideModal() {
  setSnapshot((prev) => ({
    ...prev,
    isModalOpen: false,
  }));
}

export function getPWAInstallSnapshot(): PWAInstallSnapshot {
  return snapshot;
}

export function subscribePWAInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetPWAInstallStoreForTests() {
  cleanupFns.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
  cleanupFns = [];
  initialized = false;
  deferredPrompt = null;
  if (typeof window !== 'undefined') {
    (window as any).__ducaInstallPrompt = null;
    (window as any).__ducaAppInstalled = false;
  }
  safeRemoveStorage(INSTALLED_STORAGE_KEY);
  safeRemoveStorage(JUST_INSTALLED_AT_KEY);
  safeRemoveStorage(STANDALONE_WELCOMED_KEY);
  snapshot = buildInitialSnapshot();
  emit();
}
