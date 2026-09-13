const fs = require('fs');
let code = fs.readFileSync('src/pages/ContextSelector.tsx', 'utf8');

const replacement = `
          {patients.length === 0 && !error ? (
            <div className="text-center py-10 bg-white rounded-3xl border border-gray-100 shadow-sm">
              <h3 className="text-lg font-bold text-gray-900 mb-2">Nenhum paciente disponível</h3>
              <p className="text-sm text-gray-500 max-w-xs mx-auto">
                Você ainda não possui acesso a nenhum paciente.
              </p>
            </div>
          ) : (
            patients.map((pat) => (
              <button
                key={pat.id}
                onClick={() => handleSelect(pat.id, pat.familyId)}
                disabled={switching !== null}
                className="w-full bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100/50 hover:shadow-md hover:border-gray-200 transition-all active:scale-[0.98] flex flex-col items-center justify-center space-y-4 relative overflow-hidden group"
              >
                <div className="w-24 h-24 rounded-full bg-gray-50 flex items-center justify-center border border-gray-100 overflow-hidden shadow-inner">
                  {pat.photo ? (
                    <img src={pat.photo} alt={pat.name} className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-10 h-10 text-gray-400" />
                  )}
                </div>
                
                <h2 className="text-xl font-bold text-gray-900 tracking-tight">
                  {pat.name}
                </h2>
                
                {switching === pat.id && (
                  <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center">
                    <Spinner className="w-8 h-8 text-indigo-600" />
                  </div>
                )}
              </button>
            ))
          )}
        </div>
        
        <div className="pt-8 text-center">
           <button 
             onClick={() => window.location.href = '/'} 
             className="text-sm text-gray-500 hover:text-gray-900 font-medium"
           >
             Recarregar
           </button>
        </div>
`;

code = code.replace(/\{patients\.length === 0 && !error \? \([\s\S]*?\)\s*\)\}/, replacement);

if (!code.includes('Recarregar')) {
  // alternative
  code = code.replace(/<\/div>\s*<\/div>\s*<\/div>\s*\);\s*}/, `        </div>
        
        <div className="pt-8 text-center">
           <button 
             onClick={async () => {
                const { supabase } = await import('../services/supabase');
                await supabase.auth.signOut();
                window.location.href = '/';
             }} 
             className="text-sm text-gray-500 hover:text-gray-900 font-medium"
           >
             Sair da conta
           </button>
        </div>
      </div>
    </div>
  );
}`);
}

fs.writeFileSync('src/pages/ContextSelector.tsx', code);
