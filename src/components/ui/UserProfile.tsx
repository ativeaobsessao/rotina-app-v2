// @ts-nocheck

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../services/supabase';
import { LogOut, Camera, Lock, UserPen, Users, Moon, Sun } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { FamilyModal } from './FamilyModal';
import { getCurrentProfile } from '../../services/api';

export function UserProfile() {
  const { theme, toggleTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showFamilyModal, setShowFamilyModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [updatingName, setUpdatingName] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadProfile();
    
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function loadProfile() {
    const p = await getCurrentProfile();
    if (p) {
      if (p.avatar_url) {
        // Just in case it's a full URL or a storage path. If it's a path, we'd need to sign it.
        // For avatars, a public bucket is best. Let's assume we use 'family-assets' bucket or just read it.
        // Let's get signed URL if it's a path.
        const { data } = await supabase.storage.from('patient-profile').createSignedUrl(p.avatar_url, 60 * 60 * 24);
        p.avatarUrlSigned = data?.signedUrl || p.avatar_url;
      }
      setProfile(p);
    }
  }

  const handleSignOut = () => {
    supabase.auth.signOut();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0 || !profile) return;
    const file = event.target.files[0];
    
    try {
      setUploading(true);
      
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `avatars/${profile.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('patient-profile')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: filePath } as any)
        .eq('id', profile.id);

      if (updateError) throw updateError;
      
      await loadProfile();
    } catch (error) {
      console.error('Error uploading avatar:', error);
      alert('Erro ao fazer upload da foto.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      alert('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    
    try {
      setUpdatingPassword(true);
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });
      
      if (error) throw error;
      
      alert('Senha atualizada com sucesso!');
      setShowPasswordModal(false);
      setNewPassword('');
    } catch (error) {
      console.error('Error updating password:', error);
      alert('Erro ao atualizar a senha. Tente novamente mais tarde.');
    } finally {
      setUpdatingPassword(false);
    }
  };


  const handleUpdateName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || newName.trim().length < 2) {
      alert('O nome deve ter pelo menos 2 caracteres.');
      return;
    }
    
    try {
      setUpdatingName(true);
      const { error } = await supabase
        .from('profiles')
        .update({ name: newName.trim() } as any)
        .eq('id', profile.id);
      
      if (error) throw error;
      
      await supabase.auth.updateUser({
        data: { full_name: newName.trim() }
      });
      
      alert('Nome atualizado com sucesso!');
      setShowNameModal(false);
      setNewName('');
      await loadProfile();
    } catch (error) {
      console.error('Error updating name:', error);
      alert('Erro ao atualizar o nome. Tente novamente mais tarde.');
    } finally {
      setUpdatingName(false);
    }
  };

  const getInitials = (name: string) => {
    return name ? name.charAt(0).toUpperCase() : '?';
  };

  return (
    <>
    <div className="relative" ref={dropdownRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-10 h-10 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden active:scale-95 transition-transform relative group"
      >
        {profile?.avatarUrlSigned ? (
          <img src={profile.avatarUrlSigned} alt={profile.name} className="w-full h-full object-cover" />
        ) : (
          <span className="font-semibold text-gray-600">{getInitials(profile?.name || '')}</span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900 truncate">{profile?.name || 'Carregando...'}</p>
            <p className="text-xs text-gray-500 truncate">{profile?.email}</p>
          </div>
          
          <button 
            onClick={() => { setIsOpen(false); setShowFamilyModal(true); }}
            className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 flex items-center transition-colors border-b border-gray-100"
          >
            <Users className="w-4 h-4 mr-2 text-gray-400" />
            Família e Convites
          </button>
          
          <button 
            onClick={() => { setIsOpen(false); setNewName(profile?.name || ''); setShowNameModal(true); }}
            className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 flex items-center transition-colors border-b border-gray-100"
          >
            <UserPen className="w-4 h-4 mr-2 text-gray-400" />
            Alterar nome
          </button>
          
          <button 
            onClick={() => { setIsOpen(false); setShowPasswordModal(true); }}
            className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 flex items-center transition-colors border-b border-gray-100"
          >
            <Lock className="w-4 h-4 mr-2 text-gray-400" />
            Alterar senha
          </button>
          
                    <button 
            onClick={() => { setIsOpen(false); toggleTheme(); }}
            className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 flex items-center transition-colors border-b border-gray-100"
          >
            {theme === 'light' ? <Moon className="w-4 h-4 mr-2 text-gray-400" /> : <Sun className="w-4 h-4 mr-2 text-gray-400" />}
            {theme === 'light' ? 'Modo Escuro' : 'Modo Claro'}
          </button>
          
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 flex items-center transition-colors"
          >
            <Camera className="w-4 h-4 mr-2 text-gray-400" />
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
            onClick={() => window.location.reload()}
            className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 flex items-center transition-colors border-b border-gray-100"
          >
            <Users className="w-4 h-4 mr-2 text-gray-400" />
            Trocar Paciente
          </button>
          
          <button 
            onClick={handleSignOut}
            className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 flex items-center transition-colors"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sair
          </button>
        </div>
      )}
    </div>


      {showFamilyModal && profile?.family_id && createPortal(
        <FamilyModal 
          familyId={profile.family_id} 
          currentUserId={profile.id}
          onClose={() => setShowFamilyModal(false)} 
        />,
        document.body
      )}
      
      {showNameModal && createPortal(
(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Alterar Nome</h3>
            <p className="text-sm text-gray-500 mb-6">
              Este é o nome que aparecerá nos registros de refeições e medicamentos.
            </p>
            <form onSubmit={handleUpdateName}>
              <input
                type="text"
                placeholder="Seu nome"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all outline-none mb-6"
                required
              />
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => { setShowNameModal(false); setNewName(''); }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-xl"
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
        </div>
      ),
        document.body
      )}
      {showPasswordModal && createPortal(
(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Alterar Senha</h3>
            <p className="text-sm text-gray-500 mb-6">
              Defina uma nova senha para o acesso desta família.
            </p>
            <form onSubmit={handleUpdatePassword}>
              <input
                type="password"
                placeholder="Nova senha (mín. 6 caracteres)"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all outline-none mb-6"
                required
              />
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => { setShowPasswordModal(false); setNewPassword(''); }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-xl"
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
        </div>
      ),
        document.body
      )}
    </>
  );
}
