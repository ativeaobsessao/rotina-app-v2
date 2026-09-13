import React, { useState } from 'react';
import { supabase } from '../services/supabase';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Spinner } from '../components/ui/Spinner';

export function LoginScreen() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);

    if (isForgotPassword) {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin
      });

      if (resetError) {
        setError('Erro ao solicitar recuperação. Verifique o e-mail digitado.');
      } else {
        setSuccessMsg('Se este e-mail estiver cadastrado, você receberá um link de recuperação em instantes.');
      }
      setLoading(false);
      return;
    }

    if (isSignUp) {
      if (!name) {
        setError('Por favor, informe seu nome.');
        setLoading(false);
        return;
      }
      const { error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name,
          }
        }
      });

      if (authError) {
        setError(authError.message || 'Não foi possível criar a conta.');
      } else {
        setSuccessMsg('Conta criada! Você já pode entrar.');
        setIsSignUp(false);
      }
    } else {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError('Não foi possível entrar. Verifique seu e-mail e senha.');
      }
    }
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-6 py-12">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">DUDE</h1>
          <div className="mt-8 mx-auto h-32 w-32 overflow-hidden rounded-full border-4 border-white shadow-sm bg-gray-200 flex items-center justify-center">
            {/* Generic placeholder since we don't know the family yet */}
            <span className="text-4xl text-gray-400">👵</span>
          </div>
          <h2 className="mt-4 text-xl font-semibold text-gray-900">
            {isForgotPassword ? 'Recuperar Senha' : (isSignUp ? 'Criar Nova Conta' : 'Entrar na Família')}
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            {isForgotPassword ? 'Enviaremos um link para redefinir sua senha' : (isSignUp ? 'Cadastre-se para começar' : 'Como está a vó hoje?')}
          </p>
        </div>

        <form className="space-y-6" onSubmit={handleLogin}>
          {error && (
            <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}
          {successMsg && (
            <div className="rounded-xl bg-green-50 p-4 text-sm text-green-700">
              {successMsg}
            </div>
          )}
          
          <div className="space-y-4">
            {!isForgotPassword && isSignUp && (
              <Input
                type="text"
                placeholder="Seu nome"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required={isSignUp}
              />
            )}
            <Input
              type="email"
              placeholder="Seu e-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            {!isForgotPassword && (
              <Input
                type="password"
                placeholder="Sua senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            )}
          </div>

          <Button 
            type="submit" 
            className="w-full" 
            disabled={loading}
          >
            {loading ? <Spinner className="text-white" /> : (isForgotPassword ? 'Enviar link' : (isSignUp ? 'Criar conta' : 'Entrar'))}
          </Button>

          <div className="flex flex-col space-y-3 text-sm">
            {!isForgotPassword && !isSignUp && (
              <button
                type="button"
                onClick={() => {
                  setIsForgotPassword(true);
                  setError('');
                  setSuccessMsg('');
                }}
                className="text-indigo-600 hover:text-indigo-800 font-medium self-end -mt-4 mb-2"
              >
                Esqueceu a senha?
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (isForgotPassword) {
                  setIsForgotPassword(false);
                } else {
                  setIsSignUp(!isSignUp);
                }
                setError('');
                setSuccessMsg('');
              }}
              className="text-gray-500 hover:text-gray-900 font-medium"
            >
              {isForgotPassword 
                ? 'Voltar para o login' 
                : (isSignUp ? 'Já possui conta? Entre aqui' : 'Ainda não tem conta? Crie aqui')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
