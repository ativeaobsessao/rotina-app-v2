import React, { useState, useEffect } from 'react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { Download, X, Share2, PlusSquare, Smartphone, Laptop, Sparkles } from 'lucide-react';

export function PWAInstallBanner() {
  const { isInstallable, isInstalled, isIOS, isMobile, install } = usePWAInstall();
  const [isVisible, setIsVisible] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [showDesktopGuide, setShowDesktopGuide] = useState(false);

  useEffect(() => {
    // If already installed in standalone mode, never show
    if (isInstalled) {
      setIsVisible(false);
      return;
    }

    // Check if dismissed in this session or recently
    const dismissedUntil = localStorage.getItem('duca_pwa_dismissed_until');
    if (dismissedUntil && Number(dismissedUntil) > Date.now()) {
      return;
    }

    // Trigger banner with subtle delay to create pleasant entrance
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 1500);

    return () => clearTimeout(timer);
  }, [isInstalled]);

  const handleDismiss = () => {
    setIsVisible(false);
    // Dismiss for 24 hours so we don't annoy the user repeatedly
    localStorage.setItem('duca_pwa_dismissed_until', (Date.now() + 24 * 60 * 60 * 1000).toString());
  };

  const handleInstallClick = async () => {
    if (isInstallable) {
      await install();
    } else if (isIOS) {
      setShowIOSGuide(true);
    } else {
      setShowDesktopGuide(true);
    }
  };

  if (!isVisible || isInstalled) return null;

  return (
    <>
      {/* Notificação Flutuante com Design Refinado */}
      <div className="fixed bottom-20 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-md z-40 animate-in fade-in slide-in-from-bottom-5 duration-500">
        <div className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-gray-100/80 dark:border-gray-800 p-4 rounded-3xl shadow-2xl shadow-indigo-500/10 flex items-center justify-between gap-3.5">
          {/* Ícone do App */}
          <div className="relative shrink-0">
            <img 
              src="/web-app-manifest-192x192.png" 
              alt="DUCA Ícone" 
              className="w-12 h-12 rounded-2xl shadow-md border border-white/50 dark:border-gray-700 object-cover"
            />
            <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-indigo-600"></span>
            </span>
          </div>

          {/* Texto de Convite */}
          <div className="flex-1 min-w-0 pr-1">
            <div className="flex items-center gap-1.5">
              <h4 className="text-sm font-bold text-gray-900 dark:text-white tracking-tight truncate">
                Instalar o DUCA
              </h4>
              <span className="text-[10px] bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-bold px-1.5 py-0.5 rounded-full">
                App
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug line-clamp-2 mt-0.5">
              Acesse a rotina com mais velocidade e sem barras do navegador.
            </p>
          </div>

          {/* Ações */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleInstallClick}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-xs font-bold rounded-2xl shadow-md shadow-indigo-600/25 flex items-center gap-1.5 transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Baixar</span>
            </button>
            <button
              onClick={handleDismiss}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title="Fechar notificação"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Modal Guia Especial para iOS (Safari / iPhone) */}
      {showIOSGuide && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-gray-900 w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl border border-gray-100 dark:border-gray-800 animate-in slide-in-from-bottom duration-300">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2.5">
                <Smartphone className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                <h3 className="text-base font-bold text-gray-900 dark:text-white">Instalar no iPhone / iPad</h3>
              </div>
              <button 
                onClick={() => setShowIOSGuide(false)}
                className="p-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-5 space-y-4">
              <div className="flex items-start gap-3.5 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/60">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center shrink-0 text-indigo-600 dark:text-indigo-400 font-bold text-sm">
                  1
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                  Toque no botão <span className="font-semibold text-gray-900 dark:text-white inline-flex items-center gap-1">Compartilhar <Share2 className="w-3.5 h-3.5 text-indigo-600 inline" /></span> na barra inferior do Safari.
                </div>
              </div>

              <div className="flex items-start gap-3.5 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/60">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center shrink-0 text-indigo-600 dark:text-indigo-400 font-bold text-sm">
                  2
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                  Role para baixo e selecione a opção <span className="font-semibold text-gray-900 dark:text-white inline-flex items-center gap-1">Adicionar à Tela de Início <PlusSquare className="w-3.5 h-3.5 text-indigo-600 inline" /></span>.
                </div>
              </div>

              <div className="flex items-start gap-3.5 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/60">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center shrink-0 text-indigo-600 dark:text-indigo-400 font-bold text-sm">
                  3
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                  Toque em <span className="font-semibold text-gray-900 dark:text-white">Adicionar</span> no canto superior direito. Pronto! O DUCA ficará como um aplicativo nativo na sua tela.
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowIOSGuide(false)}
              className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-2xl transition-all"
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      {/* Modal Guia para Desktop / Outros Navegadores */}
      {showDesktopGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-gray-900 w-full max-w-sm rounded-3xl p-6 shadow-2xl border border-gray-100 dark:border-gray-800 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2.5">
                <Laptop className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                <h3 className="text-base font-bold text-gray-900 dark:text-white">Instalar no Computador</h3>
              </div>
              <button 
                onClick={() => setShowDesktopGuide(false)}
                className="p-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-5 space-y-3 text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              <p>
                No Google Chrome ou Microsoft Edge:
              </p>
              <div className="bg-gray-50 dark:bg-gray-800/60 p-3.5 rounded-2xl space-y-2">
                <div className="flex items-center gap-2">
                  <Download className="w-4 h-4 text-indigo-600" />
                  <span>Clique no ícone de <strong>instalação na barra de endereço</strong> do navegador (ao lado da estrela de favoritos).</span>
                </div>
              </div>
              <p className="text-[11px] text-gray-400">
                O aplicativo abrirá em uma janela própria, rápida e sem distrações.
              </p>
            </div>

            <button
              onClick={() => setShowDesktopGuide(false)}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-2xl transition-all"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
