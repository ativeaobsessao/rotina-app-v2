import React, { useState, useEffect } from 'react';
import { X, Users, UserPlus, Trash2, Link, ShieldCheck, Shield, Check, HeartHandshake, Clock, RotateCw } from 'lucide-react';
import { Spinner } from './Spinner';
import { Button } from './Button';
import { Input } from './Input';
import type { FamilyMemberType } from '../../types/database.types';
import { 
  getFamilyMembers, 
  getFamilyInvites, 
  createFamilyInvite, 
  resendFamilyInvite,
  revokeFamilyInvite, 
  deleteFamilyInvite,
  clearFamilyInviteHistory,
  removeFamilyMember,
  updateFamilyMemberRole 
} from '../../services/api';

interface FamilyModalProps {
  familyId: string;
  currentUserId: string;
  lovedOneName?: string;
  onClose: () => void;
}

function formatShortDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR');
}

function isInviteExpired(invite: any): boolean {
  if (invite?.status === 'expired') return true;
  if (!invite?.expires_at) return false;
  const ts = new Date(invite.expires_at).getTime();
  return !Number.isNaN(ts) && ts < Date.now();
}

export function FamilyModal({ familyId, currentUserId, lovedOneName, onClose }: FamilyModalProps) {
  const [members, setMembers] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [isResendMode, setIsResendMode] = useState(false);
  const [invitedName, setInvitedName] = useState('');
  const [inviteMemberType, setInviteMemberType] = useState<FamilyMemberType>('FAMILY');
  const [createdInviteInfo, setCreatedInviteInfo] = useState<{ invitedName: string; memberType: FamilyMemberType } | null>(null);
  const [inviteLink, setInviteLink] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<any>(null);
  const [memberToChangeRole, setMemberToChangeRole] = useState<any>(null);
  const [inviteToDelete, setInviteToDelete] = useState<any>(null);
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  
  const currentMember = members.find(m => m.user_id === currentUserId);
  const isAdmin = currentMember?.role === 'ADMIN';

  const familyMembers = members.filter(m => m.member_type !== 'CAREGIVER');
  const caregiverMembers = members.filter(m => m.member_type === 'CAREGIVER');
  const pendingInvites = invites.filter(i => i.status === 'pending');
  const historyInvites = invites.filter(i => i.status !== 'pending');

  // Nome carinhoso para a mensagem
  const targetName = lovedOneName?.trim() || 'nossa pessoa querida';

  useEffect(() => {
    loadData();
  }, [familyId]);

  async function loadData() {
    try {
      const [m, i] = await Promise.all([
        getFamilyMembers(familyId),
        getFamilyInvites(familyId)
      ]);
      setMembers(m);
      setInvites(i);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar dados da família.');
    } finally {
      setLoading(false);
    }
  }

  function openNewInviteModal() {
    setIsResendMode(false);
    setInvitedName('');
    setInviteMemberType('FAMILY');
    setCreatedInviteInfo(null);
    setInviteLink('');
    setLinkCopied(false);
    setError('');
    setShowInviteModal(true);
  }

  async function handleCreateInvite() {
    const trimmedName = invitedName.trim();
    if (!trimmedName) {
      setError('Por favor, informe o nome da pessoa convidada.');
      return;
    }

    setActionLoading(true);
    setError('');
    setLinkCopied(false);
    setIsResendMode(false);
    try {
      const res = await createFamilyInvite({
        invitedName: trimmedName,
        memberType: inviteMemberType,
      });
      const origin = window.location.origin;
      setCreatedInviteInfo({
        invitedName: res?.invited_name || trimmedName,
        memberType: res?.member_type === 'CAREGIVER' ? 'CAREGIVER' : inviteMemberType,
      });
      setInviteLink(`${origin}/?invite=${encodeURIComponent(res.token)}`);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Não foi possível gerar o convite.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleResendInvite(invite: any) {
    setActionLoading(true);
    setError('');
    setSuccessMsg('');
    setLinkCopied(false);
    try {
      const res = await resendFamilyInvite(invite.id);
      const origin = window.location.origin;
      const resolvedName = res?.invited_name || invite?.invited_name?.trim() || '';
      const resolvedType: FamilyMemberType =
        res?.member_type === 'CAREGIVER' || (!res?.member_type && invite?.member_type === 'CAREGIVER')
          ? 'CAREGIVER'
          : 'FAMILY';

      setIsResendMode(true);
      setInvitedName(resolvedName);
      setInviteMemberType(resolvedType);
      setCreatedInviteInfo({
        invitedName: resolvedName,
        memberType: resolvedType,
      });
      setInviteLink(`${origin}/?invite=${encodeURIComponent(res.token)}`);
      setShowInviteModal(true);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Não foi possível reenviar o convite.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleConfirmRemove() {
    if (!memberToRemove) return;
    setActionLoading(true);
    setError('');
    try {
      await removeFamilyMember(memberToRemove.user_id, familyId);
      setMemberToRemove(null);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Erro ao remover membro.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRevoke(inviteId: string) {
    setActionLoading(true);
    setError('');
    try {
      await revokeFamilyInvite(inviteId);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Erro ao revogar convite.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleConfirmDeleteInvite() {
    if (!inviteToDelete) return;
    setActionLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      await deleteFamilyInvite(inviteToDelete.id);
      setInviteToDelete(null);
      setSuccessMsg('Registro de convite apagado da lista. Os acessos à rotina permanecem intactos.');
      await loadData();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Erro ao apagar registro de convite.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleConfirmClearHistory() {
    setActionLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      await clearFamilyInviteHistory(familyId);
      setConfirmClearHistory(false);
      setSuccessMsg('Lista de convites antigos limpa com sucesso. Todos os vínculos continuam ativos.');
      await loadData();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Erro ao limpar histórico de convites.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleToggleRole(member: any) {
    const newRole = member.role === 'ADMIN' ? 'MEMBER' : 'ADMIN';
    setActionLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      // Se estiver retirando o admin, garantir que não seja o único
      if (member.role === 'ADMIN') {
        const adminCount = members.filter(m => m.role === 'ADMIN').length;
        if (adminCount <= 1) {
          throw new Error('A família precisa ter ao menos um Administrador ativo.');
        }
      }

      await updateFamilyMemberRole(member.user_id, familyId, newRole);
      setMemberToChangeRole(null);
      setSuccessMsg(`Papel de ${member.profile?.name || 'membro'} alterado para ${newRole === 'ADMIN' ? 'Administrador (ADM)' : 'Acompanhante'} com sucesso!`);
      await loadData();
      setTimeout(() => setSuccessMsg(''), 3500);
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar o papel do membro.');
    } finally {
      setActionLoading(false);
    }
  }

  const activeShareType = createdInviteInfo?.memberType || inviteMemberType;
  const activeShareName = createdInviteInfo?.invitedName || invitedName.trim();
  const greetingPrefix = activeShareName ? `Oi, ${activeShareName}!` : 'Oi!';
  // ── Mensagem acolhedora, afetuosa e empática para o WhatsApp ───────────────
  const warmShareMessage =
    activeShareType === 'CAREGIVER'
      ? `${greetingPrefix} Estou te convidando para acompanhar a rotina de cuidados de ${targetName} no DUCA ❤️.\n\nPor aqui, você poderá consultar e registrar os horários de medicamentos, refeições e o bem-estar do dia a dia com clareza.\n\nPara acessar, é só entrar por este link seguro:\n${inviteLink}`
      : `${greetingPrefix} Estou te convidando para acompanhar com a gente a rotina de cuidados de ${targetName} no DUCA ❤️.\n\nPor aqui, você poderá ver e acompanhar os horários de medicamentos, refeições e o bem-estar do dia a dia com todo o carinho e união da nossa família.\n\nPara acessar, é só entrar por este link seguro:\n${inviteLink}`;

  async function handleCopy() {
    if (!inviteLink) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Acompanhar ${targetName} no DUCA`,
          text: warmShareMessage,
        });
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(warmShareMessage);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 3500);
    } catch {
      setError('Não foi possível copiar o convite automaticamente. Copie o texto acima.');
    }
  }

  function renderMemberRow(m: any) {
    const isCaregiver = m.member_type === 'CAREGIVER';
    return (
      <div
        key={m.user_id}
        className="p-4 sm:px-5 flex items-center justify-between hover:bg-gray-50/50 dark:hover:bg-white/[0.03] transition-colors"
      >
        <div className="flex items-center min-w-0 pr-2">
          <div
            className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg border shadow-sm shrink-0 ${
              isCaregiver
                ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-800/40'
                : 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-300 border-indigo-100 dark:border-indigo-800/40'
            }`}
          >
            {m.profile?.name?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="ml-4 min-w-0">
            <p className="text-base font-bold text-gray-900 dark:text-zinc-100 truncate">
              {m.profile?.name}{' '}
              {m.user_id === currentUserId && (
                <span className="text-indigo-600 dark:text-indigo-300 font-medium text-xs ml-1 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-full">
                  (Você)
                </span>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              {isCaregiver && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200/70 dark:border-emerald-800/40 px-2 py-0.5 rounded-md">
                  <HeartHandshake className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> Cuidador
                </span>
              )}
              {m.role === 'ADMIN' ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 rounded-md">
                  <ShieldCheck className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" /> Administrador (ADM)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-white/[0.08] px-2 py-0.5 rounded-md">
                  <Users className="w-3.5 h-3.5 text-gray-400 dark:text-zinc-400" /> Acompanhante
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Ações de Administrador: Eleger Admin ou Remover */}
        {isAdmin && m.user_id !== currentUserId && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setMemberToChangeRole(m)}
              disabled={actionLoading}
              className="p-2 text-gray-400 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-xl transition-all text-xs font-semibold flex items-center gap-1 active:scale-95"
              title={m.role === 'ADMIN' ? 'Alterar para Acompanhante' : 'Promover a Administrador (ADM)'}
            >
              <Shield className="w-4 h-4" />
              <span className="hidden sm:inline">
                {m.role === 'ADMIN' ? 'Tornar Acompanhante' : 'Tornar ADM'}
              </span>
            </button>
            <button
              onClick={() => setMemberToRemove(m)}
              disabled={actionLoading}
              className="p-2 text-gray-400 dark:text-zinc-400 hover:text-red-600 dark:hover:text-rose-400 hover:bg-red-50 dark:hover:bg-rose-950/40 rounded-xl transition-colors active:scale-95"
              title="Remover Membro"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col sm:justify-center items-center bg-gray-50 dark:bg-[#09090b] sm:bg-black/40 sm:dark:bg-black/75 sm:backdrop-blur-sm sm:p-4">
      <div className="relative w-full h-[100dvh] sm:max-w-lg bg-gray-50 dark:bg-[#09090b] sm:rounded-[2rem] sm:shadow-2xl flex flex-col sm:h-auto sm:max-h-[85vh] overflow-hidden sm:border sm:border-gray-100/50 sm:dark:border-white/[0.08]">
        
        {showInviteModal ? (
          <div className="flex flex-col h-full bg-white dark:bg-[#121216] relative">
            <div className="flex justify-between items-center px-6 py-5 border-b border-gray-100 dark:border-white/[0.08] shrink-0">
              <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100">
                {isResendMode ? 'Reenviar Convite' : 'Novo Convite'}
              </h3>
              <button
                onClick={() => setShowInviteModal(false)}
                className="p-2 text-gray-400 dark:text-zinc-400 hover:text-gray-600 dark:hover:text-zinc-200 bg-gray-50 dark:bg-[#1c1c22] rounded-full"
                aria-label={isResendMode ? 'Fechar reenvio de convite' : 'Fechar novo convite'}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-start pb-44">
              {!inviteLink ? (
                <div className="w-full max-w-sm space-y-5">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-950/50 rounded-full flex items-center justify-center mx-auto mb-4 border border-indigo-100 dark:border-indigo-800/40">
                      <UserPlus className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-zinc-100 tracking-tight">
                      Convidar para acompanhar
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1.5 leading-relaxed">
                      Informe quem você está convidando para facilitar a organização dos vínculos.
                    </p>
                  </div>

                  {error && (
                    <div className="text-red-600 dark:text-rose-300 text-sm font-medium bg-red-50 dark:bg-rose-950/40 p-3.5 rounded-2xl border border-red-100 dark:border-rose-800/50 text-center">
                      {error}
                    </div>
                  )}

                  <div className="space-y-1.5 text-left">
                    <label
                      htmlFor="invite-person-name"
                      className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-zinc-300"
                    >
                      Nome da pessoa convidada
                    </label>
                    <Input
                      id="invite-person-name"
                      type="text"
                      placeholder="Ex.: Maria (cuidadora) ou João"
                      value={invitedName}
                      onChange={(e) => {
                        setInvitedName(e.target.value);
                        if (error) setError('');
                      }}
                    />
                  </div>

                  <div className="space-y-2 text-left">
                    <span className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-zinc-300">
                      Tipo de vínculo
                    </span>
                    <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Tipo de vínculo">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={inviteMemberType === 'FAMILY'}
                        onClick={() => setInviteMemberType('FAMILY')}
                        className={`p-3.5 rounded-2xl border text-left transition-all flex flex-col gap-1.5 ${
                          inviteMemberType === 'FAMILY'
                            ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/50 dark:border-indigo-500 ring-1 ring-indigo-600/30'
                            : 'border-gray-200 dark:border-white/[0.1] bg-white dark:bg-[#1c1c22] hover:bg-gray-50 dark:hover:bg-[#222229]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Users
                            className={`w-4 h-4 ${
                              inviteMemberType === 'FAMILY'
                                ? 'text-indigo-600 dark:text-indigo-400'
                                : 'text-gray-400 dark:text-zinc-400'
                            }`}
                          />
                          <span className="text-sm font-bold text-gray-900 dark:text-zinc-100">Familiar</span>
                        </div>
                        <span className="text-[11px] text-gray-500 dark:text-zinc-400 leading-snug">
                          Membro da família
                        </span>
                      </button>

                      <button
                        type="button"
                        role="radio"
                        aria-checked={inviteMemberType === 'CAREGIVER'}
                        onClick={() => setInviteMemberType('CAREGIVER')}
                        className={`p-3.5 rounded-2xl border text-left transition-all flex flex-col gap-1.5 ${
                          inviteMemberType === 'CAREGIVER'
                            ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/50 dark:border-emerald-500 ring-1 ring-emerald-600/30'
                            : 'border-gray-200 dark:border-white/[0.1] bg-white dark:bg-[#1c1c22] hover:bg-gray-50 dark:hover:bg-[#222229]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <HeartHandshake
                            className={`w-4 h-4 ${
                              inviteMemberType === 'CAREGIVER'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-gray-400 dark:text-zinc-400'
                            }`}
                          />
                          <span className="text-sm font-bold text-gray-900 dark:text-zinc-100">Cuidador</span>
                        </div>
                        <span className="text-[11px] text-gray-500 dark:text-zinc-400 leading-snug">
                          Registra cuidados; promovível a ADM
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="w-full max-w-sm text-center">
                  <div className="w-20 h-20 bg-emerald-50 dark:bg-emerald-950/50 rounded-full flex items-center justify-center mx-auto mb-5 border border-emerald-100 dark:border-emerald-800/40 shadow-sm">
                    <Link className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-zinc-100 mb-2 tracking-tight">
                    Convite Pronto!
                  </h3>
                  <div className="flex items-center justify-center gap-2 mb-3">
                    {activeShareName && (
                      <span className="text-sm font-semibold text-gray-800 dark:text-zinc-200">
                        {activeShareName}
                      </span>
                    )}
                    <span
                      className={`px-2.5 py-0.5 rounded-md text-xs font-bold ${
                        activeShareType === 'CAREGIVER'
                          ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                          : 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300'
                      }`}
                    >
                      {activeShareType === 'CAREGIVER' ? 'Cuidador' : 'Familiar'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-zinc-400 mb-4 max-w-xs mx-auto leading-relaxed">
                    Envie a mensagem pelo WhatsApp para acolher {activeShareName || 'o convidado'} na rotina.
                  </p>
                  {isResendMode && (
                    <div className="mb-4 px-3.5 py-2.5 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-800/40 text-xs text-indigo-800 dark:text-indigo-200 leading-relaxed">
                      Novo link gerado com validade de 24h. O link anterior foi desativado por segurança.
                    </div>
                  )}
                  
                  {/* Prévia da mensagem empática */}
                  <div className="bg-gray-50 dark:bg-[#1c1c22] border border-gray-200/80 dark:border-white/[0.08] rounded-2xl p-4 w-full mb-5 text-left">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                        Prévia da Mensagem
                      </span>
                      <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold rounded-full">
                        Válido por 24h
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-zinc-300 italic leading-relaxed whitespace-pre-line bg-white dark:bg-[#121216] p-3 rounded-xl border border-gray-100 dark:border-white/[0.06] select-all">
                      {warmShareMessage}
                    </p>
                  </div>

                  {linkCopied && (
                    <div className="text-emerald-700 dark:text-emerald-300 text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 px-4 py-3 rounded-2xl w-full flex items-center justify-center gap-2">
                      <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span>Mensagem e link copiados! Agora é só colar no WhatsApp.</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="absolute bottom-0 left-0 right-0 p-6 bg-white dark:bg-[#121216] border-t border-gray-100 dark:border-white/[0.08] shrink-0 space-y-3 pb-8 sm:pb-6">
              {!inviteLink ? (
                <Button 
                  className="w-full py-5 text-lg font-semibold rounded-2xl" 
                  onClick={handleCreateInvite}
                  disabled={actionLoading}
                >
                  {actionLoading ? (
                    <Spinner className="text-white dark:text-zinc-950" />
                  ) : inviteMemberType === 'CAREGIVER' ? (
                    'Gerar Convite para Cuidador'
                  ) : (
                    'Gerar Convite Familiar'
                  )}
                </Button>
              ) : (
                <Button 
                  className="w-full py-5 text-lg font-semibold rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/25" 
                  onClick={handleCopy}
                >
                  Enviar Convite no WhatsApp
                </Button>
              )}
              <Button 
                variant="ghost" 
                className="w-full py-4 text-base font-medium rounded-2xl text-gray-600 dark:text-zinc-300 bg-gray-50 dark:bg-[#1c1c22] hover:bg-gray-100 dark:hover:bg-[#222229]" 
                onClick={() => setShowInviteModal(false)}
                disabled={actionLoading}
              >
                Voltar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full relative">
            <div className="flex justify-between items-center px-6 py-6 bg-white dark:bg-[#121216] border-b border-gray-100 dark:border-white/[0.08] shrink-0 shadow-sm z-10 pt-10 sm:pt-6">
              <div>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-zinc-100 tracking-tight">Família e Cuidadores</h3>
                <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1 font-medium">Quem acompanha e cuida de {targetName}</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-gray-50 dark:bg-[#09090b] pb-40">
              {error && <div className="text-red-600 dark:text-rose-300 text-sm font-medium bg-red-50 dark:bg-rose-950/40 p-4 rounded-2xl border border-red-100 dark:border-rose-800/50">{error}</div>}
              {successMsg && <div className="text-emerald-700 dark:text-emerald-300 text-sm font-semibold bg-emerald-50 dark:bg-emerald-950/40 p-4 rounded-2xl border border-emerald-100 dark:border-emerald-800/50 flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />{successMsg}</div>}
              
              {loading ? (
                <div className="flex justify-center py-12">
                  <Spinner className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
                </div>
              ) : (
                <>
                  {/* SEÇÃO 1: MEMBROS DA FAMÍLIA */}
                  <section
                    aria-label="Membros da Família"
                    className="bg-white dark:bg-[#121216] rounded-3xl border border-gray-100 dark:border-white/[0.08] shadow-sm overflow-hidden"
                  >
                    <div className="px-5 py-4 bg-gray-50/50 dark:bg-[#16161b] border-b border-gray-100 dark:border-white/[0.06] rounded-t-3xl flex items-center justify-between">
                      <h4 className="text-xs font-bold text-gray-500 dark:text-zinc-400 flex items-center uppercase tracking-wider">
                        <Users className="w-4 h-4 mr-2 text-indigo-600 dark:text-indigo-400" /> Membros da Família
                      </h4>
                      <span className="text-xs text-gray-400 dark:text-zinc-500 font-medium">
                        {familyMembers.length} {familyMembers.length === 1 ? 'membro' : 'membros'}
                      </span>
                    </div>
                    <div className="px-5 py-3 bg-indigo-50/40 dark:bg-indigo-950/30 border-b border-indigo-100/60 dark:border-indigo-900/40 text-[11px] text-indigo-900/80 dark:text-indigo-200/85 leading-relaxed">
                      <strong>Administrador (ADM):</strong> pode registrar os cuidados diários, encerrar ou reabrir dias, configurar a rotina e gerenciar membros e convites. <strong>Acompanhante:</strong> pode acompanhar, registrar refeições, medicamentos, bem-estar e encerrar o dia, mas não pode administrar configurações, membros ou convites.
                    </div>
                    <div className="divide-y divide-gray-50 dark:divide-white/[0.06]">
                      {familyMembers.length === 0 ? (
                        <div className="p-6 text-center text-xs text-gray-400 dark:text-zinc-500">
                          Nenhum familiar vinculado no momento.
                        </div>
                      ) : (
                        familyMembers.map(renderMemberRow)
                      )}
                    </div>
                  </section>

                  {/* SEÇÃO 2: CUIDADORES */}
                  <section
                    aria-label="Cuidadores"
                    className="bg-white dark:bg-[#121216] rounded-3xl border border-gray-100 dark:border-white/[0.08] shadow-sm overflow-hidden"
                  >
                    <div className="px-5 py-4 bg-gray-50/50 dark:bg-[#16161b] border-b border-gray-100 dark:border-white/[0.06] rounded-t-3xl flex items-center justify-between">
                      <h4 className="text-xs font-bold text-gray-500 dark:text-zinc-400 flex items-center uppercase tracking-wider">
                        <HeartHandshake className="w-4 h-4 mr-2 text-emerald-600 dark:text-emerald-400" /> Cuidadores
                      </h4>
                      <span className="text-xs text-gray-400 dark:text-zinc-500 font-medium">
                        {caregiverMembers.length} {caregiverMembers.length === 1 ? 'cuidador' : 'cuidadores'}
                      </span>
                    </div>
                    <div className="px-5 py-3 bg-emerald-50/40 dark:bg-emerald-950/25 border-b border-emerald-100/60 dark:border-emerald-900/40 text-[11px] text-emerald-900/80 dark:text-emerald-200/85 leading-relaxed">
                      Cuidadores podem acompanhar e registrar os cuidados diários desde a entrada, sem acesso administrativo, e podem ser promovidos a <strong>Administrador (ADM)</strong> quando você precisar.
                    </div>
                    <div className="divide-y divide-gray-50 dark:divide-white/[0.06]">
                      {caregiverMembers.length === 0 ? (
                        <div className="p-6 text-center text-xs text-gray-400 dark:text-zinc-500">
                          Nenhum cuidador vinculado no momento.
                        </div>
                      ) : (
                        caregiverMembers.map(renderMemberRow)
                      )}
                    </div>
                  </section>

                  {/* SEÇÃO 3: CONVITES (Exclusiva para Administradores) */}
                  {isAdmin && (
                    <section
                      aria-label="Convites Pendentes"
                      className="bg-white dark:bg-[#121216] rounded-3xl border border-gray-100 dark:border-white/[0.08] shadow-sm mb-6 overflow-hidden"
                    >
                      <div className="px-5 py-4 bg-gray-50/50 dark:bg-[#16161b] border-b border-gray-100 dark:border-white/[0.06] rounded-t-3xl flex justify-between items-center">
                        <div>
                          <h4 className="text-xs font-bold text-gray-500 dark:text-zinc-400 flex items-center uppercase tracking-wider">
                            <UserPlus className="w-4 h-4 mr-2 text-indigo-600 dark:text-indigo-400" /> Convites Pendentes
                          </h4>
                        </div>
                        <button 
                          onClick={openNewInviteModal}
                          className="text-xs font-bold text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 px-4 py-1.5 rounded-full transition-colors uppercase tracking-wider active:scale-95 flex items-center gap-1"
                        >
                          + Novo Convite
                        </button>
                      </div>
                      
                      <div className="divide-y divide-gray-50 dark:divide-white/[0.06]">
                        {pendingInvites.length === 0 ? (
                          <div className="p-8 text-center flex flex-col items-center">
                            <div className="w-12 h-12 bg-gray-50 dark:bg-[#1c1c22] rounded-full flex items-center justify-center mb-3">
                              <Link className="w-5 h-5 text-gray-400 dark:text-zinc-500" />
                            </div>
                            <p className="text-sm text-gray-500 dark:text-zinc-300 font-medium">
                              Nenhum convite pendente no momento.
                            </p>
                            <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1">
                              Crie um convite informando o nome e se é familiar ou cuidador.
                            </p>
                          </div>
                        ) : (
                          pendingInvites.map(i => {
                            const expired = isInviteExpired(i);
                            const isCaregiverInvite = i.member_type === 'CAREGIVER';
                            const createdLabel = formatShortDate(i.created_at);
                            const expiresLabel = formatShortDate(i.expires_at);

                            return (
                              <div key={i.id} className="p-4 sm:px-5">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-sm font-bold text-gray-900 dark:text-zinc-100 truncate">
                                      {i.invited_name?.trim() || 'Convite sem nome'}
                                    </p>
                                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                      <span
                                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                                          isCaregiverInvite
                                            ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                                            : 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300'
                                        }`}
                                      >
                                        {isCaregiverInvite ? 'Cuidador' : 'Familiar'}
                                      </span>
                                      <span
                                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                                          expired
                                            ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                                            : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                                        }`}
                                      >
                                        {expired ? 'Expirado' : 'Pendente'}
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-zinc-400 mt-1.5">
                                      {createdLabel && (
                                        <span className="inline-flex items-center gap-1">
                                          <Clock className="w-3 h-3" /> Criado em {createdLabel}
                                        </span>
                                      )}
                                      {expiresLabel && (
                                        <span>
                                          {expired ? 'Expirou em' : 'Expira em'} {expiresLabel}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setInviteToDelete(i)}
                                    disabled={actionLoading}
                                    aria-label={`Apagar registro de ${i.invited_name?.trim() || 'convite'}`}
                                    title="Apagar registro da lista"
                                    className="p-2 text-gray-400 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 hover:bg-gray-100 dark:hover:bg-white/[0.08] rounded-xl transition-colors active:scale-95 shrink-0"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                                <div className="mt-3 pt-3 border-t border-gray-100/80 dark:border-white/[0.06] flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleResendInvite(i)}
                                    disabled={actionLoading}
                                    aria-label={`Reenviar convite de ${i.invited_name?.trim() || 'convite'}`}
                                    className="inline-flex items-center justify-center gap-1.5 text-xs font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 px-3.5 py-2 rounded-xl transition-colors active:scale-95 shrink-0"
                                  >
                                    <RotateCw className="w-3.5 h-3.5" />
                                    Reenviar
                                  </button>
                                  {!expired && (
                                    <button 
                                      type="button"
                                      onClick={() => handleRevoke(i.id)}
                                      disabled={actionLoading}
                                      className="text-xs font-bold text-red-600 dark:text-rose-300 bg-red-50 dark:bg-rose-950/40 hover:bg-red-100 dark:hover:bg-rose-950/60 px-3 py-2 rounded-xl transition-colors active:scale-95 shrink-0"
                                    >
                                      Revogar
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>

                      {historyInvites.length > 0 && (
                        <div className="border-t border-gray-100 dark:border-white/[0.06] bg-gray-50/40 dark:bg-[#16161b]/60">
                          <div className="px-5 py-2.5 border-b border-gray-100 dark:border-white/[0.06] flex items-center justify-between gap-2">
                            <h5 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
                              Acompanhamento recente
                            </h5>
                            <button
                              type="button"
                              onClick={() => setConfirmClearHistory(true)}
                              disabled={actionLoading}
                              className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 px-2.5 py-1 rounded-lg hover:bg-indigo-50/70 dark:hover:bg-indigo-950/40 transition-colors active:scale-95"
                            >
                              Limpar lista
                            </button>
                          </div>
                          <div className="divide-y divide-gray-100/80 dark:divide-white/[0.05]">
                            {historyInvites.slice(0, 6).map(i => {
                              const isCaregiverInvite = i.member_type === 'CAREGIVER';
                              const statusLabel =
                                i.status === 'accepted'
                                  ? 'Aceito'
                                  : i.status === 'revoked'
                                  ? 'Revogado'
                                  : 'Expirado';
                              const statusClass =
                                i.status === 'accepted'
                                  ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-gray-100 dark:bg-white/[0.08] text-gray-600 dark:text-zinc-400';

                              return (
                                <div key={i.id} className="px-5 py-3 flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold text-gray-800 dark:text-zinc-200 truncate">
                                      {i.invited_name?.trim() || 'Convite sem nome'}
                                    </p>
                                    <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] text-gray-400 dark:text-zinc-500">
                                      <span>{isCaregiverInvite ? 'Cuidador' : 'Familiar'}</span>
                                      {i.created_at && <span>• Criado em {formatShortDate(i.created_at)}</span>}
                                      {i.status === 'accepted' && i.accepted_at && (
                                        <span>• Aceito em {formatShortDate(i.accepted_at)}</span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {i.status === 'expired' && (
                                      <button
                                        type="button"
                                        onClick={() => handleResendInvite(i)}
                                        disabled={actionLoading}
                                        aria-label={`Reenviar convite de ${i.invited_name?.trim() || 'convite'}`}
                                        className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 px-2.5 py-1 rounded-lg transition-colors active:scale-95"
                                      >
                                        <RotateCw className="w-3 h-3" />
                                        Reenviar
                                      </button>
                                    )}
                                    <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold shrink-0 ${statusClass}`}>
                                      {statusLabel}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => setInviteToDelete(i)}
                                      disabled={actionLoading}
                                      aria-label={`Apagar registro de ${i.invited_name?.trim() || 'convite'}`}
                                      title="Apagar registro da lista"
                                      className="p-1.5 text-gray-400 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-200 hover:bg-gray-100 dark:hover:bg-white/[0.08] rounded-lg transition-colors active:scale-95"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </section>
                  )}
                </>
              )}
            </div>

            <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-gray-50 via-gray-50 dark:from-[#09090b] dark:via-[#09090b] to-transparent pointer-events-none pb-8 sm:pb-6">
              <div className="pointer-events-auto pt-8">
                <Button 
                  onClick={onClose} 
                  className="w-full py-5 text-lg font-bold rounded-2xl shadow-xl active:scale-[0.98] transition-transform flex items-center justify-center bg-gray-900 dark:bg-zinc-100 hover:bg-black dark:hover:bg-white text-white dark:text-zinc-950 border-2 border-transparent"
                >
                  <X className="w-6 h-6 mr-2" /> Voltar para o Painel
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal de Confirmação: Alterar Papel (Eleger Administrador) */}
      {memberToChangeRole && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 dark:bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#121216] dark:border dark:border-white/[0.08] rounded-[2rem] w-full max-w-sm p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-950/50 rounded-full flex items-center justify-center mx-auto mb-5">
              <ShieldCheck className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-zinc-100 text-center mb-2">
              {memberToChangeRole.role === 'ADMIN' ? 'Remover Administrador?' : 'Eleger como Administrador?'}
            </h3>
            <p className="text-sm text-gray-500 dark:text-zinc-400 text-center mb-8 font-medium px-2 leading-relaxed">
              {memberToChangeRole.role === 'ADMIN'
                ? `${memberToChangeRole.profile?.name} passará a ser Acompanhante, continuando a registrar os cuidados diários e encerrar o dia, mas sem acesso para configurar a rotina, reabrir dias encerrados ou gerenciar convites e permissões.`
                : `${memberToChangeRole.profile?.name} terá privilégios de Administrador (ADM), podendo configurar a rotina, reabrir dias encerrados e gerenciar membros e convites.`
              }
            </p>
            
            <div className="space-y-3">
              <Button 
                onClick={() => handleToggleRole(memberToChangeRole)}
                disabled={actionLoading}
                className="w-full py-4 text-base font-bold rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white border-transparent shadow-md active:scale-[0.98] transition-transform"
              >
                {actionLoading ? <Spinner className="text-white w-5 h-5" /> : 'Confirmar Alteração'}
              </Button>
              <Button 
                onClick={() => setMemberToChangeRole(null)}
                disabled={actionLoading}
                variant="ghost"
                className="w-full py-4 text-base font-bold rounded-2xl bg-gray-100 dark:bg-[#1c1c22] hover:bg-gray-200 dark:hover:bg-[#222229] text-gray-700 dark:text-zinc-200 active:scale-[0.98] transition-transform"
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação: Remover Membro */}
      {memberToRemove && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 dark:bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#121216] dark:border dark:border-white/[0.08] rounded-[2rem] w-full max-w-sm p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-red-50 dark:bg-rose-950/50 rounded-full flex items-center justify-center mx-auto mb-5">
              <Trash2 className="w-8 h-8 text-red-600 dark:text-rose-400" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-zinc-100 text-center mb-2">Remover Membro?</h3>
            <p className="text-sm text-gray-500 dark:text-zinc-400 text-center mb-8 font-medium px-2">
              Esta pessoa perderá o acesso à rotina e ao histórico de {targetName} imediatamente.
            </p>
            
            <div className="space-y-3">
              <Button 
                onClick={handleConfirmRemove}
                disabled={actionLoading}
                className="w-full py-4 text-base font-bold rounded-2xl bg-red-600 hover:bg-red-700 dark:bg-rose-600 dark:hover:bg-rose-500 text-white border-transparent shadow-md active:scale-[0.98] transition-transform"
              >
                {actionLoading ? <Spinner className="text-white w-5 h-5" /> : 'Remover Acesso'}
              </Button>
              <Button 
                onClick={() => setMemberToRemove(null)}
                disabled={actionLoading}
                variant="ghost"
                className="w-full py-4 text-base font-bold rounded-2xl bg-gray-100 dark:bg-[#1c1c22] hover:bg-gray-200 dark:hover:bg-[#222229] text-gray-700 dark:text-zinc-200 active:scale-[0.98] transition-transform"
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Pop-up Empático (Apple HIG): Confirmar apagamento de um registro de convite */}
      {inviteToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-invite-title"
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 dark:bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200"
        >
          <div className="bg-white dark:bg-[#121216] dark:border dark:border-white/[0.08] rounded-[2rem] w-full max-w-sm p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-gray-100 dark:bg-[#1c1c22] rounded-full flex items-center justify-center mx-auto mb-5">
              <Trash2 className="w-7 h-7 text-gray-600 dark:text-zinc-300" />
            </div>
            <h3
              id="delete-invite-title"
              className="text-xl font-bold text-gray-900 dark:text-zinc-100 text-center mb-2 tracking-tight"
            >
              Apagar registro da lista?
            </h3>
            <p className="text-sm text-gray-500 dark:text-zinc-400 text-center mb-5 leading-relaxed px-1">
              Você está removendo apenas o registro visual de{' '}
              <strong className="text-gray-700 dark:text-zinc-200">
                {inviteToDelete.invited_name?.trim() || 'convite'}
              </strong>{' '}
              para deixar sua tela organizada.
            </p>

            <div className="rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/35 border border-indigo-100 dark:border-indigo-800/40 p-4 mb-6 text-left">
              <div className="flex items-start gap-2.5">
                <HeartHandshake className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                <div className="text-xs text-indigo-950/90 dark:text-indigo-100/90 leading-relaxed space-y-1.5">
                  <p className="font-semibold">Fique tranquilo(a): ninguém perde o acesso.</p>
                  <p>
                    Apagar este registro <strong>não remove nenhum familiar nem cuidador</strong> do acompanhamento. Quem já faz parte da equipe continua acompanhando a rotina de {targetName} normalmente.
                  </p>
                  {inviteToDelete.status === 'pending' && !isInviteExpired(inviteToDelete) && (
                    <p className="text-[11px] text-indigo-800/80 dark:text-indigo-200/80 pt-1">
                      Como este link ainda estava aguardando aceite, ele deixará de funcionar ao ser apagado.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <Button
                onClick={handleConfirmDeleteInvite}
                disabled={actionLoading}
                className="w-full py-4 text-base font-bold rounded-2xl bg-gray-900 hover:bg-black dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-950 border-transparent shadow-md active:scale-[0.98] transition-transform"
              >
                {actionLoading ? <Spinner className="text-white dark:text-zinc-950 w-5 h-5" /> : 'Apagar da Lista'}
              </Button>
              <Button
                onClick={() => setInviteToDelete(null)}
                disabled={actionLoading}
                variant="ghost"
                className="w-full py-4 text-base font-bold rounded-2xl bg-gray-100 dark:bg-[#1c1c22] hover:bg-gray-200 dark:hover:bg-[#222229] text-gray-700 dark:text-zinc-200 active:scale-[0.98] transition-transform"
              >
                Manter na Lista
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Pop-up Empático (Apple HIG): Confirmar limpeza em lote de registros antigos */}
      {confirmClearHistory && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-invites-title"
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 dark:bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200"
        >
          <div className="bg-white dark:bg-[#121216] dark:border dark:border-white/[0.08] rounded-[2rem] w-full max-w-sm p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-gray-100 dark:bg-[#1c1c22] rounded-full flex items-center justify-center mx-auto mb-5">
              <Trash2 className="w-7 h-7 text-gray-600 dark:text-zinc-300" />
            </div>
            <h3
              id="clear-invites-title"
              className="text-xl font-bold text-gray-900 dark:text-zinc-100 text-center mb-2 tracking-tight"
            >
              Limpar lista de convites?
            </h3>
            <p className="text-sm text-gray-500 dark:text-zinc-400 text-center mb-5 leading-relaxed px-1">
              Os registros antigos (aceitos, revogados e expirados) serão removidos para deixar sua tela mais leve.
            </p>

            <div className="rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/35 border border-indigo-100 dark:border-indigo-800/40 p-4 mb-6 text-left">
              <div className="flex items-start gap-2.5">
                <HeartHandshake className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                <div className="text-xs text-indigo-950/90 dark:text-indigo-100/90 leading-relaxed space-y-1.5">
                  <p className="font-semibold">Fique tranquilo(a): nenhum acesso será removido.</p>
                  <p>
                    Esta limpeza organiza apenas os avisos de convite. Todos os familiares e cuidadores continuam acompanhando a rotina de {targetName} normalmente.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <Button
                onClick={handleConfirmClearHistory}
                disabled={actionLoading}
                className="w-full py-4 text-base font-bold rounded-2xl bg-gray-900 hover:bg-black dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-950 border-transparent shadow-md active:scale-[0.98] transition-transform"
              >
                {actionLoading ? <Spinner className="text-white dark:text-zinc-950 w-5 h-5" /> : 'Limpar Registros da Tela'}
              </Button>
              <Button
                onClick={() => setConfirmClearHistory(false)}
                disabled={actionLoading}
                variant="ghost"
                className="w-full py-4 text-base font-bold rounded-2xl bg-gray-100 dark:bg-[#1c1c22] hover:bg-gray-200 dark:hover:bg-[#222229] text-gray-700 dark:text-zinc-200 active:scale-[0.98] transition-transform"
              >
                Manter na Lista
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}