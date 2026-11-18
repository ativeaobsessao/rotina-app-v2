import React, { useState, useEffect } from 'react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import {
  Download,
  X,
  Share2,
  PlusSquare,
  Smartphone,
  Laptop,
  CheckCircle2,
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
  AlertCircle,
  MoreVertical,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

export function PWAInstallBanner() {
  const {
    env,
    checks,
    isInstallable,
    isInstalled,
    isRunningStandalone,
    isIOS,
    isInAppBrowser,
    justInstalled,
    installStatus,
    installMessage,
    isModalOpen,
    standaloneWelcomePending,
    triggerNativeInstall,
    runCheck,
    markManualInstallCompleted,
    dismissJustInstalledNotice,
    dismissStandaloneWelcome,
    openInstallGuideModal,
    closeInstallGuideModal,
  } = usePWAInstall();

  const [isVisible, setIsVisible] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  useEffect(() => {
    if (isInstalled || isRunningStandalone || justInstalled) {
      setIsVisible(false);
      return;
    }

    setIsVisible(true);

    const autoDismissTimer = setTimeout(() => {
      setIsVisible(false);
    }, 30000);

    return () => clearTimeout(autoDismissTimer);
  }, [isInstalled, isRunningStandalone, justInstalled]);

  // Se o navegador já tiver permissão de notificação concedida e o app acabou de ser instalado,
  // envia também uma notificação discreta do sistema operacional sem pedir permissão intrusiva.
  useEffect(() => {
    if (!justInstalled || isRunningStandalone) return;
    try {
      if (
        typeof window !== 'undefined' &&
        'Notification' in window &&
        window.Notification.permission === 'granted'
      ) {
        new window.Notification('Aplicativo DUCA instalado', {
          body: 'Você já pode fechar o navegador e acessar direto pelo ícone na tela inicial.',
          icon: '/web-app-manifest-192x192.png',
        });
      }
    } catch {}
  }, [justInstalled, isRunningStandalone]);

  const handleDismissBanner = () => {
    setIsVisible(false);
  };

  const handlePrimaryInstallClick = async () => {
    if (isInAppBrowser) {
      openInstallGuideModal();
      return;
    }

    if (isInstallable) {
      const result = await triggerNativeInstall();
      if (result.outcome === 'unavailable') {
        setShowDiagnostics(true);
        openInstallGuideModal();
      }
      return;
    }

    await runCheck();
    openInstallGuideModal();
  };

  const handleRunDiagnosticCheck = async () => {
    setIsChecking(true);
    try {
      const report = await runCheck();
      if (report.canTriggerNativePrompt) {
        await triggerNativeInstall();
      }
    } finally {
      setIsChecking(false);
    }
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 3000);
    } catch {}
  };

  const inAppLabel =
    env.inAppSource === 'whatsapp'
      ? 'WhatsApp'
      : env.inAppSource === 'instagram'
        ? 'Instagram'
        : env.inAppSource === 'facebook'
          ? 'Facebook'
          : 'navegador interno';

  const bannerButtonLabel = isInAppBrowser
    ? 'Como baixar'
    : installStatus === 'prompting' || installStatus === 'installing'
      ? 'Baixando...'
      : isInstallable
        ? 'Baixar'
        : 'Instalar';

  const bannerDescription = isInAppBrowser
    ? `Você abriu pelo ${inAppLabel}. Veja como abrir no navegador para baixar o app.`
    : 'Instale na tela inicial para abrir rápido, em tela cheia e sem barras do navegador.';

  const checkItems = [
    {
      id: 'https',
      label: 'Conexão segura (HTTPS)',
      ok: checks.isSecureContext,
      detail: checks.isSecureContext ? 'Verificado' : 'Requer HTTPS',
    },
    {
      id: 'manifest',
      label: 'Configuração do app (Manifest)',
      ok: checks.hasManifestLink,
      detail: checks.hasManifestLink ? 'Carregado' : 'Indisponível',
    },
    {
      id: 'sw',
      label: 'Modo aplicativo (Service Worker)',
      ok: checks.serviceWorkerState === 'active' || checks.serviceWorkerState === 'registered',
      detail:
        checks.serviceWorkerState === 'active'
          ? 'Ativo'
          : checks.serviceWorkerState === 'installing'
            ? 'Instalando...'
            : checks.serviceWorkerState === 'registered'
              ? 'Registrado'
              : 'Pendente',
    },
    {
      id: 'browser',
      label: 'Navegador compatível',
      ok: !checks.isInAppBrowser,
      detail: checks.isInAppBrowser ? `Aberto no ${inAppLabel}` : 'Compatível',
    },
    {
      id: 'prompt',
      label: 'Instalador direto do aparelho',
      ok: checks.isInstalledOnDevice || checks.canTriggerNativePrompt,
      detail: checks.isInstalledOnDevice
        ? 'Já instalado'
        : checks.canTriggerNativePrompt
          ? 'Pronto para 1 toque'
          : env.os === 'ios'
            ? 'Via botão Compartilhar'
            : 'Via menu do navegador',
    },
  ];

  return (
    <>
      {/* 1. Boas-vindas únicas quando o usuário finalmente abre direto pelo App instalado */}
      {isRunningStandalone && standaloneWelcomePending && (
        <div
          role="status"
          aria-live="polite"
          data-testid="pwa-standalone-welcome"
          className="fixed bottom-20 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-md z-40 animate-in fade-in slide-in-from-bottom-4 duration-300"
        >
          <div className="bg-white dark:bg-[#141419] border border-emerald-200 dark:border-emerald-800/60 p-4 rounded-3xl shadow-xl flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900 dark:text-zinc-100 leading-snug">
                  Você está usando o aplicativo DUCA
                </p>
                <p className="text-xs text-gray-500 dark:text-zinc-400 leading-snug mt-0.5">
                  Acesso direto pela tela inicial ativado.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={dismissStandaloneWelcome}
              className="min-h-[44px] px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shrink-0 whitespace-nowrap transition-colors"
            >
              Entendi
            </button>
          </div>
        </div>
      )}

      {/* 2. Notificação Pós-Instalação (avisa claramente que o app foi baixado e já pode abrir pelo ícone) */}
      {justInstalled && !isRunningStandalone && (
        <div
          role="status"
          aria-live="polite"
          data-testid="pwa-installed-notification"
          className="fixed bottom-20 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-md z-40 animate-in fade-in slide-in-from-bottom-5 duration-300"
        >
          <div className="bg-white dark:bg-[#141419] border border-emerald-200 dark:border-emerald-800/60 p-4 rounded-3xl shadow-2xl space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="relative shrink-0">
                  <img
                    src="/web-app-manifest-192x192.png"
                    alt="DUCA"
                    className="w-11 h-11 rounded-2xl border border-gray-100 dark:border-white/10 object-cover"
                  />
                  <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center ring-2 ring-white dark:ring-[#141419]">
                    <Check className="w-3 h-3" />
                  </span>
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-zinc-100 tracking-tight">
                    Aplicativo DUCA baixado!
                  </h4>
                  <p className="text-xs text-gray-600 dark:text-zinc-300 leading-relaxed mt-0.5">
                    {installMessage ||
                      'O ícone do DUCA já está na tela inicial do seu dispositivo. Você já pode fechar o navegador e acessar direto pelo aplicativo.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={dismissJustInstalledNotice}
                aria-label="Fechar aviso de aplicativo instalado"
                className="min-h-[44px] min-w-[44px] -mr-1.5 -mt-1.5 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 rounded-full hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-100 dark:border-white/[0.06]">
              <span className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">
                {env.isIOS
                  ? 'Procure o ícone DUCA na Tela de Início do iPhone.'
                  : env.isAndroid
                    ? 'Procure o ícone DUCA na tela inicial ou gaveta de apps.'
                    : 'Procure o app DUCA nos seus aplicativos ou Área de Trabalho.'}
              </span>
              <button
                type="button"
                onClick={dismissJustInstalledNotice}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold whitespace-nowrap shrink-0 transition-colors"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Banner Flutuante de Convite para Baixar (apenas quando ainda não instalado) */}
      {isVisible && !isInstalled && !justInstalled && (
        <div
          data-testid="pwa-install-banner"
          className="fixed bottom-20 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-md z-40 animate-in fade-in slide-in-from-bottom-5 duration-300"
        >
          <div className="bg-white/95 dark:bg-[#141419]/95 backdrop-blur-xl border border-gray-200/80 dark:border-white/[0.08] p-3.5 sm:p-4 rounded-3xl shadow-2xl flex items-center justify-between gap-3">
            <img
              src="/web-app-manifest-192x192.png"
              alt="DUCA"
              className="w-11 h-11 rounded-2xl shadow-sm border border-gray-100 dark:border-white/10 object-cover shrink-0"
            />

            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-bold text-gray-900 dark:text-zinc-100 tracking-tight truncate">
                {isInAppBrowser ? 'Abrir DUCA como Aplicativo' : 'Baixar Aplicativo DUCA'}
              </h4>
              <p className="text-xs text-gray-500 dark:text-zinc-400 leading-snug line-clamp-2 mt-0.5">
                {bannerDescription}
              </p>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handlePrimaryInstallClick}
                disabled={installStatus === 'prompting' || installStatus === 'installing'}
                className="min-h-[44px] px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-70 active:scale-95 text-white text-xs font-bold rounded-2xl shadow-md shadow-indigo-600/20 flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0"
              >
                {isInAppBrowser ? (
                  <ExternalLink className="w-3.5 h-3.5" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                <span>{bannerButtonLabel}</span>
              </button>
              <button
                type="button"
                onClick={handleDismissBanner}
                aria-label="Fechar convite de instalação"
                title="Fechar aviso"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 rounded-full hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Modal Guiado + Sistema de Checagem do Dispositivo */}
      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-guide-title"
          data-testid="pwa-install-guide-modal"
          className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
        >
          <div className="bg-white dark:bg-[#121216] w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl border border-gray-100 dark:border-white/[0.08] max-h-[90dvh] overflow-y-auto animate-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-white/[0.08]">
              <div className="flex items-center gap-2.5 min-w-0">
                {env.os === 'desktop' ? (
                  <Laptop className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                ) : (
                  <Smartphone className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                )}
                <h3
                  id="pwa-guide-title"
                  className="text-base font-bold text-gray-900 dark:text-zinc-100 truncate"
                >
                  {isInAppBrowser
                    ? `Abrir fora do ${inAppLabel}`
                    : env.os === 'ios'
                      ? 'Instalar no iPhone / iPad'
                      : env.os === 'android'
                        ? 'Instalar no Celular Android'
                        : 'Instalar no Computador'}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeInstallGuideModal}
                aria-label="Fechar guia de instalação"
                className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.08] transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-5 space-y-4">
              {/* Motivo detectado pela checagem (quando aplicável) */}
              {(installStatus === 'dismissed' || installMessage || checks.failureReason) && (
                <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/35 border border-amber-200/80 dark:border-amber-800/50 p-3.5 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-950/90 dark:text-amber-100/90 leading-relaxed">
                    {installStatus === 'dismissed' && installMessage
                      ? installMessage
                      : checks.failureReason || installMessage}
                  </p>
                </div>
              )}

              {/* Cenário A: Navegador interno (WhatsApp / Instagram / Facebook) */}
              {isInAppBrowser ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-gray-50 dark:bg-[#1c1c22]">
                    <div className="w-7 h-7 rounded-xl bg-indigo-50 dark:bg-indigo-950/70 flex items-center justify-center shrink-0 text-indigo-600 dark:text-indigo-300 font-bold text-xs">
                      1
                    </div>
                    <p className="text-xs text-gray-700 dark:text-zinc-300 leading-relaxed">
                      Toque no menu no canto da tela (<MoreVertical className="w-3.5 h-3.5 inline text-indigo-600" /> ou ícone de bússola) e escolha{' '}
                      <strong className="text-gray-900 dark:text-zinc-100">
                        {env.os === 'ios' ? 'Abrir no Safari' : 'Abrir no navegador (Chrome)'}
                      </strong>
                      .
                    </p>
                  </div>
                  <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-gray-50 dark:bg-[#1c1c22]">
                    <div className="w-7 h-7 rounded-xl bg-indigo-50 dark:bg-indigo-950/70 flex items-center justify-center shrink-0 text-indigo-600 dark:text-indigo-300 font-bold text-xs">
                      2
                    </div>
                    <p className="text-xs text-gray-700 dark:text-zinc-300 leading-relaxed">
                      Se preferir, copie o link abaixo e cole direto no{' '}
                      <strong className="text-gray-900 dark:text-zinc-100">
                        {env.os === 'ios' ? 'Safari' : 'Google Chrome'}
                      </strong>{' '}
                      para concluir o download do aplicativo.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleCopyUrl}
                    className="w-full min-h-[44px] py-3 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                  >
                    {linkCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    <span>{linkCopied ? 'Link copiado! Cole no navegador' : 'Copiar link para abrir no navegador'}</span>
                  </button>
                </div>
              ) : env.os === 'ios' ? (
                /* Cenário B: iOS (iPhone / iPad) */
                <div className="space-y-3">
                  {env.browser !== 'safari' ? (
                    <div className="rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/35 border border-indigo-100 dark:border-indigo-800/40 p-3 text-xs text-indigo-950 dark:text-indigo-100 leading-relaxed">
                      Você está usando outro navegador no iPhone. Se não encontrar{' '}
                      <strong>Adicionar à Tela de Início</strong> no ícone Compartilhar do topo direito, copie o link abaixo e abra no <strong>Safari</strong>.
                    </div>
                  ) : (
                    <div className="rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/35 border border-indigo-100 dark:border-indigo-800/40 p-3 text-xs text-indigo-950 dark:text-indigo-100 leading-relaxed">
                      Se você abriu pelo <strong>WhatsApp</strong>, toque antes no ícone da <strong>bússola (Safari)</strong> no canto inferior direito para sair do WhatsApp.
                    </div>
                  )}
                  <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-gray-50 dark:bg-[#1c1c22]">
                    <div className="w-7 h-7 rounded-xl bg-indigo-50 dark:bg-indigo-950/70 flex items-center justify-center shrink-0 text-indigo-600 dark:text-indigo-300 font-bold text-xs">
                      1
                    </div>
                    <p className="text-xs text-gray-700 dark:text-zinc-300 leading-relaxed">
                      Toque no botão{' '}
                      <strong className="text-gray-900 dark:text-zinc-100 inline-flex items-center gap-1">
                        Compartilhar <Share2 className="w-3.5 h-3.5 text-indigo-600 inline" />
                      </strong>{' '}
                      {env.browser === 'safari'
                        ? 'na barra inferior do Safari.'
                        : 'no canto superior direito da barra de endereço.'}
                    </p>
                  </div>
                  <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-gray-50 dark:bg-[#1c1c22]">
                    <div className="w-7 h-7 rounded-xl bg-indigo-50 dark:bg-indigo-950/70 flex items-center justify-center shrink-0 text-indigo-600 dark:text-indigo-300 font-bold text-xs">
                      2
                    </div>
                    <p className="text-xs text-gray-700 dark:text-zinc-300 leading-relaxed">
                      Role as opções até encontrar e tocar em{' '}
                      <strong className="text-gray-900 dark:text-zinc-100 inline-flex items-center gap-1">
                        Adicionar à Tela de Início <PlusSquare className="w-3.5 h-3.5 text-indigo-600 inline" />
                      </strong>
                      .
                    </p>
                  </div>
                  <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-gray-50 dark:bg-[#1c1c22]">
                    <div className="w-7 h-7 rounded-xl bg-indigo-50 dark:bg-indigo-950/70 flex items-center justify-center shrink-0 text-indigo-600 dark:text-indigo-300 font-bold text-xs">
                      3
                    </div>
                    <p className="text-xs text-gray-700 dark:text-zinc-300 leading-relaxed">
                      Toque em <strong className="text-gray-900 dark:text-zinc-100">Adicionar</strong> no canto superior direito. Depois, feche o navegador e abra pelo ícone DUCA na Tela de Início.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={markManualInstallCompleted}
                    className="w-full min-h-[44px] py-3 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Já adicionei à Tela de Início</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyUrl}
                    className="w-full min-h-[44px] py-2.5 px-4 rounded-2xl border border-gray-200 dark:border-white/[0.1] bg-white dark:bg-[#1c1c22] hover:bg-gray-50 dark:hover:bg-[#24242c] text-gray-700 dark:text-zinc-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                  >
                    {linkCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{linkCopied ? 'Link copiado! Cole no Safari' : 'Copiar link para abrir no Safari'}</span>
                  </button>
                </div>
              ) : env.os === 'android' ? (
                /* Cenário C: Android (Chrome / Samsung Internet / Edge / Firefox) */
                <div className="space-y-3">
                  {isInstallable && (
                    <button
                      type="button"
                      onClick={() => void triggerNativeInstall()}
                      className="w-full min-h-[48px] py-3 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-md transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      <span>Baixar e Instalar Agora</span>
                    </button>
                  )}

                  <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-gray-50 dark:bg-[#1c1c22]">
                    <div className="w-7 h-7 rounded-xl bg-indigo-50 dark:bg-indigo-950/70 flex items-center justify-center shrink-0 text-indigo-600 dark:text-indigo-300 font-bold text-xs">
                      1
                    </div>
                    <p className="text-xs text-gray-700 dark:text-zinc-300 leading-relaxed">
                      No canto superior direito do navegador, toque no menu{' '}
                      <strong className="text-gray-900 dark:text-zinc-100 inline-flex items-center gap-0.5">
                        {env.browser === 'samsung' ? '☰ (Menu)' : '⋮ (três pontinhos)'}
                      </strong>
                      .
                    </p>
                  </div>

                  <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-gray-50 dark:bg-[#1c1c22]">
                    <div className="w-7 h-7 rounded-xl bg-indigo-50 dark:bg-indigo-950/70 flex items-center justify-center shrink-0 text-indigo-600 dark:text-indigo-300 font-bold text-xs">
                      2
                    </div>
                    <p className="text-xs text-gray-700 dark:text-zinc-300 leading-relaxed">
                      Toque em{' '}
                      <strong className="text-gray-900 dark:text-zinc-100">
                        {env.browser === 'samsung'
                          ? 'Adicionar página a → Tela inicial'
                          : 'Instalar aplicativo ou Adicionar à tela inicial'}
                      </strong>{' '}
                      e confirme tocando em <strong className="text-gray-900 dark:text-zinc-100">Instalar</strong>.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={markManualInstallCompleted}
                    className="w-full min-h-[44px] py-3 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Já instalei na tela inicial</span>
                  </button>
                </div>
              ) : (
                /* Cenário D: Desktop Chrome / Edge */
                <div className="space-y-3">
                  {isInstallable && (
                    <button
                      type="button"
                      onClick={() => void triggerNativeInstall()}
                      className="w-full min-h-[48px] py-3 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-md transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      <span>Baixar e Instalar no Computador</span>
                    </button>
                  )}

                  <div className="bg-gray-50 dark:bg-[#1c1c22] p-3.5 rounded-2xl space-y-2 text-xs text-gray-700 dark:text-zinc-300 leading-relaxed">
                    <div className="flex items-start gap-2">
                      <Download className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                      <span>
                        No Google Chrome ou Microsoft Edge, clique no ícone de{' '}
                        <strong className="text-gray-900 dark:text-zinc-100">Instalar</strong> na barra de endereço (ou abra{' '}
                        <strong className="text-gray-900 dark:text-zinc-100">Menu ⋮ → Salvar e compartilhar → Instalar</strong>).
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Sistema de Checagem do Dispositivo */}
              <div className="border border-gray-200/80 dark:border-white/[0.08] rounded-2xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowDiagnostics((prev) => !prev)}
                  className="w-full min-h-[44px] px-4 py-2.5 bg-gray-50/70 dark:bg-[#16161b] flex items-center justify-between text-xs font-semibold text-gray-700 dark:text-zinc-200 hover:bg-gray-100/70 dark:hover:bg-white/[0.04] transition-colors"
                >
                  <span className="inline-flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    Checagem do aparelho e navegador
                  </span>
                  {showDiagnostics ? (
                    <ChevronUp className="w-4 h-4 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  )}
                </button>

                {showDiagnostics && (
                  <div className="p-3.5 space-y-2 bg-white dark:bg-[#121216] border-t border-gray-100 dark:border-white/[0.06]">
                    {checkItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-2 text-xs py-1"
                      >
                        <span className="flex items-center gap-2 text-gray-700 dark:text-zinc-300 min-w-0">
                          {item.ok ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          ) : (
                            <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                          )}
                          <span className="truncate">{item.label}</span>
                        </span>
                        <span
                          className={`text-[11px] font-semibold shrink-0 ${
                            item.ok
                              ? 'text-emerald-700 dark:text-emerald-300'
                              : 'text-amber-700 dark:text-amber-300'
                          }`}
                        >
                          {item.detail}
                        </span>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={handleRunDiagnosticCheck}
                      disabled={isChecking}
                      className="mt-2 w-full min-h-[44px] py-2 px-3 rounded-xl bg-gray-100 dark:bg-[#1c1c22] hover:bg-gray-200 dark:hover:bg-[#24242c] text-xs font-bold text-gray-800 dark:text-zinc-200 flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
                      <span>{isChecking ? 'Verificando...' : 'Verificar novamente'}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={closeInstallGuideModal}
              className="w-full min-h-[44px] py-3 bg-gray-100 dark:bg-[#1c1c22] hover:bg-gray-200 dark:hover:bg-[#24242c] text-gray-800 dark:text-zinc-200 font-bold text-sm rounded-2xl transition-colors"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
