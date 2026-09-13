const fs = require('fs');
let code = fs.readFileSync('src/components/ui/FamilyModal.tsx', 'utf8');
const returnStartIndex = code.indexOf('return (');
const codeBeforeReturn = code.substring(0, returnStartIndex);

const newReturn = `return (
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
                  <h3 className="text-2xl font-bold text-gray-900 mb-3 tracking-tight">Acesso Familiar</h3>
                  <p className="text-base text-gray-500 mb-8 max-w-xs mx-auto">
                    Crie um link de convite seguro para que outro familiar acompanhe este paciente.
                  </p>
                  
                  {error && <div className="text-red-600 text-sm font-medium bg-red-50 p-4 rounded-2xl mb-6 w-full border border-red-100">{error}</div>}
                </>
              ) : (
                <>
                  <div className="w-24 h-24 bg-green-50 rounded-full flex items-center justify-center mb-6 border border-green-100">
                    <Link className="w-12 h-12 text-green-600" />
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-3 tracking-tight">Convite Criado!</h3>
                  <p className="text-base text-gray-500 mb-6">Copie o link e envie para o familiar.</p>
                  
                  <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 w-full mb-8">
                     <span className="inline-block px-3 py-1 bg-indigo-100 text-indigo-700 text-xs font-bold rounded-full mb-3 uppercase tracking-wider">Válido por 24h</span>
                     <input 
                        type="text" 
                        readOnly 
                        value={inviteLink} 
                        className="w-full bg-white border border-gray-200 shadow-sm rounded-xl px-4 py-4 text-sm outline-none text-center text-gray-800 font-medium font-mono"
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                      />
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
                  {actionLoading ? <Spinner className="text-white" /> : 'Gerar Link Seguro'}
                </Button>
              ) : (
                <Button 
                  className="w-full py-5 text-lg font-semibold rounded-2xl bg-green-600 hover:bg-green-700" 
                  onClick={handleCopy}
                >
                  Copiar Link
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
                <h3 className="text-2xl font-bold text-gray-900 tracking-tight">Família e Convites</h3>
                <p className="text-sm text-gray-500 mt-1 font-medium">Controle de acesso ao paciente.</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-gray-50 pb-40">
              {error && <div className="text-red-600 text-sm font-medium bg-red-50 p-4 rounded-2xl border border-red-100">{error}</div>}
              
              {loading ? (
                <div className="flex justify-center py-12">
                  <Spinner className="w-8 h-8 text-indigo-600" />
                </div>
              ) : (
                <>
                  <section className="bg-white rounded-3xl border border-gray-100 shadow-sm">
                    <div className="px-5 py-4 bg-gray-50/50 border-b border-gray-100 rounded-t-3xl">
                      <h4 className="text-xs font-bold text-gray-500 flex items-center uppercase tracking-wider">
                        <Users className="w-4 h-4 mr-2" /> Membros Atuais
                      </h4>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {members.map(m => (
                        <div key={m.user_id} className="p-4 sm:px-5 flex items-center justify-between">
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
                    <section className="bg-white rounded-3xl border border-gray-100 shadow-sm mb-6">
                      <div className="px-5 py-4 bg-gray-50/50 border-b border-gray-100 rounded-t-3xl flex justify-between items-center">
                        <h4 className="text-xs font-bold text-gray-500 flex items-center uppercase tracking-wider">
                          <UserPlus className="w-4 h-4 mr-2" /> Convites
                        </h4>
                        <button 
                          onClick={() => { setShowInviteModal(true); setInviteLink(''); setError(''); }}
                          className="text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-4 py-1.5 rounded-full transition-colors uppercase tracking-wider active:scale-95"
                        >
                          + Novo
                        </button>
                      </div>
                      
                      <div className="divide-y divide-gray-50">
                        {invites.filter(i => i.status === 'pending').length === 0 ? (
                          <div className="p-8 text-center flex flex-col items-center">
                            <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-3">
                              <Link className="w-5 h-5 text-gray-400" />
                            </div>
                            <p className="text-sm text-gray-500 font-medium">Nenhum convite pendente.</p>
                          </div>
                        ) : (
                          invites.filter(i => i.status === 'pending').map(i => (
                            <div key={i.id} className="p-4 sm:px-5 flex items-center justify-between">
                              <div>
                                <p className="text-sm font-bold text-gray-900">Aguardando aceite</p>
                                <p className="text-xs text-gray-500 font-medium mt-1 bg-gray-100 inline-block px-2 py-0.5 rounded-full">
                                  Expira: {new Date(i.expires_at).toLocaleDateString()}
                                </p>
                              </div>
                              <button 
                                onClick={() => handleRevoke(i.id)}
                                disabled={actionLoading}
                                className="text-sm font-bold text-red-600 bg-red-50 hover:bg-red-100 px-4 py-2 rounded-xl transition-colors active:scale-95"
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
                  <X className="w-6 h-6 mr-2" /> Sair / Voltar para Home
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}`;

fs.writeFileSync('src/components/ui/FamilyModal.tsx', codeBeforeReturn + newReturn);
