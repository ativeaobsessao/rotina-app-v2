import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Bell,
  BellOff,
  CalendarClock,
  Check,
  Clock,
  Heart,
  Pill,
  Send,
  Smartphone,
  Utensils,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import {
  getActivities,
  getMyNotificationDispatchLogs,
  getMyPushSubscriptions,
  type NotificationDispatchLogRow,
  type PushSubscriptionRow,
} from '../../services/api';
import {
  getBrowserPushSupport,
  getCurrentBrowserPushSubscription,
  savePushPreferencesForSubscription,
  sendTestPushNotification,
  subscribeBrowserAndSaveToSupabase,
  unsubscribeBrowserFromWebPush,
} from '../../services/pushNotifications';
import { DEFAULT_TIMEZONE, getLocalDateString } from '../../utils/date';
import {
  DEFAULT_PUSH_PREFERENCES,
  dismissActivityMilestone,
  filterActiveMilestoneAlerts,
  getActivityMilestoneNotifications,
  type ActivityMilestoneAlert,
  type NotificationLeadMinutes,
  type PushNotificationPreferences,
} from '../../utils/notifications';

interface NotificationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  familyId?: string | null;
  patientId?: string | null;
  patientName?: string | null;
  userId?: string | null;
  activities?: any[];
  todayDateStr?: string;
  onAlertsChanged?: () => void;
}

const LEAD_OPTIONS: { value: NotificationLeadMinutes; label: string }[] = [
  { value: 0, label: 'No horário' },
  { value: 5, label: '5 min antes' },
  { value: 10, label: '10 min antes' },
  { value: 15, label: '15 min antes' },
  { value: 30, label: '30 min antes' },
];

