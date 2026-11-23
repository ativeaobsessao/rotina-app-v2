import React, { useEffect, useState, useRef } from 'react';
import { supabase } from './services/supabase';
import {
  getPatient,
  getCurrentProfile,
  getMyFamilyMemberships,
  clearAllUserCaches,
} from './services/api';
import { LoginScreen } from './pages/Login';
import { InviteScreen } from './pages/InviteScreen';
import {
  ContextSelectorScreen,
  type SelectedContextPatient,
} from './pages/ContextSelector';
import { ResetPasswordScreen } from './pages/ResetPassword';
import { LaunchIntro } from './components/ui/LaunchIntro';
import {
  readActiveMealRecovery,
  clearActiveMealRecovery,
  cleanupExpiredMealDrafts,
} from './services/mealDrafts';

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
    if (readActiveMealRecovery()) {
      sessionStorage.setItem('duca_context_selected', '1');
      return true;
    }
  } catch {}
  return false;
}

function readCachedPatientsList(): SelectedContextPatient[] | null {
  try {
    const stored = localStorage.getItem('duca_cached_context_patients');
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
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
    clearActiveMealRecovery();
  } catch {}
}

export default function App() {
  const cachedPatients = readCachedPatientsList();

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

  const initialRecovery = readActiveMealRecovery();
  const [loading, setLoading] = useState(!cachedPatients && !restoredContext);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [needsContextSelection, setNeedsContextSelection] = useState(
    !!cachedPatients && !restoredContext
  );
  const [isRecoveringPassword, setIsRecoveringPassword] = useState(false);
  const [initialPatients, setInitialPatients] = useState<SelectedContextPatient[] | null>(
    cachedPatients
  );
  const [selectedPatientHint, setSelectedPatientHint] = useState<SelectedContextPatient | null>(
    null
  );
  const [currentTab, setCurrentTab] = useState<'today' | 'history' | 'routine'>(() =>
    initialRecovery?.tab === 'history' ? 'history' : 'today'
  );
  const [editingDateStr, setEditingDateStr] = useState<string | null>(
    () => initialRecovery?.editingDateStr || null
  );

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

          if (
            !isMountedRef.current ||
            reqSeq !== checkSeqRef.current ||
            hasCheckedContextRef.current ||
            hasActiveSelectedContext()
          ) {
            return;
          }

          if (!prof || memberships.length === 0) {
            setNeedsSetup(true);
            setNeedsContextSelection(false);
            hasCheckedContextRef.current = true;
            setLoading(false);
            return;
          }

          import('./pages/Today');
          import('./pages/Routine');
          import('./pages/History');

          const existingCached = readCachedPatientsList() || [];
          const cachedPhotoById = new Map<string, string | null>(
            existingCached.map((p) => [p.id, p.photo || null])
          );

          const loadedPatientsUnfiltered = await Promise.all(
            memberships.map(async (m) => {
              const pat = await getPatient(m.family_id);
              if (!pat) return null;
              return {
                id: pat.id,
                name: pat.name,
                photo: cachedPhotoById.get(pat.id) ?? null,
                familyId: m.family_id,
                gender: pat.gender || null,
              };
            })
          );

          // Se o usuário já tocou em algum card enquanto esta busca rodava, jamais volte para a seleção!
          if (
            !isMountedRef.current ||
            reqSeq !== checkSeqRef.current ||
            hasCheckedContextRef.current ||
            hasActiveSelectedContext()
          ) {
            return;
          }

          const loadedPatients = loadedPatientsUnfiltered.filter(
            (p) => p !== null
          ) as SelectedContextPatient[];
          const uniquePatients = Array.from(
            new Map(loadedPatients.map((p) => [p.id, p])).values()
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
        console.error('Error checking familiar:', err);
        if (
          isMountedRef.current &&
          reqSeq === checkSeqRef.current &&
          !hasCheckedContextRef.current &&
          !hasActiveSelectedContext()
        ) {
          setNeedsSetup(true);
        }
      } finally {
        if (reqSeq === checkSeqRef.current) {
          inFlightCheckRef.current = null;
          if (isMountedRef.current) {
            setLoading(false);
          }
        }
      }
    })();

    inFlightCheckRef.current = task;
    return task;
  }

  useEffect(() => {
    isMountedRef.current = true;
    void cleanupExpiredMealDrafts();

    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      if (!isMountedRef.current) return;
      setSession(s);
      lastUserIdRef.current = s?.user?.id || null;

      if (s?.user?.id && initialRecovery && initialRecovery.userId !== s.user.id) {
        setCurrentTab('today');
        setEditingDateStr(null);
      }

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
        setNeedsContextSelection(false);
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
        checkSeqRef.current += 1;
        inFlightCheckRef.current = null;
        setInitialPatients(null);
        setSelectedPatientHint(null);
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
        checkSeqRef.current += 1;
        inFlightCheckRef.current = null;
        setInitialPatients(null);
        setSelectedPatientHint(null);
        setNeedsContextSelection(false);
      }

      const contextAlreadyActive =
        hasCheckedContextRef.current || hasActiveSelectedContext();
      const isSameActiveUser =
        Boolean(lastUserIdRef.current) &&
        incomingUserId === lastUserIdRef.current &&
        contextAlreadyActive;

      lastUserIdRef.current = incomingUserId;
      setSession(s);

      if (!isSameActiveUser) {
        if (!contextAlreadyActive && !switchedUser) {
          const cached = readCachedPatientsList();
          if (cached) {
            setInitialPatients(cached);
            setNeedsContextSelection(true);
          } else {
            setLoading(true);
          }
        } else if (!contextAlreadyActive) {
          setLoading(true);
        }
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
      return <LaunchIntro message="Concluindo seu acesso..." />;
    }
    return <InviteScreen token={urlInviteToken} />;
  }

  if (needsContextSelection && session) {
    return (
      <ContextSelectorScreen
        initialPatients={initialPatients || undefined}
        onSelect={(chosenPatient) => {
          try {
            sessionStorage.setItem('duca_context_selected', '1');
          } catch {}
          hasCheckedContextRef.current = true;
          checkSeqRef.current += 1;
          inFlightCheckRef.current = null;
          if (chosenPatient) {
            setSelectedPatientHint(chosenPatient);
          }
          setNeedsSetup(false);
          setNeedsContextSelection(false);
          setLoading(false);
        }}
      />
    );
  }

  if (loading) {
    return <LaunchIntro />;
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
      <React.Suspense fallback={<LaunchIntro />}>
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
      <React.Suspense fallback={<LaunchIntro />}>
        <RoutineScreen onTabChange={setCurrentTab} />
      </React.Suspense>
    );
  }

  if (currentTab === 'history') {
    return (
      <React.Suspense fallback={<LaunchIntro />}>
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
    <React.Suspense fallback={<LaunchIntro />}>
      <TodayScreen
        onTabChange={setCurrentTab}
        editingDateStr={editingDateStr}
        onClearEditDate={() => setEditingDateStr(null)}
        initialPatientHint={selectedPatientHint}
      />
    </React.Suspense>
  );
}
