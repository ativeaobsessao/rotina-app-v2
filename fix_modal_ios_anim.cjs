const fs = require('fs');
let code = fs.readFileSync('src/components/ui/FamilyModal.tsx', 'utf8');
code = code.replace(/animate-in slide-in-from-bottom-8 sm:slide-in-from-bottom-0 sm:fade-in duration-300/g, 'transform transition-all');
fs.writeFileSync('src/components/ui/FamilyModal.tsx', code);
