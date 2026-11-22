import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../services/supabase';
import { LogOut, Camera, Lock, UserPen, Users, Moon, Sun, Download, Bell } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { FamilyModal } from './FamilyModal';
import { OPEN_NOTIFICATIONS_EVENT } from '../notifications/NotificationBell';
import { getCurrentProfile, getPatient, clearAllUserCaches } from '../../services/api';
import { clearActiveMealRecovery } from '../../services/mealDrafts';
import { compressImage } from '../../utils/image';

export function UserProfile() {
  const { theme, toggleTheme } = useTheme();
  const { isRunningStandalone, isInstalled, openInstallGuideModal } = usePWAInstall();
  const [isOpen, setIsOpen] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showFamilyModal, setShowFamilyModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<{
    type: 'error' | 'success';
    text: string;
  } | null>(null);
  const [showNameModal, setShowNameModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [updatingName, setUpdatingName] = useState(false);
  const [nameFeedback, setNameFeedback] = useState<{
    type: 'error' | 'success';
    text: string;
  } | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMountedRef = useRef(true);
  const [lovedOneName, setLovedOneName] = useState<string>('');

  useEffect(() => {
    isMountedRef.current = true;
    loadProfile();

    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      isMountedRef.current = false;
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  async function loadProfile() {
    try {
      const p: any = await getCurrentProfile();
      if (!isMountedRef.current || !p) return;

      if (p.avatar_url) {
        const { data } = await supabase.storage
          .from('patient-profile')
          .createSignedUrl(p.avatar_url, 60 * 60 * 24);
        if (!isMountedRef.current) return;
        p.avatarUrlSigned = data?.signedUrl || null;
      }
      setProfile({ ...p });

      if (p.family_id) {
        const pat = await getPatient(p.family_id);
        if (isMountedRef.current && pat?.name) {
          setLovedOneName(pat.name);
        }
      }
    } catch (err) {
      console.warn('Error loading profile in UserProfile:', err);
    }
  }

  const handleSignOut = async () => {
    setIsOpen(false);
    clearActiveMealRecovery();
    await clearAllUserCaches();
    await supabase.auth.signOut();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0 || !profile) return;
    const file = event.target.files[0];
    event.target.value = '';
    setUploadError(null);

    try {
      setUploading(true);
      const compressed = await compressImage(file, 800);
      const fileName = `${Date.now()}.jpg`;
      const filePath = `avatars/${profile.id}/${fileName}`;

      const { error: uploadErr } = await supabase.storage
        .from('patient-profile')
        .upload(filePath, compressed, {
          upsert: true,
          contentType: 'image/jpeg',
        });

      if (uploadErr) throw uploadErr;

      const { error: updateError } = await (supabase as any)
        .from('profiles')
        .update({ avatar_url: filePath })
        .eq('id', profile.id);

      if (updateError) {
        await supabase.storage.from('patient-profile').remove([filePath]).catch(() => {});
        throw updateError;
      }

      if (profile.avatar_url && profile.avatar_url !== filePath) {
        await supabase.storage
          .from('patient-profile')
          .remove([profile.avatar_url])
          .catch(() => {});
      }

      await loadProfile();
    } catch (error: any) {
      console.error('Error uploading avatar:', error);
      if (isMountedRef.current) {
        setUploadError(error?.message || 'Erro ao fazer upload da foto.');
      }
    } finally {
      if (isMountedRef.current) setUploading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordFeedback(null);
    if (!newPassword || newPassword.length < 6) {
      setPasswordFeedback({
        type: 'error',
        text: 'A senha deve ter pelo menos 6 caracteres.',
      });
      return;
    }

    try {
      setUpdatingPassword(true);
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      if (!isMountedRef.current) return;
      setPasswordFeedback({ type: 'success', text: 'Senha atualizada com sucesso!' });
      setNewPassword('');
      setTimeout(() => {
        if (isMountedRef.current) {
          setShowPasswordModal(false);
          setPasswordFeedback(null);
        }
      }, 900);
    } catch (error: any) {
      console.error('Error updating password:', error);
      if (isMountedRef.current) {
        setPasswordFeedback({
          type: 'error',
          text: error?.message || 'Erro ao atualizar a senha. Tente novamente mais tarde.',
        });
      }
    } finally {
      if (isMountedRef.current) setUpdatingPassword(false);
    }
  };

  const handleUpdateName = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameFeedback(null);
    if (!newName || newName.trim().length < 2) {
      setNameFeedback({
        type: 'error',
        text: 'O nome deve ter pelo menos 2 caracteres.',
      });
      return;
    }

    try {
      setUpdatingName(true);
      const { error } = await (supabase as any)
        .from('profiles')
        .update({ name: newName.trim() })
        .eq('id', profile.id);

      if (error) throw error;

      await supabase.auth.updateUser({
        data: { full_name: newName.trim() },
      });

      if (!isMountedRef.current) return;
      setNameFeedback({ type: 'success', text: 'Nome atualizado com sucesso!' });
      setNewName('');
      await loadProfile();
      setTimeout(() => {
        if (isMountedRef.current) {
          setShowNameModal(false);
          setNameFeedback(null);
        }
      }, 900);
    } catch (error: any) {
      console.error('Error updating name:', error);
      if (isMountedRef.current) {
        setNameFeedback({
          type: 'error',
          text: error?.message || 'Erro ao atualizar o nome. Tente novamente mais tarde.',
        });
      }
    } finally {
      if (isMountedRef.current) setUpdatingName(false);
    }
  };

  const getInitials = (name: string) => {
    return name ? name.charAt(0).toUpperCase() : '?';
  };

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => {
            setUploadError(null);
            setIsOpen(!isOpen);
          }}
          className="w-10 h-10 rounded-full bg-gray-100 dark:bg-[#1c1c22] border border-gray-200 dark:border-white/[0.1] flex items-center justify-center overflow-hidden active:scale-95 transition-transform relative group"
          aria-label="Menu do usuário"
        >
          {profile?.avatarUrlSigned ? (
            <img
              src={profile.avatarUrlSigned}
              alt={profile.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="font-semibold text-gray-600 dark:text-zinc-200">
              {getInitials(profile?.name || '')}
            </span>
          )}
        </button>

        {isOpen && (
          <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-[#141419] rounded-xl shadow-lg dark:shadow-black/60 border border-gray-100 dark:border-white/[0.08] py-2 z-50 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-white/[0.08]">
              <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100 truncate">
                {profile?.name || 'Carregando...'}
              </p>
              <p className="text-xs text-gray-500 dark:text-zinc-400 truncate">{profile?.email}</p>
            </div>

            {uploadError && (
              <div className="mx-3 my-2 p-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
                {uploadError}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setShowFamilyModal(true);
              }}
              className="w-full text-left px-4 py-3 text-sm text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-white/[0.06] flex items-center transition-colors border-b border-gray-100 dark:border-white/[0.06]"
            >
              <Users className="w-4 h-4 mr-2 text-gray-400 dark:text-zinc-400" />
              Família e Convites
            </button>

            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                window.dispatchEvent(new Event(OPEN_NOTIFICATIONS_EVENT));
              }}
              className="w-full text-left px-4 py-3 text-sm text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-white/[0.06] flex items-center transition-colors border-b border-gray-100 dark:border-white/[0.06]"
            >
              <Bell className="w-4 h-4 mr-2 text-gray-400 dark:text-zinc-400" />
              Notificações e Alertas
            </button>

            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setNameFeedback(null);
                setNewName(profile?.name || '');
                setShowNameModal(true);
              }}
              className="w-full text-left px-4 py-3 text-sm text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-white/[0.06] flex items-center transition-colors border-b border-gray-100 dark:border-white/[0.06]"
            >
              <UserPen className="w-4 h-4 mr-2 text-gray-400 dark:text-zinc-400" />
              Alterar nome
            </button>

            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setPasswordFeedback(null);
                setNewPassword('');
                setShowPasswordModal(true);
              }}
              className="w-full text-left px-4 py-3 text-sm text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-white/[0.06] flex items-center transition-colors border-b border-gray-100 dark:border-white/[0.06]"
            >
              <Lock className="w-4 h-4 mr-2 text-gray-400 dark:text-zinc-400" />
              Alterar senha
            </button>

            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                toggleTheme();
              }}
              className="w-full text-left px-4 py-3 text-sm text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-white/[0.06] flex items-center transition-colors border-b border-gray-100 dark:border-white/[0.06]"
            >
              {theme === 'light' ? (
                <Moon className="w-4 h-4 mr-2 text-gray-400 dark:text-zinc-400" />
              ) : (
                <Sun className="w-4 h-4 mr-2 text-amber-400" />
              )}
              {theme === 'light' ? 'Modo Escuro' : 'Modo Claro'}
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full text-left px-4 py-3 text-sm text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-white/[0.06] flex items-center transition-colors border-b border-gray-100 dark:border-white/[0.06]"
            >
              <Camera className="w-4 h-4 mr-2 text-gray-400 dark:text-zinc-400" />
              {uploading ? 'Enviando...' : 'Trocar foto'}
            </button>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*"
              className="hidden"
            />

            <button
              type="button"
              onClick={() => {
                try {
                  sessionStorage.removeItem('duca_context_selected');
                  localStorage.removeItem('duca_active_flow_until');
                  clearActiveMealRecovery();
                } catch {}
                window.location.reload();
              }}
              className="w-full text-left px-4 py-3 text-sm text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-white/[0.06] flex items-center transition-colors border-b border-gray-100 dark:border-white/[0.06]"
            >
              <Users className="w-4 h-4 mr-2 text-gray-400 dark:text-zinc-400" />
              Trocar Familiar
            </button>

            {!isRunningStandalone && (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  openInstallGuideModal();
                }}
                className="w-full text-left px-4 py-3 text-sm text-indigo-700 dark:text-indigo-300 font-medium hover:bg-indigo-50/70 dark:hover:bg-indigo-950/40 flex items-center transition-colors border-b border-gray-100 dark:border-white/[0.06]"
              >
                <Download className="w-4 h-4 mr-2 text-indigo-600 dark:text-indigo-400" />
                {isInstalled ? 'Como abrir no aplicativo' : 'Baixar aplicativo'}
              </button>
            )}

            <button
              type="button"
              onClick={handleSignOut}
              className="w-full text-left px-4 py-3 text-sm text-red-600 dark:text-rose-400 hover:bg-red-50 dark:hover:bg-rose-950/30 flex items-center transition-colors"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sair
            </button>
          </div>
        )}
      </div>

      {showFamilyModal &&
        profile?.family_id &&
        createPortal(
          <FamilyModal
            familyId={profile.family_id}
            currentUserId={profile.id}
            lovedOneName={lovedOneName}
            onClose={() => setShowFamilyModal(false)}
          />,
          document.body
        )}

      {showNameModal &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 dark:bg-black/75 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-[#121216] dark:border dark:border-white/[0.08] rounded-2xl p-6 w-full max-w-sm shadow-xl">
              <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100 mb-2">
                Alterar Nome
              </h3>
              <p className="text-sm text-gray-500 dark:text-zinc-400 mb-4">
                Este é o nome que aparecerá nos registros de refeições e medicamentos.
              </p>

              {nameFeedback && (
                <div
                  className={`mb-4 p-3 rounded-xl text-xs ${
                    nameFeedback.type === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                      : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                  }`}
                >
                  {nameFeedback.text}
                </div>
              )}

              <form onSubmit={handleUpdateName}>
                <input
                  type="text"
                  placeholder="Seu nome"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-white/[0.1] bg-white dark:bg-[#1c1c22] text-gray-900 dark:text-zinc-100 placeholder:text-gray-400 dark:placeholder:text-zinc-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-500/30 transition-all outline-none mb-6"
                  required
                />
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowNameModal(false);
                      setNewName('');
                      setNameFeedback(null);
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] rounded-xl"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={updatingName}
                    className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50"
                  >
                    {updatingName ? 'Salvando...' : 'Salvar Nome'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {showPasswordModal &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 dark:bg-black/75 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-[#121216] dark:border dark:border-white/[0.08] rounded-2xl p-6 w-full max-w-sm shadow-xl">
              <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100 mb-2">
                Alterar Senha
              </h3>
              <p className="text-sm text-gray-500 dark:text-zinc-400 mb-4">
                Defina uma nova senha para o acesso desta família.
              </p>

              {passwordFeedback && (
                <div
                  className={`mb-4 p-3 rounded-xl text-xs ${
                    passwordFeedback.type === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                      : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                  }`}
                >
                  {passwordFeedback.text}
                </div>
              )}

              <form onSubmit={handleUpdatePassword}>
                <input
                  type="password"
                  placeholder="Nova senha (mín. 6 caracteres)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-white/[0.1] bg-white dark:bg-[#1c1c22] text-gray-900 dark:text-zinc-100 placeholder:text-gray-400 dark:placeholder:text-zinc-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-500/30 transition-all outline-none mb-6"
                  required
                />
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowPasswordModal(false);
                      setNewPassword('');
                      setPasswordFeedback(null);
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] rounded-xl"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={updatingPassword}
                    className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50"
                  >
                    {updatingPassword ? 'Salvando...' : 'Salvar Senha'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
