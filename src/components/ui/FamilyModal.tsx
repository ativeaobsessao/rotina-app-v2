import React, { useState, useEffect } from 'react';
import { X, Users, UserPlus, Trash2, Link, ShieldCheck, Shield, Check } from 'lucide-react';
import { Spinner } from './Spinner';
import { Button } from './Button';
import { 
  getFamilyMembers, 
  getFamilyInvites, 
  createFamilyInvite, 
  revokeFamilyInvite, 
  removeFamilyMember,
  updateFamilyMemberRole 
} from '../../services/api';

interface FamilyModalProps {
  familyId: string;
  currentUserId: string;
  lovedOneName?: string;
  onClose: () => void;
}

export function FamilyModal({ familyId, currentUserId, lovedOneName, onClose }: FamilyModalProps) {
  const [members, setMembers] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [memberToRemove, setMemberToRemove] = useState<any>(null);
  const [memberToChangeRole, setMemberToChangeRole] = useState<any>(null);
  
  const currentMember = members.find(m => m.user_id === currentUserId);
  const isAdmin = currentMember?.role === 'ADMIN';

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

  async function handleCreateInvite() {
    setActionLoading(true);
    setError('');
    try {
      const res = await createFamilyInvite();
      const origin = window.location.origin;
      setInviteLink(`${origin}/invite/${res.token}`);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Não foi possível gerar o convite.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleConfirmRemove() {
    if (!memberToRemove) return;
    setActionLoading(true);
    try {
      await removeFamilyMember(memberToRemove.user_id, familyId);
      setMemberToRemove(null);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Erro ao remover membro.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRevoke(inviteId: string) {
    setActionLoading(true);
    try {
      await revokeFamilyInvite(inviteId);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Erro ao revogar convite.');
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
      setSuccessMsg(`Papel de ${member.profile?.name || 'membro'} alterado para ${newRole === 'ADMIN' ? 'Administrador' : 'Membro com sucesso!'}`);
      await loadData();
      setTimeout(() => setSuccessMsg(''), 3500);
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar o papel do membro.');
    } finally {
      setActionLoading(false);
    }
  }

  // ── Mensagem acolhedora, afetuosa e empática para o WhatsApp ───────────────
  const warmShareMessage = `Oi! Estou te convidando para acompanhar com a gente a rotina de cuidados de ${targetName} no DUCA ❤️.\n\nPor aqui, você poderá ver e acompanhar os horários de medicamentos, refeições e o bem-estar do dia a dia com todo o carinho e união da nossa família.\n\nPara acessar, é só entrar por este link seguro:\n${inviteLink}`;

  async function handleCopy() {
    if (inviteLink) {
      if (navigator.share) {
        try {
          await navigator.share({
            title: `Acompanhar ${targetName} no DUCA`,
            text: warmShareMessage,
            url: inviteLink
          });
        } catch {
          await navigator.clipboard.writeText(warmShareMessage);
          alert('Mensagem e link de convite copiados com sucesso! Você pode colar no WhatsApp da família.');
        }
      } else {
        await navigator.clipboard.writeText(warmShareMessage);
        alert('Mensagem e link de convite copiados com sucesso! Você pode colar no WhatsApp da família.');
      }
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col sm:justify-center items-center bg-gray-50 sm:bg-black/40 sm:backdrop-blur-sm sm:p-4">
      <div className="relative w-full h-[100dvh] sm:max-w-lg bg-gray-50 sm:rounded-[2rem] sm:shadow-2xl flex flex-col sm:h-auto sm:max-h-[85vh] overflow-hidden sm:border sm:border-gray-100/50">
        
        {showInviteModal ? (
          <div className="flex flex-col h-full bg-white relative">
            <div className="flex justify-between items-center px-6 py-5 border-b border-gray-100 shrink-0">
              <h3 className="text-lg font-bold text-gray-900">Novo Convite</h3>
              <button onClick={() => setShowInviteModal(false)} className="p-2 text-gray-400 hover:text-gray-600 bg-gray-50 rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center text-center pb-40">
              {!inviteLink ? (
                <>
                  <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center mb-6 border border-indigo-100">
                    <UserPlus className="w-12 h-12 text-indigo-600" />
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-3 tracking-tight">Cuidado em Família</h3>
                  <p className="text-base text-gray-500 mb-8 max-w-xs mx-auto leading-relaxed">
                    Gere um link seguro para convidar um familiar ou cuidador a acompanhar a rotina com carinho e transparência.
                  </p>
                  
                  {error && <div className="text-red-600 text-sm font-medium bg-red-50 p-4 rounded-2xl mb-6 w-full border border-red-100">{error}</div>}
                </>
              ) : (
                <>
                  <div className="w-24 h-24 bg-emerald-50 rounded-full flex items-center justify-center mb-6 border border-emerald-100 shadow-sm">
                    <Link className="w-12 h-12 text-emerald-600" />
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-2 tracking-tight">Convite Pronto com Carinho!</h3>
                  <p className="text-sm text-gray-500 mb-6 max-w-xs leading-relaxed">
                    Envie a mensagem pelo WhatsApp para acolher o novo familiar na rotina.
                  </p>
                  
                  {/* Prévia da mensagem empática */}
                  <div className="bg-gray-50 border border-gray-200/80 rounded-2xl p-4 w-full mb-6 text-left">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">Prévia da Mensagem</span>
                      <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded-full">Válido por 24h</span>
                    </div>
                    <p className="text-xs text-gray-600 italic leading-relaxed whitespace-pre-line bg-white p-3 rounded-xl border border-gray-100">
                      {warmShareMessage}
                    </p>
                  </div>
                </>
              )}
            </div>

            <div className="absolute bottom-0 left-0 right-0 p-6 bg-white border-t border-gray-100 shrink-0 space-y-3 pb-8 sm:pb-6">
              {!inviteLink ? (
                <Button 
                  className="w-full py-5 text-lg font-semibold rounded-2xl" 
                  onClick={handleCreateInvite}
                  disabled={actionLoading}
                >
                  {actionLoading ? <Spinner className="text-white" /> : 'Gerar Convite Familiar'}
                </Button>
              ) : (
                <Button 
                  className="w-full py-5 text-lg font-semibold rounded-2xl bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-600/25" 
                  onClick={handleCopy}
                >
                  Enviar Convite no WhatsApp
                </Button>
              )}
              <Button 
                variant="ghost" 
                className="w-full py-4 text-base font-medium rounded-2xl text-gray-600 bg-gray-50 hover:bg-gray-100" 
                onClick={() => setShowInviteModal(false)}
                disabled={actionLoading}
              >
                Voltar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full relative">
            <div className="flex justify-between items-center px-6 py-6 bg-white border-b border-gray-100 shrink-0 shadow-sm z-10 pt-10 sm:pt-6">
              <div>
                <h3 className="text-2xl font-bold text-gray-900 tracking-tight">Família e Cuidadores</h3>
                <p className="text-sm text-gray-500 mt-1 font-medium">Quem acompanha e cuida de {targetName}</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-gray-50 pb-40">
              {error && <div className="text-red-600 text-sm font-medium bg-red-50 p-4 rounded-2xl border border-red-100">{error}</div>}
              {successMsg && <div className="text-emerald-700 text-sm font-semibold bg-emerald-50 p-4 rounded-2xl border border-emerald-100 flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600" />{successMsg}</div>}
              
              {loading ? (
                <div className="flex justify-center py-12">
                  <Spinner className="w-8 h-8 text-indigo-600" />
                </div>
              ) : (
                <>
                  <section className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 bg-gray-50/50 border-b border-gray-100 rounded-t-3xl flex items-center justify-between">
                      <h4 className="text-xs font-bold text-gray-500 flex items-center uppercase tracking-wider">
                        <Users className="w-4 h-4 mr-2 text-indigo-600" /> Membros da Família
                      </h4>
                      <span className="text-xs text-gray-400 font-medium">{members.length} {members.length === 1 ? 'membro' : 'membros'}</span>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {members.map(m => (
                        <div key={m.user_id} className="p-4 sm:px-5 flex items-center justify-between hover:bg-gray-50/50 transition-colors">
                          <div className="flex items-center min-w-0 pr-2">
                            <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-lg border border-indigo-100 shadow-sm shrink-0">
                              {m.profile?.name?.[0]?.toUpperCase() || '?'}
                            </div>
                            <div className="ml-4 min-w-0">
                              <p className="text-base font-bold text-gray-900 truncate">
                                {m.profile?.name} {m.user_id === currentUserId && <span className="text-indigo-600 font-medium text-xs ml-1 bg-indigo-50 px-2 py-0.5 rounded-full">(Você)</span>}
                              </p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {m.role === 'ADMIN' ? (
                                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md">
                                    <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" /> Administrador
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-md">
                                    <Users className="w-3.5 h-3.5 text-gray-400" /> Membro
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
                                className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all text-xs font-semibold flex items-center gap-1 active:scale-95"
                                title={m.role === 'ADMIN' ? 'Alterar para Membro' : 'Promover a Administrador'}
                              >
                                <Shield className="w-4 h-4" />
                                <span className="hidden sm:inline">
                                  {m.role === 'ADMIN' ? 'Tornar Membro' : 'Tornar ADM'}
                                </span>
                              </button>
                              <button
                                onClick={() => setMemberToRemove(m)}
                                disabled={actionLoading}
                                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors active:scale-95"
                                title="Remover Membro"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* Seção de Convites: Exclusiva para Administradores */}
                  {isAdmin && (
                    <section className="bg-white rounded-3xl border border-gray-100 shadow-sm mb-6">
                      <div className="px-5 py-4 bg-gray-50/50 border-b border-gray-100 rounded-t-3xl flex justify-between items-center">
                        <div>
                          <h4 className="text-xs font-bold text-gray-500 flex items-center uppercase tracking-wider">
                            <UserPlus className="w-4 h-4 mr-2 text-indigo-600" /> Convites Pendentes
                          </h4>
                        </div>
                        <button 
                          onClick={() => { setShowInviteModal(true); setInviteLink(''); setError(''); }}
                          className="text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-4 py-1.5 rounded-full transition-colors uppercase tracking-wider active:scale-95 flex items-center gap-1"
                        >
                          + Novo Convite
                        </button>
                      </div>
                      
                      <div className="divide-y divide-gray-50">
                        {invites.filter(i => i.status === 'pending').length === 0 ? (
                          <div className="p-8 text-center flex flex-col items-center">
                            <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-3">
                              <Link className="w-5 h-5 text-gray-400" />
                            </div>
                            <p className="text-sm text-gray-500 font-medium">Nenhum convite pendente no momento.</p>
                            <p className="text-xs text-gray-400 mt-1">Crie um convite para adicionar mais familiares à rotina.</p>
                          </div>
                        ) : (
                          invites.filter(i => i.status === 'pending').map(i => (
                            <div key={i.id} className="p-4 sm:px-5 flex items-center justify-between">
                              <div>
                                <p className="text-sm font-bold text-gray-900">Link compartilhado aguardando aceite</p>
                                <p className="text-xs text-gray-500 font-medium mt-1 bg-gray-100 inline-block px-2.5 py-0.5 rounded-full">
                                  Expira em: {new Date(i.expires_at).toLocaleDateString('pt-BR')}
                                </p>
                              </div>
                              <button 
                                onClick={() => handleRevoke(i.id)}
                                disabled={actionLoading}
                                className="text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 px-3.5 py-2 rounded-xl transition-colors active:scale-95"
                              >
                                Revogar
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>

            <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent pointer-events-none pb-8 sm:pb-6">
              <div className="pointer-events-auto pt-8">
                <Button 
                  onClick={onClose} 
                  className="w-full py-5 text-lg font-bold rounded-2xl shadow-xl active:scale-[0.98] transition-transform flex items-center justify-center bg-gray-900 hover:bg-black text-white border-2 border-transparent"
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
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] w-full max-w-sm p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-5">
              <ShieldCheck className="w-8 h-8 text-indigo-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 text-center mb-2">
              {memberToChangeRole.role === 'ADMIN' ? 'Remover Administrador?' : 'Eleger como Administrador?'}
            </h3>
            <p className="text-sm text-gray-500 text-center mb-8 font-medium px-2 leading-relaxed">
              {memberToChangeRole.role === 'ADMIN'
                ? `${memberToChangeRole.profile?.name} passará a ser Membro e não poderá mais convidar pessoas nem gerenciar permissões.`
                : `${memberToChangeRole.profile?.name} terá privilégios de Administrador, podendo convidar outros familiares e gerenciar acessos.`
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
                className="w-full py-4 text-base font-bold rounded-2xl bg-gray-100 hover:bg-gray-200 text-gray-700 active:scale-[0.98] transition-transform"
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação: Remover Membro */}
      {memberToRemove && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] w-full max-w-sm p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-5">
              <Trash2 className="w-8 h-8 text-red-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 text-center mb-2">Remover Membro?</h3>
            <p className="text-sm text-gray-500 text-center mb-8 font-medium px-2">
              Esta pessoa perderá o acesso à rotina e ao histórico de {targetName} imediatamente.
            </p>
            
            <div className="space-y-3">
              <Button 
                onClick={handleConfirmRemove}
                disabled={actionLoading}
                className="w-full py-4 text-base font-bold rounded-2xl bg-red-600 hover:bg-red-700 text-white border-transparent shadow-md active:scale-[0.98] transition-transform"
              >
                {actionLoading ? <Spinner className="text-white w-5 h-5" /> : 'Remover Acesso'}
              </Button>
              <Button 
                onClick={() => setMemberToRemove(null)}
                disabled={actionLoading}
                variant="ghost"
                className="w-full py-4 text-base font-bold rounded-2xl bg-gray-100 hover:bg-gray-200 text-gray-700 active:scale-[0.98] transition-transform"
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}