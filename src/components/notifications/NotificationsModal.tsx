import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Bell,
  BellOff,
  CalendarClock,
  Check,
  Clock,
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
        text: err?.message || 'Não foi possível carregar as configurações de notificação.',
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
      setFeedback({ type: 'error', text: 'Selecione uma família antes de ativar notificações.' });
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
        text: 'Notificações Web Push ativadas neste aparelho.',
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Não foi possível ativar as notificações neste aparelho.',
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
        text: 'Notificações desativadas neste aparelho.',
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Erro ao desativar notificações.',
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
        text: err?.message || 'Não foi possível salvar a preferência.',
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
        text: err?.message || 'Não foi possível enviar a notificação de teste.',
      });
    } finally {
      setSendingTest(false);
    }
  };

  const isDeviceSubscribed = Boolean(activeSub && activeSub.enabled);

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Notificações e Alertas">
      <div className="space-y-6 pb-4">
        {/* Seção 1: Avisos antecipados exatos (7, 3 e 1 dia) para atividades programadas */}
        <section aria-label="Atividades programadas em 7, 3 e 1 dia" className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                Atividades Programadas
              </h3>
              <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">
                Avisos automáticos quando faltam 7 dias, 3 dias e 1 dia
              </p>
            </div>
            {activeMilestones.length > 0 && (
              <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/50 tabular-nums">
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
              <p className="text-xs text-gray-500 dark:text-zinc-400">
                {allMilestones.length > 0
                  ? 'Todos os avisos de 7, 3 e 1 dia de hoje já foram marcados como vistos.'
                  : 'Nenhuma atividade programada para exatamente 7, 3 ou 1 dia a partir de hoje.'}
              </p>
            </div>
          )}
        </section>

        {/* Seção 2: Web Push Notifications neste aparelho */}
        <section aria-label="Notificações Web Push neste aparelho" className="space-y-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
              Web Push no Aparelho
            </h3>
            <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">
              Receba alertas mesmo com o aplicativo fechado
              {patientName ? ` · ${patientName}` : ''}
            </p>
          </div>

          {feedback && (
            <div
              className={`rounded-2xl p-3 border text-xs flex items-start gap-2 ${
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
                  No iPhone ou iPad, as notificações Web Push funcionam apenas quando o DUCA é aberto pelo ícone instalado na Tela de Início.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  openInstallGuideModal();
                }}
                className="w-full py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors"
              >
                Ver como adicionar à Tela de Início
              </button>
            </div>
          )}

          {/* Card de status e ativação do aparelho */}
          <div className="rounded-2xl bg-gray-50/90 dark:bg-[#1a1a20] border border-gray-200/80 dark:border-white/[0.08] p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
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
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                    {loadingSub
                      ? 'Verificando aparelho...'
                      : isDeviceSubscribed
                      ? 'Notificações ativas aqui'
                      : 'Notificações desativadas'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-zinc-400">
                    {support.permission === 'denied'
                      ? 'Permissão bloqueada nas configurações do navegador.'
                      : !support.hasVapidKey
                      ? 'Configure VITE_VAPID_PUBLIC_KEY para ativar disparos push.'
                      : isDeviceSubscribed
                      ? 'Este aparelho receberá alertas programados via Supabase.'
                      : 'Toque ao lado para autorizar avisos neste aparelho.'}
                  </p>
                </div>
              </div>

              {isDeviceSubscribed ? (
                <button
                  type="button"
                  disabled={savingPush || loadingSub}
                  onClick={handleDisableDevicePush}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-[#121216] border border-gray-200 dark:border-white/[0.12] text-gray-700 dark:text-zinc-200 hover:bg-gray-100 dark:hover:bg-white/[0.08] disabled:opacity-50 shrink-0 transition-colors"
                >
                  {savingPush ? 'Salvando...' : 'Desativar'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={savingPush || loadingSub || needsStandaloneInstallForPush}
                  onClick={handleEnableDevicePush}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 shrink-0 transition-colors shadow-sm"
                >
                  {savingPush ? 'Ativando...' : 'Ativar'}
                </button>
              )}
            </div>

            {/* Preferências por categoria */}
            <div className="pt-3 border-t border-gray-200/70 dark:border-white/[0.08] space-y-2.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                O que notificar
              </p>

              <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Pill className="w-4 h-4 text-indigo-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">
                      Medicamentos
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-zinc-400">
                      Horários dos períodos com doses pendentes
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
                  className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
              </label>

              <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Utensils className="w-4 h-4 text-emerald-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">
                      Horários de Refeição
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-zinc-400">
                      Lembrete no horário + cardápio programado
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={preferences.notify_meals}
                  disabled={savingPush}
                  onChange={(e) => handleUpdatePreferences({ notify_meals: e.target.checked })}
                  className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
              </label>

              <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer">
                <div className="flex items-center gap-2.5 min-w-0">
                  <CalendarClock className="w-4 h-4 text-amber-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">
                      Atividades Programadas
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-zinc-400">
                      Faltando 7 dias, 3 dias, 1 dia e no horário do dia
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
                  className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
              </label>
            </div>

            {/* Antecedência */}
            <div className="pt-3 border-t border-gray-200/70 dark:border-white/[0.08] space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                <Clock className="w-3.5 h-3.5" />
                <span>Antecedência dos horários</span>
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
                      className={`py-2 px-2 rounded-xl text-xs font-medium border transition-colors ${
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

            {isDeviceSubscribed && (
              <div className="pt-2">
                <button
                  type="button"
                  disabled={sendingTest || savingPush}
                  onClick={handleSendTest}
                  className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-white dark:bg-[#121216] border border-gray-200 dark:border-white/[0.12] hover:bg-gray-100 dark:hover:bg-white/[0.08] text-xs font-semibold text-gray-800 dark:text-zinc-100 disabled:opacity-50 transition-colors"
                >
                  <Send className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span>{sendingTest ? 'Enviando teste...' : 'Enviar notificação de teste'}</span>
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Últimos disparos registrados no servidor (opcional, quando houver) */}
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
      </div>
    </BottomSheet>
  );
}
