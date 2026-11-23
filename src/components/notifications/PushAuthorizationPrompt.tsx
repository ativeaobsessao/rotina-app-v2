import React, { useEffect, useState } from 'react';
import { Bell, BellRing, CheckCircle2, Settings2, Smartphone, X } from 'lucide-react';
import {
  getBrowserPushSupport,
  getCurrentBrowserPushSubscription,
  LIVE_PUSH_RECEIVED_EVENT,
  resolvePushServerConfig,
  subscribeBrowserAndSaveToSupabase,
  type LivePushPayload,
} from '../../services/pushNotifications';
import { getMyPushSubscriptions } from '../../services/api';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { DEFAULT_PUSH_PREFERENCES } from '../../utils/notifications';
import { OPEN_NOTIFICATIONS_EVENT } from './NotificationBell';

const PROMPT_SNOOZE_KEY = 'duca_push_prompt_snoozed_until';
const SNOOZE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

interface PushAuthorizationPromptProps {
  familyId?: string | null;
  patientId?: string | null;
  patientName?: string | null;
  userId?: string | null;
  onPushReceived?: (payload: LivePushPayload) => void;
}

function isPromptSnoozed(userId?: string | null): boolean {
  try {
    const key = userId ? `${PROMPT_SNOOZE_KEY}:${userId}` : PROMPT_SNOOZE_KEY;
    const raw = localStorage.getItem(key);
    return Boolean(raw && Number(raw) > Date.now());
  } catch {
    return false;
  }
}

function snoozePrompt(userId?: string | null): void {
  try {
    const key = userId ? `${PROMPT_SNOOZE_KEY}:${userId}` : PROMPT_SNOOZE_KEY;
    localStorage.setItem(key, String(Date.now() + SNOOZE_DURATION_MS));
  } catch {}
}

export function PushAuthorizationPrompt({
  familyId,
  patientId,
  patientName,
  userId,
  onPushReceived,
}: PushAuthorizationPromptProps) {
  const { isIOS, isRunningStandalone, openInstallGuideModal } = usePWAInstall();
  const [shouldShowPrompt, setShouldShowPrompt] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activatedSuccess, setActivatedSuccess] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [liveToast, setLiveToast] = useState<LivePushPayload | null>(null);

  const needsStandaloneInstall = isIOS && !isRunningStandalone;

  useEffect(() => {
    const handleLivePush = (ev: Event) => {
      const detail = (ev as CustomEvent<LivePushPayload>).detail;
      if (!detail) return;
      setLiveToast(detail);
      onPushReceived?.(detail);
    };

    window.addEventListener(LIVE_PUSH_RECEIVED_EVENT, handleLivePush);
    return () => {
      window.removeEventListener(LIVE_PUSH_RECEIVED_EVENT, handleLivePush);
    };
  }, [onPushReceived]);

  useEffect(() => {
    if (!liveToast) return;
    const timer = window.setTimeout(() => {
      setLiveToast(null);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [liveToast]);

  useEffect(() => {
    let active = true;

    async function evaluatePromptVisibility() {
      if (!familyId || !userId) {
        if (active) setShouldShowPrompt(false);
        return;
      }

      const support = getBrowserPushSupport();
      if (!support.supported || support.permission !== 'default' || isPromptSnoozed(userId)) {
        if (active) setShouldShowPrompt(false);
        return;
      }

      const [serverConfig, browserSub, serverSubs] = await Promise.all([
        resolvePushServerConfig(),
        getCurrentBrowserPushSubscription(),
        getMyPushSubscriptions(familyId).catch(() => []),
      ]);

      if (!active) return;

      if (serverConfig.status !== 'ready') {
        setShouldShowPrompt(false);
        return;
      }

      const alreadyActiveHere =
        Boolean(browserSub?.endpoint) &&
        serverSubs.some((s) => s.endpoint === browserSub?.endpoint && s.enabled);

      setShouldShowPrompt(!alreadyActiveHere);
    }

    void evaluatePromptVisibility();
    return () => {
      active = false;
    };
  }, [familyId, userId]);

  const handleAuthorize = async () => {
    if (!familyId) return;
    setSubmitting(true);
    setErrorText(null);
    try {
      await subscribeBrowserAndSaveToSupabase({
        familyId,
        patientId: patientId || null,
        preferences: DEFAULT_PUSH_PREFERENCES,
      });
      setActivatedSuccess(true);
      window.setTimeout(() => {
        setShouldShowPrompt(false);
      }, 3000);
    } catch (err: any) {
      setErrorText(
        err?.message || 'Não foi possível autorizar as notificações neste aparelho agora.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDismiss = () => {
    snoozePrompt(userId);
    setShouldShowPrompt(false);
  };

  return (
    <>
      {liveToast && (
        <div
          role="status"
          aria-live="polite"
          aria-label="Notificação recebida em tempo real"
          className="mx-3.5 sm:mx-5 mt-3 rounded-2xl bg-indigo-600 text-white p-3.5 shadow-lg border border-indigo-500 flex items-start gap-3 animate-in fade-in slide-in-from-top-2"
        >
          <div className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center shrink-0 mt-0.5">
            <BellRing className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold leading-snug">{liveToast.title}</p>
            {liveToast.body && (
              <p className="text-xs text-indigo-100 mt-0.5 leading-snug">{liveToast.body}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setLiveToast(null)}
            aria-label="Fechar aviso recebido"
            className="min-w-[36px] min-h-[36px] -mr-1 -mt-1 rounded-xl flex items-center justify-center text-indigo-100 hover:text-white hover:bg-white/15 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {shouldShowPrompt && (
        <section
          role="region"
          aria-label="Autorizar notificações no aparelho"
          className="mx-3.5 sm:mx-5 mt-3 rounded-2xl bg-white dark:bg-[#16161b] border border-indigo-200/80 dark:border-indigo-800/50 p-3.5 shadow-sm transition-colors"
        >
          {activatedSuccess ? (
            <div className="flex items-center gap-2.5 text-emerald-700 dark:text-emerald-300 text-xs font-medium py-1">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                Notificações autorizadas! Este aparelho agora recebe lembretes e avisos em tempo real.
              </span>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 flex items-center justify-center shrink-0 mt-0.5">
                  <Bell className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100 leading-snug">
                    Receber avisos de cuidado neste aparelho
                  </p>
                  <p className="text-xs text-gray-600 dark:text-zinc-400 mt-0.5 leading-relaxed">
                    Autorize as notificações para acompanhar horários e registros
                    {patientName ? ` de ${patientName}` : ''} em tempo real, mesmo com o aplicativo fechado.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDismiss}
                  aria-label="Dispensar convite de notificações"
                  className="min-w-[36px] min-h-[36px] -mr-1 -mt-1 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-200 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {errorText && (
                <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200/70 dark:border-rose-800/50 rounded-xl px-3 py-2">
                  {errorText}
                </p>
              )}

              <div className="flex items-center gap-2">
                {needsStandaloneInstall ? (
                  <button
                    type="button"
                    onClick={openInstallGuideModal}
                    className="flex-1 min-h-[40px] py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>Adicionar à Tela de Início</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleAuthorize}
                    className="flex-1 min-h-[40px] py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
                  >
                    {submitting ? 'Autorizando...' : 'Autorizar notificações'}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent(OPEN_NOTIFICATIONS_EVENT))}
                  className="min-h-[40px] py-2 px-3 rounded-xl bg-gray-100 dark:bg-white/[0.06] hover:bg-gray-200 dark:hover:bg-white/[0.1] text-gray-700 dark:text-zinc-200 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors shrink-0"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  <span>Configurar</span>
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}
