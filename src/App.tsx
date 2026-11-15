import React, { useEffect, useState, useRef } from 'react';
import { supabase } from './services/supabase';
import { getPatient, getCurrentProfile, getPatientPhotoUrl } from './services/api';
import { LoginScreen } from './pages/Login';
const TodayScreen = React.lazy(() => import('./pages/Today').then(m => ({ default: m.TodayScreen })));
const RoutineScreen = React.lazy(() => import('./pages/Routine').then(m => ({ default: m.RoutineScreen })));
const SetupScreen = React.lazy(() => import('./pages/Setup').then(m => ({ default: m.SetupScreen })));
const HistoryScreen = React.lazy(() => import('./pages/History').then(m => ({ default: m.HistoryScreen })));

import { InviteScreen } from './pages/InviteScreen';
import { ContextSelectorScreen } from './pages/ContextSelector';
import { ResetPasswordScreen } from './pages/ResetPassword';
import { getMyFamilyMemberships } from './services/api';

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

export default function App() {
  // Synchronous cache checks to render ContextSelector immediately on tap
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
    // Check if supabase auth session exists in localStorage
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

  // If we already know the user has cached patients (and isn't returning from camera/active session), show ContextSelector immediately
  const [loading, setLoading] = useState(!cachedPatients && !restoredContext);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [needsContextSelection, setNeedsContextSelection] = useState(!!cachedPatients && !restoredContext);
  const [isRecoveringPassword, setIsRecoveringPassword] = useState(false);
  const [initialPatients, setInitialPatients] = useState<any[] | null>(cachedPatients);
  const hasCheckedContextRef = useRef(restoredContext);
  const lastUserIdRef = useRef<string | null>(null);
  const [currentTab, setCurrentTab] = useState<'today' | 'history' | 'routine'>('today');
  const [editingDateStr, setEditingDateStr] = useState<string | null>(null);

  const { token: urlInviteToken, isAuthFlow: isInviteAuthFlow } = getInviteStateFromUrl();

  useEffect(() => {
    // Check existing session on mount
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
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

    // Listen for auth state changes (login / logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (_event === 'PASSWORD_RECOVERY') {
        setIsRecoveringPassword(true);
        setSession(s);
        return;
      }

      // Nunca reinicia a tela nem volta ao ContextSelector quando o token apenas é renovado
      // (isso acontecia ao voltar da câmera do celular ou alternar abas)
      if (_event === 'TOKEN_REFRESHED' || _event === 'USER_UPDATED' || _event === 'INITIAL_SESSION') {
        setSession(prev => (prev?.access_token === s?.access_token ? prev : s));
        return;
      }

      if (_event === 'SIGNED_OUT' || !s) {
        try {
          sessionStorage.removeItem('duca_context_selected');
          localStorage.removeItem('duca_active_flow_until');
        } catch {}
        hasCheckedContextRef.current = false;
        lastUserIdRef.current = null;
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
      const isSameActiveUser = lastUserIdRef.current && incomingUserId === lastUserIdRef.current && hasCheckedContextRef.current;
      lastUserIdRef.current = incomingUserId;
      setSession(s);

      // Se o mesmo usuário já está dentro do acompanhamento (ex: retornou do app da câmera), não re-executa checkPatient()
      if (!isSameActiveUser) {
        await checkPatient();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function checkPatient() {
    try {
      const pendingInvite = localStorage.getItem('pending_invite')?.trim();
      if (pendingInvite) {
        window.location.replace(`/?invite=${encodeURIComponent(pendingInvite)}`);
        return;
      }

      if (!hasCheckedContextRef.current && !hasActiveSelectedContext()) {
        const [prof, memberships] = await Promise.all([
          getCurrentProfile(),
          getMyFamilyMemberships()
        ]);
        
        if (!prof || memberships.length === 0) {
          setNeedsSetup(true);
          hasCheckedContextRef.current = true;
          setLoading(false);
          return;
        }

        // Prefetch heavy routes in background
        import('./pages/Today');
        import('./pages/Routine');
        import('./pages/History');

        // Resolve patients for ContextSelector instantly
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
              gender: pat.gender
            };
          })
        );
        const loadedPatients = loadedPatientsUnfiltered.filter((p) => p !== null) as any;
        const uniquePatients = Array.from(new Map(loadedPatients.map((p: any) => [p.id, p])).values());
        
        try {
          localStorage.setItem('duca_cached_context_patients', JSON.stringify(uniquePatients));
        } catch {}

        setInitialPatients(uniquePatients);
        setNeedsContextSelection(true);
        setLoading(false);
        return;
      }

      const prof = await getCurrentProfile();
      if (!prof) {
        setNeedsSetup(true);
        setLoading(false);
        return;
      }
      
      const pat = await getPatient(prof.family_id);
      setNeedsSetup(!pat);
      
      // Prefetch heavy routes in background
      import('./pages/Today');
      import('./pages/Routine');
      import('./pages/History');
      
    } catch (err) {
      console.error('Error checking patient:', err);
      // Não força Setup se já tínhamos um contexto selecionado ativo (evita perder tela por falha momentânea de rede após câmera)
      if (!hasCheckedContextRef.current) {
        setNeedsSetup(true);
      }
    } finally {
      setLoading(false);
    }
  }

  if (urlInviteToken) {
    if (isInviteAuthFlow && urlInviteToken !== '__INVALID__') {
      if (!session) {
        return <LoginScreen inviteToken={urlInviteToken} />;
      }
      return (
        <div className="flex h-[100dvh] items-center justify-center bg-gray-50">
          <div className="w-8 h-8 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
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
      <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-gray-950 transition-colors"></div>
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
    return <React.Suspense fallback={
      <div className="flex h-[100dvh] items-center justify-center bg-gray-50 dark:bg-gray-950 transition-colors"></div>
    }>
      <SetupScreen onComplete={() => { setNeedsSetup(false); setCurrentTab('routine'); }} />
    </React.Suspense>;
  }

  if (currentTab === 'routine') {
    return <React.Suspense fallback={
      <div className="flex h-[100dvh] items-center justify-center bg-gray-50 dark:bg-gray-950 transition-colors"></div>
    }>
      <RoutineScreen onTabChange={setCurrentTab} />
    </React.Suspense>;
  }
  
  if (currentTab === 'history') {
    return <React.Suspense fallback={
      <div className="flex h-[100dvh] items-center justify-center bg-gray-50 dark:bg-gray-950 transition-colors"></div>
    }>
      <HistoryScreen onTabChange={setCurrentTab} onEditPastDay={(dateStr) => { setEditingDateStr(dateStr); setCurrentTab('today'); }} />
    </React.Suspense>;
  }

  return <React.Suspense fallback={
      <div className="flex h-[100dvh] items-center justify-center bg-gray-50 dark:bg-gray-950 transition-colors"></div>
    }>
      <TodayScreen onTabChange={setCurrentTab} editingDateStr={editingDateStr} onClearEditDate={() => setEditingDateStr(null)} />
    </React.Suspense>;
}