export function NotificationsModal({
  isOpen,
  onClose,
  familyId,
  patientId,
  patientName,
  userId,
  activities,
  todayDateStr,
  onAlertsChanged,
}: NotificationsModalProps) {
  const { isIOS, isRunningStandalone, openInstallGuideModal } = usePWAInstall();
  const effectiveToday = todayDateStr || getLocalDateString(DEFAULT_TIMEZONE);

  const [loadedActivities, setLoadedActivities] = useState<any[]>(activities || []);
  const [loadingSub, setLoadingSub] = useState(false);
  const [savingPush, setSavingPush] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  const [activeSub, setActiveSub] = useState<PushSubscriptionRow | null>(null);
  const [browserEndpoint, setBrowserEndpoint] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<PushNotificationPreferences>(
    DEFAULT_PUSH_PREFERENCES
  );
  const [recentLogs, setRecentLogs] = useState<NotificationDispatchLogRow[]>([]);
  const [dismissTick, setDismissTick] = useState(0);

  const [feedback, setFeedback] = useState<{
    type: 'error' | 'success' | 'info';
    text: string;
  } | null>(null);

  const support = getBrowserPushSupport();
  const needsStandaloneInstallForPush = isIOS && !isRunningStandalone;

  useEffect(() => {
    if (Array.isArray(activities)) {
      setLoadedActivities(activities);
    }
  }, [activities]);

  const loadNotificationState = useCallback(async () => {
    if (!isOpen) return;
    setLoadingSub(true);
    setFeedback(null);

    try {
      const [browserSub, serverSubs, fetchedActivities, logs] = await Promise.all([
        getCurrentBrowserPushSubscription(),
        familyId ? getMyPushSubscriptions(familyId) : Promise.resolve([]),
        activities === undefined && patientId
          ? getActivities(patientId).catch(() => [])
          : Promise.resolve(null),
        patientId ? getMyNotificationDispatchLogs(patientId, 6).catch(() => []) : Promise.resolve([]),
      ]);

      if (fetchedActivities !== null) {
        setLoadedActivities(fetchedActivities);
      }
      setRecentLogs(logs);

      const endpoint = browserSub?.endpoint || null;
      setBrowserEndpoint(endpoint);

      const matchedSub =
        (endpoint ? serverSubs.find((s) => s.endpoint === endpoint) : null) ||
        null;

      setActiveSub(matchedSub);

      if (matchedSub) {
        setPreferences({
          enabled: matchedSub.enabled,
          notify_medications: matchedSub.notify_medications,
          notify_meals: matchedSub.notify_meals,
          notify_activities: matchedSub.notify_activities,
          lead_minutes: ([0, 5, 10, 15, 30].includes(matchedSub.lead_minutes)
            ? matchedSub.lead_minutes
            : 0) as NotificationLeadMinutes,
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Não foi possível carregar suas preferências agora. Tente novamente em instantes.',
      });
    } finally {
      setLoadingSub(false);
    }
  }, [isOpen, familyId, patientId, activities]);

  useEffect(() => {
    if (isOpen) {
      void loadNotificationState();
    }
  }, [isOpen, loadNotificationState]);

  const allMilestones = useMemo(
    () => getActivityMilestoneNotifications(loadedActivities, effectiveToday),
    [loadedActivities, effectiveToday]
  );

  const activeMilestones = useMemo(
    () =>
      filterActiveMilestoneAlerts(allMilestones, userId, patientId).filter(
        () => dismissTick >= 0
      ),
    [allMilestones, userId, patientId, dismissTick]
  );

  const handleDismissAlert = (alert: ActivityMilestoneAlert) => {
    dismissActivityMilestone(userId, patientId, alert);
    setDismissTick((t) => t + 1);
    onAlertsChanged?.();
  };

  const handleEnableDevicePush = async () => {
    if (!familyId) {
      setFeedback({
        type: 'error',
        text: 'Selecione um perfil familiar antes de ativar os avisos.',
      });
      return;
    }

    setSavingPush(true);
    setFeedback(null);
    try {
      const nextPrefs: PushNotificationPreferences = { ...preferences, enabled: true };
      const saved = await subscribeBrowserAndSaveToSupabase({
        familyId,
        patientId: patientId || null,
        preferences: nextPrefs,
      });
      setActiveSub(saved);
      setBrowserEndpoint(saved.endpoint);
      setPreferences(nextPrefs);
      setFeedback({
        type: 'success',
        text: 'Tudo certo! Este aparelho já está pronto para receber seus lembretes com carinho.',
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text:
          err?.message ||
          'Não foi possível ativar os avisos neste aparelho agora. Tente novamente.',
      });
    } finally {
      setSavingPush(false);
    }
  };

  const handleDisableDevicePush = async () => {
    setSavingPush(true);
    setFeedback(null);
    try {
      await unsubscribeBrowserFromWebPush();
      setActiveSub(null);
      setBrowserEndpoint(null);
      setFeedback({
        type: 'info',
        text: 'Avisos pausados neste aparelho. Quando quiser retomar, é só tocar em Ativar.',
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Não foi possível pausar as notificações agora.',
      });
    } finally {
      setSavingPush(false);
    }
  };

  const handleUpdatePreferences = async (patch: Partial<PushNotificationPreferences>) => {
    const nextPrefs: PushNotificationPreferences = { ...preferences, ...patch };
    setPreferences(nextPrefs);

    if (!activeSub) return;

    setSavingPush(true);
    setFeedback(null);
    try {
      const updated = await savePushPreferencesForSubscription(
        activeSub.id,
        patientId || null,
        nextPrefs
      );
      setActiveSub(updated);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Não foi possível salvar sua escolha agora.',
      });
    } finally {
      setSavingPush(false);
    }
  };

  const handleSendTest = async () => {
    setSendingTest(true);
    setFeedback(null);
    try {
      const res = await sendTestPushNotification(activeSub?.endpoint || browserEndpoint || undefined);
      setFeedback({ type: 'success', text: res.message });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text:
          err?.message ||
          'Não conseguimos enviar o aviso de teste agora. Verifique sua conexão e tente novamente.',
      });
    } finally {
      setSendingTest(false);
    }
  };

  const isDeviceSubscribed = Boolean(activeSub && activeSub.enabled);

  const milestoneSection = (
    <section aria-label="Atividades programadas em 7, 3 e 1 dia" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
            Atividades Programadas
          </h3>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
            Lembramos você automaticamente quando faltar 7 dias, 3 dias e 1 dia.
          </p>
        </div>
        {activeMilestones.length > 0 && (
          <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/50 tabular-nums shrink-0">
            {activeMilestones.length} {activeMilestones.length === 1 ? 'aviso' : 'avisos'}
          </span>
        )}
      </div>

      {activeMilestones.length > 0 ? (
        <div className="space-y-2.5">
          {activeMilestones.map((alert) => {
            const isUrgent = alert.daysUntil === 1;
            const isMedium = alert.daysUntil === 3;
            return (
              <div
                key={alert.id}
                className={`rounded-2xl p-3.5 border flex items-start justify-between gap-3 ${
                  isUrgent
                    ? 'bg-rose-50/90 dark:bg-rose-950/35 border-rose-200/80 dark:border-rose-800/50'
                    : isMedium
                    ? 'bg-amber-50/90 dark:bg-amber-950/35 border-amber-200/80 dark:border-amber-800/50'
                    : 'bg-indigo-50/90 dark:bg-indigo-950/35 border-indigo-200/80 dark:border-indigo-800/50'
                }`}
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                      isUrgent
                        ? 'bg-rose-100 dark:bg-rose-900/60 text-rose-600 dark:text-rose-300'
                        : isMedium
                        ? 'bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300'
                        : 'bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-300'
                    }`}
                  >
                    <CalendarClock className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <span
                      className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                        isUrgent
                          ? 'bg-rose-100 dark:bg-rose-900/60 text-rose-800 dark:text-rose-200'
                          : isMedium
                          ? 'bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200'
                          : 'bg-indigo-100 dark:bg-indigo-900/60 text-indigo-800 dark:text-indigo-200'
                      }`}
                    >
                      {alert.badgeLabel}
                    </span>
                    <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100 mt-1 leading-snug">
                      {alert.activity.title}
                    </p>
                    <p className="text-xs text-gray-600 dark:text-zinc-300 mt-0.5 tabular-nums">
                      {alert.detail}
                    </p>
                    {alert.activity.notes && (
                      <p className="text-[11px] text-gray-500 dark:text-zinc-400 mt-1 line-clamp-2">
                        {alert.activity.notes}
                      </p>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleDismissAlert(alert)}
                  className="min-h-[36px] px-2.5 py-1.5 rounded-xl bg-white/80 dark:bg-white/[0.08] border border-gray-200/80 dark:border-white/[0.12] text-[11px] font-semibold text-gray-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-white/[0.14] inline-flex items-center gap-1 shrink-0 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Visto</span>
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-200 dark:border-white/[0.1] bg-gray-50/70 dark:bg-white/[0.02] p-4 text-center">
          <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed">
            {allMilestones.length > 0
              ? 'Você já marcou todos os avisos de hoje como vistos. Que bom ter tudo organizado.'
              : 'Por enquanto não há compromissos marcados para daqui a 7, 3 ou 1 dia. Quando algum se aproximar, avisaremos você aqui.'}
          </p>
        </div>
      )}
    </section>
  );

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Notificações e Alertas" usePortal>
      <div className="space-y-5 pb-2">
        {/* Acolhimento inicial e explicação simples */}
        <div className="rounded-2xl bg-indigo-50/75 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-800/40 p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-300 flex items-center justify-center shrink-0 mt-0.5">
            <Heart className="w-4 h-4" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100 leading-snug">
              Lembretes para cuidar com mais leveza
            </p>
            <p className="text-xs text-gray-600 dark:text-zinc-300 leading-relaxed">
              Sabemos que acompanhar cada horário no dia a dia exige muita dedicação. Ative os
              avisos abaixo para receber lembretes carinhosos
              {patientName ? ` sobre ${patientName}` : ''}, mesmo com o aplicativo fechado.
            </p>
          </div>
        </div>

        {/* Se houver avisos de 7/3/1 dia pendentes, destacamos logo no início */}
        {activeMilestones.length > 0 && milestoneSection}

        {/* Passo a passo autoexplicativo */}
        <section aria-label="Notificações Web Push neste aparelho" className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
              Passo 1 · Ativar neste aparelho
            </h3>
            <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed">
              Autorize este celular ou computador a mostrar avisos na tela quando chegar a hora.
            </p>
          </div>

          {feedback && (
            <div
              className={`rounded-2xl p-3 border text-xs flex items-start gap-2 leading-relaxed ${
                feedback.type === 'error'
                  ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/50 text-rose-700 dark:text-rose-300'
                  : feedback.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-300'
                  : 'bg-slate-50 dark:bg-white/[0.04] border-slate-200 dark:border-white/[0.08] text-slate-700 dark:text-zinc-300'
              }`}
            >
              {feedback.type === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <span>{feedback.text}</span>
            </div>
          )}

          {needsStandaloneInstallForPush && (
            <div className="rounded-2xl bg-indigo-50/90 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/50 p-3.5 space-y-2.5">
              <div className="flex items-start gap-2.5">
                <Smartphone className="w-4 h-4 text-indigo-600 dark:text-indigo-300 shrink-0 mt-0.5" />
                <p className="text-xs text-indigo-950 dark:text-indigo-100 leading-relaxed">
                  No iPhone ou iPad, o sistema permite avisos na tela apenas quando o DUCA é aberto
                  pelo ícone salvo na sua Tela de Início. É rapidinho e deixa o acesso sempre à mão.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  openInstallGuideModal();
                }}
                className="w-full min-h-[42px] py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors"
              >
                Ver como adicionar à Tela de Início
              </button>
            </div>
          )}

          {/* Card de status + ativação */}
          <div className="rounded-2xl bg-gray-50/90 dark:bg-[#1a1a20] border border-gray-200/80 dark:border-white/[0.08] p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                    isDeviceSubscribed
                      ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                      : 'bg-gray-200/80 dark:bg-white/[0.08] text-gray-600 dark:text-zinc-300'
                  }`}
                >
                  {isDeviceSubscribed ? (
                    <Bell className="w-5 h-5" />
                  ) : (
                    <BellOff className="w-5 h-5" />
                  )}
                </div>
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                    {loadingSub
                      ? 'Verificando aparelho...'
                      : isDeviceSubscribed
                      ? 'Avisos ativos neste aparelho'
                      : 'Avisos desligados neste aparelho'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed">
                    {support.permission === 'denied'
                      ? 'Os avisos foram bloqueados neste navegador. Toque no cadeado ao lado do endereço do site, permita Notificações e toque em Ativar.'
                      : !support.supported || !support.hasVapidKey
                      ? 'Este navegador ainda não consegue enviar avisos com a tela bloqueada. Se puder, abra pelo Chrome, Edge ou pela Tela de Início.'
                      : isDeviceSubscribed
                      ? 'Tudo pronto! Você receberá os lembretes escolhidos abaixo com tranquilidade.'
                      : 'Toque no botão Ativar para autorizar os avisos neste celular ou computador.'}
                  </p>
                </div>
              </div>

              {isDeviceSubscribed ? (
                <button
                  type="button"
                  disabled={savingPush || loadingSub}
                  onClick={handleDisableDevicePush}
                  className="min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-[#121216] border border-gray-200 dark:border-white/[0.12] text-gray-700 dark:text-zinc-200 hover:bg-gray-100 dark:hover:bg-white/[0.08] disabled:opacity-50 shrink-0 transition-colors"
                >
                  {savingPush ? 'Salvando...' : 'Desativar'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={savingPush || loadingSub || needsStandaloneInstallForPush}
                  onClick={handleEnableDevicePush}
                  className="min-h-[42px] px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 shrink-0 transition-colors shadow-sm"
                >
                  {savingPush ? 'Ativando...' : 'Ativar'}
                </button>
              )}
            </div>

            {isDeviceSubscribed && (
              <div className="space-y-1.5 pt-1">
                <button
                  type="button"
                  disabled={sendingTest || savingPush}
                  onClick={handleSendTest}
                  className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-white dark:bg-[#121216] border border-gray-200 dark:border-white/[0.12] hover:bg-gray-100 dark:hover:bg-white/[0.08] text-xs font-semibold text-gray-800 dark:text-zinc-100 disabled:opacity-50 transition-colors"
                >
                  <Send className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span>{sendingTest ? 'Enviando teste...' : 'Enviar notificação de teste'}</span>
                </button>
                <p className="text-[11px] text-gray-500 dark:text-zinc-400 text-center">
                  Quer conferir se está chegando certinho? Envie um teste rápido agora.
                </p>
              </div>
            )}

            {/* Passo 2: O que deseja lembrar */}
            <div className="pt-3.5 border-t border-gray-200/70 dark:border-white/[0.08] space-y-2.5">
              <div className="space-y-0.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                  Passo 2 · O que você quer lembrar
                </p>
                <p className="text-[11px] text-gray-500 dark:text-zinc-400 leading-relaxed">
                  {isDeviceSubscribed
                    ? 'Cada opção marcada abaixo já fica salva automaticamente.'
                    : 'Você já pode escolher agora — elas passam a valer assim que você ativar o Passo 1.'}
                </p>
              </div>

              <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Pill className="w-4 h-4 text-indigo-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">
                      Medicamentos
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-zinc-400 leading-relaxed">
                      Lembramos nos horários dos períodos em que ainda faltam doses para registrar
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={preferences.notify_medications}
                  disabled={savingPush}
                  onChange={(e) =>
                    handleUpdatePreferences({ notify_medications: e.target.checked })
                  }
                  className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 shrink-0"
                />
              </label>

              <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Utensils className="w-4 h-4 text-emerald-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">
                      Horários de Refeição
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-zinc-400 leading-relaxed">
                      Aviso na hora de cada refeição, já mostrando o cardápio planejado
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={preferences.notify_meals}
                  disabled={savingPush}
                  onChange={(e) => handleUpdatePreferences({ notify_meals: e.target.checked })}
                  className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 shrink-0"
                />
              </label>

              <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer">
                <div className="flex items-center gap-2.5 min-w-0">
                  <CalendarClock className="w-4 h-4 text-amber-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">
                      Atividades Programadas
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-zinc-400 leading-relaxed">
                      Avisamos quando faltar 7 dias, 3 dias, 1 dia e no horário do compromisso
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={preferences.notify_activities}
                  disabled={savingPush}
                  onChange={(e) =>
                    handleUpdatePreferences({ notify_activities: e.target.checked })
                  }
                  className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 shrink-0"
                />
              </label>
            </div>

            {/* Passo 3: Antecedência */}
            <div className="pt-3.5 border-t border-gray-200/70 dark:border-white/[0.08] space-y-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Passo 3 · Quando prefere ser avisado</span>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-zinc-400 leading-relaxed">
                  Escolha entre receber na hora exata ou alguns minutinhos antes para se preparar com calma.
                </p>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                {LEAD_OPTIONS.map((opt) => {
                  const selected = preferences.lead_minutes === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={savingPush}
                      onClick={() => handleUpdatePreferences({ lead_minutes: opt.value })}
                      className={`min-h-[40px] py-2 px-2 rounded-xl text-xs font-medium border transition-colors ${
                        selected
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                          : 'bg-white dark:bg-[#121216] text-gray-700 dark:text-zinc-300 border-gray-200 dark:border-white/[0.1] hover:bg-gray-100 dark:hover:bg-white/[0.06]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Se não havia avisos ativos no topo, mostramos a seção de atividades abaixo da configuração */}
        {activeMilestones.length === 0 && milestoneSection}

        {/* Últimos avisos enviados (quando houver) */}
        {recentLogs.length > 0 && (
          <section aria-label="Últimas notificações enviadas" className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
              Últimos Avisos Enviados
            </h3>
            <div className="space-y-1.5">
              {recentLogs.slice(0, 4).map((log) => (
                <div
                  key={log.id}
                  className="rounded-xl px-3 py-2 bg-gray-50 dark:bg-white/[0.03] border border-gray-100 dark:border-white/[0.06]"
                >
                  <p className="text-xs font-semibold text-gray-800 dark:text-zinc-200">
                    {log.title}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-zinc-400 truncate">
                    {log.body}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Botão explícito e acessível de fechamento no rodapé */}
        <div className="pt-1">
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[48px] rounded-2xl bg-gray-100 dark:bg-[#1c1c22] hover:bg-gray-200 dark:hover:bg-[#26262e] text-sm font-semibold text-gray-800 dark:text-zinc-100 transition-colors active:scale-[0.99]"
          >
            Fechar
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
