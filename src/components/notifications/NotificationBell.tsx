import React, { useEffect, useMemo, useState } from 'react';
import { Bell } from 'lucide-react';
import { getActivities } from '../../services/api';
import { DEFAULT_TIMEZONE, getLocalDateString } from '../../utils/date';
import {
  filterActiveMilestoneAlerts,
  getActivityMilestoneNotifications,
} from '../../utils/notifications';
import { NotificationsModal } from './NotificationsModal';

export const OPEN_NOTIFICATIONS_EVENT = 'duca:open-notifications';

interface NotificationBellProps {
  familyId?: string | null;
  patientId?: string | null;
  patientName?: string | null;
  userId?: string | null;
  activities?: any[];
  todayDateStr?: string;
}

export function NotificationBell({
  familyId,
  patientId,
  patientName,
  userId,
  activities,
  todayDateStr,
}: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [fallbackActivities, setFallbackActivities] = useState<any[]>([]);
  const effectiveToday = todayDateStr || getLocalDateString(DEFAULT_TIMEZONE);

  useEffect(() => {
    const handleOpenEvent = () => setIsOpen(true);
    window.addEventListener(OPEN_NOTIFICATIONS_EVENT, handleOpenEvent);
    return () => window.removeEventListener(OPEN_NOTIFICATIONS_EVENT, handleOpenEvent);
  }, []);

  useEffect(() => {
    if (activities !== undefined || !patientId) return;
    let active = true;
    getActivities(patientId)
      .then((rows) => {
        if (active) setFallbackActivities(rows || []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [activities, patientId]);

  const effectiveActivities = activities !== undefined ? activities : fallbackActivities;

  const unreadCount = useMemo(() => {
    if (!Array.isArray(effectiveActivities) || effectiveActivities.length === 0) return 0;
    const alerts = getActivityMilestoneNotifications(effectiveActivities, effectiveToday);
    return (
      filterActiveMilestoneAlerts(alerts, userId, patientId).length +
      (refreshTick < 0 ? 0 : 0)
    );
  }, [effectiveActivities, effectiveToday, userId, patientId, refreshTick]);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="Notificações e alertas"
        title="Notificações e alertas"
        className="relative w-10 h-10 rounded-full bg-gray-100 dark:bg-[#1c1c22] border border-gray-200 dark:border-white/[0.1] flex items-center justify-center text-gray-700 dark:text-zinc-200 hover:bg-gray-200/70 dark:hover:bg-[#26262e] active:scale-95 transition-all shrink-0"
      >
        <Bell className="w-[18px] h-[18px]" />
        {unreadCount > 0 && (
          <span
            aria-label={`${unreadCount} alertas pendentes`}
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center shadow-sm border-2 border-white dark:border-[#111115] tabular-nums"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <NotificationsModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        familyId={familyId}
        patientId={patientId}
        patientName={patientName}
        userId={userId}
        activities={activities}
        todayDateStr={effectiveToday}
        onAlertsChanged={() => setRefreshTick((t) => t + 1)}
      />
    </>
  );
}
