import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { acceptFamilyInvite } from '../services/api';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';
import { CheckCircle2, UserPlus } from 'lucide-react';

export function InviteScreen({ token }: { token: string }) {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      
      // If we are logged in AND we just came from a signup flow (pending_invite exists),
      // we can automatically accept it.
      const pending = localStorage.getItem('pending_invite');
      if (s && pending === token) {
         localStorage.removeItem('pending_invite');
         handleAccept();
      } else {
         setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => subscription.unsubscribe();
  }, [token]);

  async function handleAccept() {
    setAccepting(true);
    setError('');
    
    try {
      await acceptFamilyInvite(token);
      setSuccess(true);
      
      // After 2 seconds, automatically go to the app
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
      
    } catch (err: any) {
      let msg = err.message || 'Não foi possível concluir esta ação. Tente novamente.';
      const lower = msg.toLowerCase();
      if (lower.includes('expirado')) msg = 'Este convite expirou. Peça ao administrador da família para gerar um novo.';
      else if (lower.includes('revogado') || lower.includes('utilizado')) msg = 'Este convite não está mais disponível ou já foi utilizado.';
      else if (lower.includes('inválido') || lower.includes('encontrado')) msg = 'Este convite não está mais disponível ou é inválido.';
      else if (lower.includes('já pertence')) msg = 'Você já faz parte desta família.';
      
      setError(msg);
    } finally {
      setAccepting(false);
      setLoading(false);
    }
  }

  function handleAction() {
    if (!session) {
      // Redirect to create account
      localStorage.setItem('pending_invite', token);
      window.location.href = '/';
    } else {
      // Already logged in, just accept
      handleAccept();
    }
  }

  function cancel() {
    localStorage.removeItem('pending_invite');
    window.location.href = '/';
  }

  if (loading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-gray-50">
        <Spinner className="w-10 h-10 text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-gray-50 items-center justify-center p-6 sm:p-12">
      <div className="w-full max-w-md bg-white p-8 sm:p-10 rounded-[2rem] shadow-xl border border-gray-100/50 text-center relative overflow-hidden">
        
        {success ? (
          <div className="flex flex-col items-center animate-in fade-in zoom-in duration-500">
            <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mb-6 border border-green-100 shadow-sm">
              <CheckCircle2 className="w-10 h-10 text-green-500" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Convite aceito!</h1>
            <p className="text-gray-500 mt-3 font-medium">
              Tudo certo. Redirecionando para o painel...
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mb-6 border border-indigo-100 shadow-sm">
              <UserPlus className="w-10 h-10 text-indigo-600" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Aceitar convite</h1>
            <p className="text-gray-500 mt-3 text-sm sm:text-base mb-8 max-w-xs mx-auto">
              Você foi convidado para acompanhar um paciente e visualizar sua rotina.
            </p>
            
            {error && (
              <div className="text-red-600 text-sm font-medium bg-red-50 p-4 rounded-2xl mb-8 w-full border border-red-100">
                {error}
              </div>
            )}
            
            <div className="w-full space-y-3">
              <Button 
                className="w-full py-6 text-lg font-bold rounded-2xl shadow-lg active:scale-95 transition-all" 
                onClick={handleAction} 
                disabled={accepting}
              >
                {accepting ? <Spinner className="text-white" /> : 'Aceitar convite'}
              </Button>
              <Button 
                variant="ghost" 
                className="w-full py-4 text-base font-medium rounded-2xl text-gray-500 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 transition-colors" 
                onClick={cancel}
                disabled={accepting}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
