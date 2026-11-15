import React, { useEffect, useState, useRef } from 'react';
import { supabase } from './services/supabase';
import {
  getPatient,
  getCurrentProfile,
  getPatientPhotoUrl,
  getMyFamilyMemberships,
  clearAllUserCaches,
} from './services/api';
import { LoginScreen } from './pages/Login';
import { InviteScreen } from './pages/InviteScreen';
import { ContextSelectorScreen } from './pages/ContextSelector';
import { ResetPasswordScreen } from './pages/ResetPassword';

const TodayScreen = React.lazy(() =>
  import('./pages/Today').then((m) => ({ default: m.TodayScreen }))
);
const RoutineScreen = React.lazy(() =>
  import('./pages/Routine').then((m) => ({ default: m.RoutineScreen }))
);
const SetupScreen = React.lazy(() =>
  import('./pages/Setup').then((m) => ({ default: m.SetupScreen }))
);
const HistoryScreen = React.lazy(() =>
  import('./pages/History').then((m) => ({ default: m.HistoryScreen }))
);

function hasActiveSelectedContext(): boolean {
  try {
    if (sessionStorage.getItem('duca_context_selected') === '1') return true;
    const activeUntil = Number(localStorage.getItem('duca_active_flow_until') || '0');
    if (activeUntil > Date.now()) {
      sessionStorage.setItem('duca_context_selected', '1');
      return true;
    }
  } catch {}
  return false;
}

function getInviteStateFromUrl(): { token: string | null; isAuthFlow: boolean } {
  try {
    const params = new URLSearchParams(window.location.search);
    const queryToken = params.get('invite')?.trim();
    const isAuthFlow = params.get('auth') === '1';
    if (queryToken) {
      return { token: queryToken, isAuthFlow };
    }

    const pathname = window.location.pathname;
    if (pathname.startsWith('/invite/')) {
      const pathToken = pathname.split('/')[2]?.trim();
      return { token: pathToken || '__INVALID__', isAuthFlow };
    }
    if (pathname === '/invite') {
      return { token: '__INVALID__', isAuthFlow };
    }
  } catch {}
  return { token: null, isAuthFlow: false };
}

function clearLocalContextState() {
  try {
    sessionStorage.removeItem('duca_context_selected');
    localStorage.removeItem('duca_active_flow_until');
    localStorage.removeItem('duca_cached_context_moods');
    localStorage.removeItem('duca_cached_context_patients');
  } catch {}
}

