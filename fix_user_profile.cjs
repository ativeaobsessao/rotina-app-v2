const fs = require('fs');
let code = fs.readFileSync('src/components/ui/UserProfile.tsx', 'utf8');

if (!code.includes('Trocar Paciente')) {
  const replaceTarget = `<button 
            onClick={handleSignOut}
            className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 flex items-center transition-colors"
          >`;
          
  const replacement = `<button 
            onClick={() => window.location.reload()}
            className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 flex items-center transition-colors border-b border-gray-100"
          >
            <Users className="w-4 h-4 mr-2 text-gray-400" />
            Trocar Paciente
          </button>
          
          <button 
            onClick={handleSignOut}
            className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 flex items-center transition-colors"
          >`;
          
  code = code.replace(replaceTarget, replacement);
  fs.writeFileSync('src/components/ui/UserProfile.tsx', code);
}
