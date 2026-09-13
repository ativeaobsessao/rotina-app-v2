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

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [needsContextSelection, setNeedsContextSelection] = useState(false);
  const [isRecoveringPassword, setIsRecoveringPassword] = useState(false);
  const [initialPatients, setInitialPatients] = useState<any[] | null>(null);
  const hasCheckedContextRef = useRef(false);
  const [currentTab, setCurrentTab] = useState<'today' | 'history' | 'routine'>('today');
  const [editingDateStr, setEditingDateStr] = useState<string | null>(null);

  useEffect(() => {
    // Check existing session on mount
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      setSession(s);
      // We don't check for recovery in getSession directly, we rely on the hash event or auth listener
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
      }
      setSession(s);
      if (s && _event !== 'PASSWORD_RECOVERY') {
        await checkPatient();
      } else if (!s) {
        setNeedsSetup(false);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function checkPatient() {
    try {
      const pendingInvite = localStorage.getItem('pending_invite');
      if (pendingInvite) {
        localStorage.removeItem('pending_invite');
        window.location.href = `/invite/${pendingInvite}`;
        return;
      }

      if (!hasCheckedContextRef.current) {
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
      setNeedsSetup(true);
    } finally {
      setLoading(false);
    }
  }

  const pathname = window.location.pathname;
  if (pathname.startsWith('/invite/')) {
    const token = pathname.split('/')[2];
    if (token) {
      return <InviteScreen token={token} />;
    }
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

  if (needsContextSelection) {
    return (
      <ContextSelectorScreen 
        initialPatients={initialPatients || undefined}
        onSelect={() => {
          setNeedsContextSelection(false);
          hasCheckedContextRef.current = true;
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
