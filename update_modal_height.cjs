const fs = require('fs');
let code = fs.readFileSync('src/components/ui/FamilyModal.tsx', 'utf8');

code = code.replace(
  /className="relative w-full max-w-lg bg-gray-50 rounded-t-\[2\.5rem\] sm:rounded-3xl shadow-2xl flex flex-col max-h-\[90vh\] sm:max-h-\[85vh\] overflow-hidden border border-gray-100\/50 mt-auto sm:mt-0 transform transition-all pb-6 sm:pb-0"/,
  'className="relative w-full max-w-lg bg-gray-50 rounded-t-[2.5rem] sm:rounded-3xl shadow-2xl flex flex-col h-[96dvh] sm:h-auto sm:max-h-[85vh] overflow-hidden border border-gray-100/50 mt-auto sm:mt-0 transform transition-all pb-8 sm:pb-0"'
);

fs.writeFileSync('src/components/ui/FamilyModal.tsx', code);