export default function App() {
  const cachedPatients = (() => {
    try {
      const stored = localStorage.getItem('duca_cached_context_patients');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return null;
  })();

  const [session, setSession] = useState<any>(() => {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('sb-') || key.includes('auth-token')) && key.endsWith('-auth-token')) {
          const item = localStorage.getItem(key);
          if (item) {
            const parsed = JSON.parse(item);
            if (parsed && (parsed.access_token || parsed.currentSession)) return parsed;
          }
        }
      }
    } catch {}
    return null;
  });

  const restoredContext = hasActiveSelectedContext();

  const [loading, setLoading] = useState(!cachedPatients && !restoredContext);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [needsContextSelection, setNeedsContextSelection] = useState(
    !!cachedPatients && !restoredContext
  );
  const [isRecoveringPassword, setIsRecoveringPassword] = useState(false);
  const [initialPatients, setInitialPatients] = useState<any[] | null>(cachedPatients);
  const [currentTab, setCurrentTab] = useState<'today' | 'history' | 'routine'>('today');
  const [editingDateStr, setEditingDateStr] = useState<string | null>(null);

  const hasCheckedContextRef = useRef(restoredContext);
  const lastUserIdRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const checkSeqRef = useRef(0);
  const inFlightCheckRef = useRef<Promise<void> | null>(null);

  const { token: urlInviteToken, isAuthFlow: isInviteAuthFlow } = getInviteStateFromUrl();

  async function checkPatient() {
    if (inFlightCheckRef.current) {
      return inFlightCheckRef.current;
    }

    const reqSeq = ++checkSeqRef.current;
    const task = (async () => {
      try {
        const pendingInvite = localStorage.getItem('pending_invite')?.trim();
        if (pendingInvite) {
          window.location.replace(`/?invite=${encodeURIComponent(pendingInvite)}`);
          return;
        }

        if (!hasCheckedContextRef.current && !hasActiveSelectedContext()) {
          const [prof, memberships] = await Promise.all([
            getCurrentProfile(),
            getMyFamilyMemberships(),
          ]);

          if (!isMountedRef.current || reqSeq !== checkSeqRef.current) return;

          if (!prof || memberships.length === 0) {
            setNeedsSetup(true);
            hasCheckedContextRef.current = true;
            setLoading(false);
            return;
          }

          import('./pages/Today');
          import('./pages/Routine');
          import('./pages/History');

          const loadedPatientsUnfiltered = await Promise.all(
            memberships.map(async (m) => {
              const pat = await getPatient(m.family_id);
              if (!pat) return null;
              let picUrl = null;
              if (pat.photo_url) {
                picUrl = await getPatientPhotoUrl(pat.id, pat.photo_url);
              }
              return {
                id: pat.id,
                name: pat.name,
                photo: picUrl,
                familyId: m.family_id,
                gender: pat.gender,
              };
            })
          );

          if (!isMountedRef.current || reqSeq !== checkSeqRef.current) return;

          const loadedPatients = loadedPatientsUnfiltered.filter((p) => p !== null) as any[];
          const uniquePatients = Array.from(
            new Map(loadedPatients.map((p: any) => [p.id, p])).values()
          );

          try {
            localStorage.setItem('duca_cached_context_patients', JSON.stringify(uniquePatients));
          } catch {}

          setInitialPatients(uniquePatients);
          setNeedsContextSelection(true);
          setLoading(false);
          return;
        }

        const prof = await getCurrentProfile();
        if (!isMountedRef.current || reqSeq !== checkSeqRef.current) return;

        if (!prof) {
          setNeedsSetup(true);
          setLoading(false);
          return;
        }

        const pat = await getPatient(prof.family_id);
        if (!isMountedRef.current || reqSeq !== checkSeqRef.current) return;
        setNeedsSetup(!pat);

        import('./pages/Today');
        import('./pages/Routine');
        import('./pages/History');
      } catch (err) {
        console.error('Error checking patient:', err);
        if (isMountedRef.current && reqSeq === checkSeqRef.current && !hasCheckedContextRef.current) {
          setNeedsSetup(true);
        }
      } finally {
        if (isMountedRef.current && reqSeq === checkSeqRef.current) {
          setLoading(false);
        }
        inFlightCheckRef.current = null;
      }
    })();

    inFlightCheckRef.current = task;
    return task;
  }

  useEffect(() => {
    isMountedRef.current = true;

    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      if (!isMountedRef.current) return;
      setSession(s);
      lastUserIdRef.current = s?.user?.id || null;

      if (urlInviteToken) {
        if (s && isInviteAuthFlow && urlInviteToken !== '__INVALID__') {
          window.location.replace(`/?invite=${encodeURIComponent(urlInviteToken)}`);
          return;
        }
        setLoading(false);
        return;
      }

      if (s) {
        await checkPatient();
      } else {
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (!isMountedRef.current) return;

      if (_event === 'PASSWORD_RECOVERY') {
        setIsRecoveringPassword(true);
        setSession(s);
        return;
      }

      if (_event === 'TOKEN_REFRESHED' || _event === 'USER_UPDATED' || _event === 'INITIAL_SESSION') {
        setSession((prev: any) => (prev?.access_token === s?.access_token ? prev : s));
        return;
      }

      if (_event === 'SIGNED_OUT' || !s) {
        clearLocalContextState();
        await clearAllUserCaches();
        if (!isMountedRef.current) return;
        hasCheckedContextRef.current = false;
        lastUserIdRef.current = null;
        inFlightCheckRef.current = null;
        setInitialPatients(null);
        setSession(null);
        setNeedsSetup(false);
        setNeedsContextSelection(false);
        setLoading(false);
        return;
      }

      if (urlInviteToken) {
        setSession(s);
        if (isInviteAuthFlow && urlInviteToken !== '__INVALID__') {
          window.location.replace(`/?invite=${encodeURIComponent(urlInviteToken)}`);
        }
        return;
      }

      const incomingUserId = s.user?.id || null;
      const switchedUser =
        Boolean(lastUserIdRef.current) && incomingUserId !== lastUserIdRef.current;

      if (switchedUser) {
        clearLocalContextState();
        await clearAllUserCaches();
        if (!isMountedRef.current) return;
        hasCheckedContextRef.current = false;
        setInitialPatients(null);
        setNeedsContextSelection(false);
      }

      const isSameActiveUser =
        Boolean(lastUserIdRef.current) &&
        incomingUserId === lastUserIdRef.current &&
        hasCheckedContextRef.current;

      lastUserIdRef.current = incomingUserId;
      setSession(s);

      if (!isSameActiveUser) {
        await checkPatient();
      }
    });

    return () => {
      isMountedRef.current = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (urlInviteToken) {
    if (isInviteAuthFlow && urlInviteToken !== '__INVALID__') {
      if (!session) {
        return <LoginScreen inviteToken={urlInviteToken} />;
      }
      return (
        <div className="flex h-[100dvh] items-center justify-center bg-gray-50 dark:bg-[#09090b]">
          <div className="w-8 h-8 rounded-full border-4 border-indigo-200 dark:border-indigo-900 border-t-indigo-600 dark:border-t-indigo-400 animate-spin" />
        </div>
      );
    }
    return <InviteScreen token={urlInviteToken} />;
  }

  if (needsContextSelection) {
    return (
      <ContextSelectorScreen
        initialPatients={initialPatients || undefined}
        onSelect={() => {
          try {
            sessionStorage.setItem('duca_context_selected', '1');
          } catch {}
          setNeedsContextSelection(false);
          hasCheckedContextRef.current = true;
          setLoading(true);
          checkPatient();
        }}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-[#09090b] transition-colors" />
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  if (isRecoveringPassword) {
    return (
      <ResetPasswordScreen
        onComplete={() => {
          setIsRecoveringPassword(false);
          setLoading(true);
          checkPatient();
        }}
      />
    );
  }

  if (needsSetup) {
    return (
      <React.Suspense
        fallback={
          <div className="flex h-[100dvh] items-center justify-center bg-gray-50 dark:bg-[#09090b] transition-colors" />
        }
      >
        <SetupScreen
          onComplete={() => {
            setNeedsSetup(false);
            setCurrentTab('routine');
          }}
        />
      </React.Suspense>
    );
  }

  if (currentTab === 'routine') {
    return (
      <React.Suspense
        fallback={
          <div className="flex h-[100dvh] items-center justify-center bg-gray-50 dark:bg-[#09090b] transition-colors" />
        }
      >
        <RoutineScreen onTabChange={setCurrentTab} />
      </React.Suspense>
    );
  }

  if (currentTab === 'history') {
    return (
      <React.Suspense
        fallback={
          <div className="flex h-[100dvh] items-center justify-center bg-gray-50 dark:bg-[#09090b] transition-colors" />
        }
      >
        <HistoryScreen
          onTabChange={setCurrentTab}
          onEditPastDay={(dateStr) => {
            setEditingDateStr(dateStr);
            setCurrentTab('today');
          }}
        />
      </React.Suspense>
    );
  }

  return (
    <React.Suspense
      fallback={
        <div className="flex h-[100dvh] items-center justify-center bg-gray-50 dark:bg-[#09090b] transition-colors" />
      }
    >
      <TodayScreen
        onTabChange={setCurrentTab}
        editingDateStr={editingDateStr}
        onClearEditDate={() => setEditingDateStr(null)}
      />
    </React.Suspense>
  );
}
