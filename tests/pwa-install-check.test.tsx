import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { act } from 'react';
import {
  detectInstallEnvironment,
  initPWAInstallTracking,
  resetPWAInstallStoreForTests,
  runPWAInstallCheck,
} from '../src/services/pwaInstallStore.ts';
import { PWAInstallBanner } from '../src/components/pwa/PWAInstallBanner.tsx';

let cachedCreateRoot: ((container: Element | DocumentFragment) => any) | null = null;

async function setupDom(options: {
  userAgent?: string;
  standalone?: boolean;
  includeManifestLink?: boolean;
  withServiceWorker?: boolean;
} = {}) {
  const targetUA =
    options.userAgent ||
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

  const dom = new JSDOM(
    `<!doctype html><html lang="pt-BR"><head>${
      options.includeManifestLink !== false
        ? '<link rel="manifest" href="/manifest.webmanifest">'
        : ''
    }</head><body><div id="root"></div></body></html>`,
    {
      url: 'https://duca-app.example/',
    }
  );

  Object.defineProperty(dom.window.navigator, 'userAgent', {
    value: targetUA,
    configurable: true,
  });

  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  (globalThis as any).Node = dom.window.Node;
  (globalThis as any).Event = dom.window.Event;
  (globalThis as any).CustomEvent = dom.window.CustomEvent;
  (globalThis as any).localStorage = dom.window.localStorage;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

  Object.defineProperty(dom.window, 'isSecureContext', {
    value: true,
    configurable: true,
  });

  Object.defineProperty(dom.window, 'matchMedia', {
    value: (query: string) => ({
      matches: query === '(display-mode: standalone)' ? Boolean(options.standalone) : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    configurable: true,
  });

  if (options.withServiceWorker !== false) {
    Object.defineProperty(dom.window.navigator, 'serviceWorker', {
      value: {
        getRegistration: async () => ({ active: { state: 'activated' } }),
        addEventListener: () => {},
        removeEventListener: () => {},
      },
      configurable: true,
    });
  }

  Object.defineProperty(dom.window.navigator, 'clipboard', {
    value: {
      writeText: async () => {},
    },
    configurable: true,
  });

  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });

  if (!cachedCreateRoot) {
    const reactDomClient = await import('react-dom/client');
    cachedCreateRoot = reactDomClient.createRoot;
  }

  resetPWAInstallStoreForTests();
  return { dom, createRoot: cachedCreateRoot };
}

test('PWA Checagem: captura beforeinstallprompt pré-mount, baixa nativamente e exibe notificação pós-instalação', async () => {
  const { dom, createRoot } = await setupDom();
  // Simula marca antiga presa no localStorage antes do beforeinstallprompt
  dom.window.localStorage.setItem('duca_app_installed', 'true');

  let prompted = false;
  const fakePromptEvent = Object.assign(new dom.window.Event('beforeinstallprompt'), {
    prompt: async () => {
      prompted = true;
    },
    userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
  });

  // Simula o script inline de index.html capturando o evento antes do React montar
  (dom.window as any).__ducaInstallPrompt = fakePromptEvent;
  initPWAInstallTracking();

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(React.createElement(PWAInstallBanner));
    });

    const banner = container.querySelector('[data-testid="pwa-install-banner"]');
    assert.ok(banner, 'Banner de instalação deve aparecer quando beforeinstallprompt foi capturado');
    const downloadBtn = (Array.from(banner.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.includes('Baixar')
    );
    assert.ok(downloadBtn, 'Botão Baixar deve estar disponível');

    await act(async () => {
      downloadBtn.click();
    });

    assert.equal(prompted, true, 'Prompt nativo de instalação do navegador deve ter sido acionado');

    const installedToast = container.querySelector('[data-testid="pwa-installed-notification"]');
    assert.ok(installedToast, 'Notificação pós-instalação deve ser exibida após aceite');
    assert.match(installedToast.textContent || '', /Aplicativo DUCA baixado!/);
    assert.match(
      installedToast.textContent || '',
      /fechar o navegador e acessar direto pelo ícone na tela inicial/i
    );
    assert.equal(container.querySelector('[data-testid="pwa-install-banner"]'), null);
  } finally {
    await act(async () => root.unmount());
    resetPWAInstallStoreForTests();
    dom.window.close();
  }
});

