const fs = require('fs');
let code = fs.readFileSync('src/pages/History.tsx', 'utf-8');
code = code.replace(/\/\/ Safe date parsing to avoid timezone shifts[\s\S]*?friendly\.slice\(1\);/, 'const friendly = formatFriendlyDate(dateStr);');
fs.writeFileSync('src/pages/History.tsx', code);
