const fs = require('fs');
let code = fs.readFileSync('src/components/ui/FamilyModal.tsx', 'utf8');

const returnStartIndex = code.indexOf('return (');
const codeBeforeReturn = code.substring(0, returnStartIndex);

const newReturn = `return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/40 backdrop-blur-sm">
      <div className="flex min-h-full items-center justify-center p-4 sm:p-6 text-center">
        <div className="relative transform overflow-hidden rounded-3xl bg-gray-50 text-left shadow-2xl transition-all w-full max-w-lg flex flex-col max-h-[85vh] border border-gray-100/50">
          
          {showInviteModal ? (
            <div className="bg-white p-6 md:p-8 flex flex-col items-center text-center h-full">
              {!inviteLink ? (
                <>
                  <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mb-6">
                    <UserPlus className="w-8 h-8 text-indigo-600" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Convide um familiar</h3>
                  <p className="text-sm text-gray-500 mb-8">
                    Gere um link seguro para que outro familiar tenha acesso às informações e rotina deste paciente.
                  </p>
                  
                  {error && <div className="text-red-600 text-sm bg-red-50 p-3 rounded-xl mb-6 w-full">{error}</div>}
                  
                  <div className="space-y-3 w-full mt-auto">
                    <Button 
                      className="w-full py-4 text-base" 
                      onClick={handleCreateInvite} 
                      disabled={actionLoading}
                    >
                      {actionLoading ? <Spinner className="text-white" /> : 'Gerar Link de Convite'}
                    </Button>
                    <Button 
                      variant="ghost" 
                      className="w-full py-4 text-base" 
                      onClick={() => setShowInviteModal(false)}
                      disabled={actionLoading}
                    >
                      Voltar
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-6">
                    <Link className="w-8 h-8 text-green-600" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Convite gerado!</h3>
                  <p className="text-sm text-gray-500 mb-6">
                    Copie o link abaixo e envie para o familiar.<br/><br/>
                    <span className="font-medium text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">Válido por 24 horas</span>
                  </p>
                  
                  <input 
                    type="text" 
                    readOnly 
                    value={inviteLink} 
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-4 text-sm outline-none mb-8 text-center text-gray-600 font-medium"
                  />

                  <div className="space-y-3 w-full mt-auto">
                    <Button 
                      className="w-full py-4 text-base bg-green-600 hover:bg-green-700" 
                      onClick={handleCopy}
                    >
                      Copiar Link
                    </Button>
                    <Button 
                      variant="ghost" 
                      className="w-full py-4 text-base" 
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
              <div className="flex justify-between items-center px-6 py-5 bg-white border-b border-gray-100 shrink-0">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Família e Convites</h3>
                  <p className="text-xs text-gray-500 mt-1">Pessoas com acesso às informações deste paciente.</p>
                </div>
                <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 bg-gray-50 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-6">
                {error && <div className="text-red-600 text-sm bg-red-50 p-3 rounded-xl">{error}</div>}
                
                {loading ? (
                  <div className="flex justify-center py-12">
                    <Spinner className="w-8 h-8 text-indigo-600" />
                  </div>
                ) : (
                  <>
                    <section className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
                      <div className="px-5 py-4 bg-gray-50/50 border-b border-gray-100">
                        <h4 className="text-sm font-bold text-gray-700 flex items-center">
                          <Users className="w-4 h-4 mr-2" /> Membros Atuais
                        </h4>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {members.map(m => (
                          <div key={m.user_id} className="p-4 sm:px-5 flex items-center justify-between">
                            <div className="flex items-center">
                              <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-lg border border-indigo-100">
                                {m.profile?.name?.[0]?.toUpperCase() || '?'}
                              </div>
                              <div className="ml-4">
                                <p className="text-sm font-bold text-gray-900">
                                  {m.profile?.name} {m.user_id === currentUserId && <span className="text-indigo-600 font-medium">(Você)</span>}
                                </p>
                                <p className="text-xs text-gray-500 font-medium mt-0.5">
                                  {m.role === 'ADMIN' ? 'Administrador' : 'Membro'}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    {isAdmin && (
                      <section className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
                        <div className="px-5 py-4 bg-gray-50/50 border-b border-gray-100 flex justify-between items-center">
                          <h4 className="text-sm font-bold text-gray-700 flex items-center">
                            <UserPlus className="w-4 h-4 mr-2" /> Convites Pendentes
                          </h4>
                          <button 
                            onClick={() => { setShowInviteModal(true); setInviteLink(''); setError(''); }}
                            className="text-xs font-bold text-indigo-600 hover:bg-indigo-50 px-4 py-1.5 rounded-full transition-colors uppercase tracking-wider border border-indigo-100"
                          >
                            + Novo
                          </button>
                        </div>
                        
                        <div className="divide-y divide-gray-100">
                          {invites.filter(i => i.status === 'pending').length === 0 ? (
                            <div className="p-8 text-center flex flex-col items-center">
                              <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-3">
                                <Link className="w-5 h-5 text-gray-400" />
                              </div>
                              <p className="text-sm text-gray-500 font-medium">Nenhum convite pendente no momento.</p>
                            </div>
                          ) : (
                            invites.filter(i => i.status === 'pending').map(i => (
                              <div key={i.id} className="p-4 sm:px-5 flex items-center justify-between group">
                                <div>
                                  <p className="text-sm font-bold text-gray-900">Aguardando aceite</p>
                                  <p className="text-xs text-gray-500 font-medium mt-0.5">
                                    Expira: {new Date(i.expires_at).toLocaleDateString()}
                                  </p>
                                </div>
                                <button 
                                  onClick={() => handleRevoke(i.id)}
                                  disabled={actionLoading}
                                  className="text-xs font-bold text-red-600 hover:bg-red-50 px-4 py-2 rounded-xl transition-colors opacity-80 group-hover:opacity-100"
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
            </>
          )}

        </div>
      </div>
    </div>
  );
}`;

fs.writeFileSync('src/components/ui/FamilyModal.tsx', codeBeforeReturn + newReturn);
