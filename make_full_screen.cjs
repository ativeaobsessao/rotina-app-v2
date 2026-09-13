const fs = require('fs');
let code = fs.readFileSync('src/components/ui/FamilyModal.tsx', 'utf8');

const returnStartIndex = code.indexOf('return (');
const codeBeforeReturn = code.substring(0, returnStartIndex);

const newReturn = `return (
    <div className="fixed inset-0 z-[100] flex flex-col sm:justify-center items-center bg-gray-50 sm:bg-black/40 sm:backdrop-blur-md sm:p-4">
      <div 
        className="relative w-full h-full sm:max-w-lg bg-gray-50 sm:rounded-3xl sm:shadow-2xl flex flex-col sm:h-auto sm:max-h-[85vh] overflow-hidden sm:border sm:border-gray-100/50 transform transition-all"
      >
        {showInviteModal ? (
          <div className="bg-white p-6 md:p-8 flex flex-col items-center text-center h-full overflow-y-auto">
            {!inviteLink ? (
              <>
                <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mb-6 shrink-0 shadow-sm border border-indigo-100 mt-8 sm:mt-0">
                  <UserPlus className="w-10 h-10 text-indigo-600" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-3 tracking-tight">Convide um familiar</h3>
                <p className="text-base text-gray-500 mb-8 leading-relaxed max-w-sm">
                  Gere um link seguro para que outro familiar tenha acesso à rotina e informações deste paciente.
                </p>
                
                {error && <div className="text-red-600 text-sm font-medium bg-red-50 p-4 rounded-2xl mb-6 w-full border border-red-100">{error}</div>}
                
                <div className="space-y-4 w-full mt-auto mb-8 sm:mb-0">
                  <Button 
                    className="w-full py-5 text-lg font-semibold rounded-2xl shadow-md active:scale-[0.98] transition-transform" 
                    onClick={handleCreateInvite} 
                    disabled={actionLoading}
                  >
                    {actionLoading ? <Spinner className="text-white" /> : 'Gerar Link'}
                  </Button>
                  <Button 
                    variant="ghost" 
                    className="w-full py-4 text-base font-medium rounded-2xl hover:bg-gray-100 active:scale-[0.98] transition-all text-gray-600" 
                    onClick={() => setShowInviteModal(false)}
                    disabled={actionLoading}
                  >
                    Voltar para Família
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mb-6 shrink-0 shadow-sm border border-green-100 mt-8 sm:mt-0">
                  <Link className="w-10 h-10 text-green-600" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-3 tracking-tight">Convite gerado!</h3>
                <p className="text-base text-gray-500 mb-6 leading-relaxed">
                  Copie o link abaixo e envie para o familiar.<br/>
                </p>
                
                <div className="bg-indigo-50/50 border border-indigo-100 rounded-2xl p-4 w-full mb-8">
                   <p className="text-sm font-semibold text-indigo-700 mb-2">Este link expira em 24 horas</p>
                   <input 
                      type="text" 
                      readOnly 
                      value={inviteLink} 
                      className="w-full bg-white border border-indigo-200 shadow-sm rounded-xl px-4 py-3 text-sm outline-none text-center text-gray-700 font-medium font-mono"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                </div>

                <div className="space-y-4 w-full mt-auto mb-8 sm:mb-0">
                  <Button 
                    className="w-full py-5 text-lg font-semibold rounded-2xl shadow-md bg-green-600 hover:bg-green-700 active:scale-[0.98] transition-transform" 
                    onClick={handleCopy}
                  >
                    Copiar Link
                  </Button>
                  <Button 
                    variant="ghost" 
                    className="w-full py-4 text-base font-medium rounded-2xl hover:bg-gray-100 active:scale-[0.98] transition-all text-gray-600" 
                    onClick={() => setShowInviteModal(false)}
                  >
                    Concluído
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center px-6 pt-12 pb-6 sm:py-6 bg-white border-b border-gray-100 shrink-0 shadow-sm z-10">
              <div>
                <h3 className="text-2xl font-bold text-gray-900 tracking-tight">Família e Convites</h3>
                <p className="text-sm text-gray-500 mt-1 font-medium">Gerencie quem acessa o paciente.</p>
              </div>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-6 bg-gray-50 pb-32">
              {error && <div className="text-red-600 text-sm font-medium bg-red-50 p-4 rounded-2xl border border-red-100">{error}</div>}
              
              {loading ? (
                <div className="flex justify-center py-12">
                  <Spinner className="w-8 h-8 text-indigo-600" />
                </div>
              ) : (
                <>
                  <section className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
                    <div className="px-5 py-4 bg-gray-50/80 border-b border-gray-100">
                      <h4 className="text-sm font-bold text-gray-700 flex items-center uppercase tracking-wider">
                        <Users className="w-4 h-4 mr-2 text-indigo-500" /> Membros Atuais
                      </h4>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {members.map(m => (
                        <div key={m.user_id} className="p-4 sm:px-5 flex items-center justify-between hover:bg-gray-50/50 transition-colors">
                          <div className="flex items-center">
                            <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-lg border border-indigo-100 shadow-sm">
                              {m.profile?.name?.[0]?.toUpperCase() || '?'}
                            </div>
                            <div className="ml-4">
                              <p className="text-base font-bold text-gray-900">
                                {m.profile?.name} {m.user_id === currentUserId && <span className="text-indigo-600 font-medium text-sm ml-1 bg-indigo-50 px-2 py-0.5 rounded-full">(Você)</span>}
                              </p>
                              <p className="text-sm text-gray-500 font-medium mt-0.5">
                                {m.role === 'ADMIN' ? 'Administrador' : 'Membro'}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  {isAdmin && (
                    <section className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm mb-8">
                      <div className="px-5 py-4 bg-gray-50/80 border-b border-gray-100 flex justify-between items-center">
                        <h4 className="text-sm font-bold text-gray-700 flex items-center uppercase tracking-wider">
                          <UserPlus className="w-4 h-4 mr-2 text-green-500" /> Convites Pendentes
                        </h4>
                        <button 
                          onClick={() => { setShowInviteModal(true); setInviteLink(''); setError(''); }}
                          className="text-xs font-bold text-indigo-600 hover:bg-indigo-50 px-4 py-2 rounded-full transition-colors uppercase tracking-wider border border-indigo-100 shadow-sm active:scale-95"
                        >
                          + Novo
                        </button>
                      </div>
                      
                      <div className="divide-y divide-gray-50">
                        {invites.filter(i => i.status === 'pending').length === 0 ? (
                          <div className="p-8 text-center flex flex-col items-center">
                            <div className="w-14 h-14 bg-gray-50 border border-gray-100 rounded-full flex items-center justify-center mb-3 shadow-sm">
                              <Link className="w-6 h-6 text-gray-400" />
                            </div>
                            <p className="text-sm text-gray-500 font-medium">Nenhum convite pendente.</p>
                          </div>
                        ) : (
                          invites.filter(i => i.status === 'pending').map(i => (
                            <div key={i.id} className="p-4 sm:px-5 flex items-center justify-between group hover:bg-gray-50/50 transition-colors">
                              <div>
                                <p className="text-sm font-bold text-gray-900">Aguardando aceite</p>
                                <p className="text-xs text-gray-500 font-medium mt-1 bg-gray-100 inline-block px-2 py-0.5 rounded-full">
                                  Expira: {new Date(i.expires_at).toLocaleDateString()}
                                </p>
                              </div>
                              <button 
                                onClick={() => handleRevoke(i.id)}
                                disabled={actionLoading}
                                className="text-sm font-bold text-red-600 hover:bg-red-50 hover:border-red-200 border border-transparent px-4 py-2 rounded-xl transition-all opacity-90 group-hover:opacity-100 active:scale-95"
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

            <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent">
              <Button 
                onClick={onClose} 
                className="w-full py-5 text-lg font-semibold rounded-2xl shadow-lg active:scale-[0.98] transition-transform"
              >
                Voltar para o Aplicativo
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}`;

fs.writeFileSync('src/components/ui/FamilyModal.tsx', codeBeforeReturn + newReturn);