test('PWA Checagem: detecta navegador interno do WhatsApp (Android) e guia saída para navegador principal', async () => {
  const { dom, createRoot } = await setupDom({
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 WhatsApp/2.24.1',
  });
  initPWAInstallTracking();

  const env = detectInstallEnvironment();
  assert.equal(env.isAndroid, true);
  assert.equal(env.inAppSource, 'whatsapp');
  assert.equal(env.isInAppBrowser, true);

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(React.createElement(PWAInstallBanner));
    });

    const banner = container.querySelector('[data-testid="pwa-install-banner"]');
    assert.ok(banner);
    assert.match(banner.textContent || '', /WhatsApp/i);

    const howBtn = (Array.from(banner.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.includes('Como baixar')
    );
    assert.ok(howBtn);
    await act(async () => {
      howBtn.click();
    });

    const modal = container.querySelector('[data-testid="pwa-install-guide-modal"]');
    assert.ok(modal, 'Modal guiado deve abrir para usuário no WhatsApp');
    assert.match(modal.textContent || '', /Abrir fora do WhatsApp/);
    assert.doesNotMatch(modal.textContent || '', /Instalar no Computador/);
    assert.match(modal.textContent || '', /Copiar link para abrir no navegador/);
  } finally {
    await act(async () => root.unmount());
    resetPWAInstallStoreForTests();
    dom.window.close();
  }
});

test('PWA Checagem: Android sem prompt nativo exibe guia Android (nunca Computador) + diagnóstico interativo + confirmação pós-instalação', async () => {
  const { dom, createRoot } = await setupDom({
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Samsung SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  });
  initPWAInstallTracking();

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(React.createElement(PWAInstallBanner));
    });

    const banner = container.querySelector('[data-testid="pwa-install-banner"]')!;
    const installBtn = (Array.from(banner.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.includes('Instalar')
    )!;
    assert.ok(installBtn);

    await act(async () => {
      installBtn.click();
    });

    const modal = container.querySelector('[data-testid="pwa-install-guide-modal"]')!;
    assert.ok(modal);
    assert.match(modal.textContent || '', /Instalar no Celular Android/);
    assert.doesNotMatch(modal.textContent || '', /Instalar no Computador/);
    assert.match(modal.textContent || '', /Adicionar página a → Tela inicial/);

    // Abre painel de Checagem do aparelho
    const checkToggle = (Array.from(modal.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.includes('Checagem do aparelho e navegador')
    )!;
    await act(async () => {
      checkToggle.click();
    });
    assert.match(modal.textContent || '', /Conexão segura \(HTTPS\)/);
    assert.match(modal.textContent || '', /Modo aplicativo \(Service Worker\)/);

    // Usuário confirma instalação manual -> exibe notificação de concluído
    const manualDoneBtn = (Array.from(modal.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.includes('Já instalei na tela inicial')
    )!;
    await act(async () => {
      manualDoneBtn.click();
    });

    const installedToast = container.querySelector('[data-testid="pwa-installed-notification"]');
    assert.ok(installedToast);
    assert.match(installedToast.textContent || '', /Aplicativo DUCA baixado!/);
  } finally {
    await act(async () => root.unmount());
    resetPWAInstallStoreForTests();
    dom.window.close();
  }
});

test('PWA Checagem: iOS Safari exibe guia de 3 passos + notificação após confirmar adição à Tela de Início', async () => {
  const { dom, createRoot } = await setupDom({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  });
  initPWAInstallTracking();

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(React.createElement(PWAInstallBanner));
    });

    const banner = container.querySelector('[data-testid="pwa-install-banner"]')!;
    const installBtn = (Array.from(banner.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.includes('Instalar')
    )!;
    await act(async () => {
      installBtn.click();
    });

    const modal = container.querySelector('[data-testid="pwa-install-guide-modal"]')!;
    assert.ok(modal);
    assert.match(modal.textContent || '', /Instalar no iPhone \/ iPad/);
    assert.match(modal.textContent || '', /Compartilhar/);
    assert.match(modal.textContent || '', /Adicionar à Tela de Início/);

    const iosDoneBtn = (Array.from(modal.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.includes('Já adicionei à Tela de Início')
    )!;
    await act(async () => {
      iosDoneBtn.click();
    });

    const installedToast = container.querySelector('[data-testid="pwa-installed-notification"]');
    assert.ok(installedToast);
    assert.match(installedToast.textContent || '', /Procure o ícone DUCA na Tela de Início do iPhone/);
  } finally {
    await act(async () => root.unmount());
    resetPWAInstallStoreForTests();
    dom.window.close();
  }
});

test('PWA Checagem: modo standalone suprime banner de download e exibe boas-vindas únicas no app', async () => {
  const { dom, createRoot } = await setupDom({ standalone: true });
  initPWAInstallTracking();
  await runPWAInstallCheck();

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(React.createElement(PWAInstallBanner));
    });

    assert.equal(container.querySelector('[data-testid="pwa-install-banner"]'), null);
    const welcome = container.querySelector('[data-testid="pwa-standalone-welcome"]');
    assert.ok(welcome);
    assert.match(welcome.textContent || '', /Você está usando o aplicativo DUCA/);

    const okBtn = welcome.querySelector('button')!;
    await act(async () => {
      okBtn.click();
    });
    assert.equal(container.querySelector('[data-testid="pwa-standalone-welcome"]'), null);
    assert.equal(dom.window.localStorage.getItem('duca_standalone_welcomed'), 'true');
  } finally {
    await act(async () => root.unmount());
    resetPWAInstallStoreForTests();
    dom.window.close();
  }
});
