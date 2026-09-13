const fs = require('fs');
let code = fs.readFileSync('src/pages/History.tsx', 'utf8');
code = code.replace(
  'const [mealLogs, medLogs] = await Promise.all([',
  'console.log("HISTORY DEBUG - beforeDate:", localDate, "patId:", pat.id);\n      const [mealLogs, medLogs] = await Promise.all(['
);
code = code.replace(
  'const groups: Record<string, TimelineEvent[]> = {};',
  'console.log("HISTORY DEBUG - returned mealLogs:", mealLogs.length);\n      console.log("HISTORY DEBUG - raw mealLogs:", mealLogs);\n      const groups: Record<string, TimelineEvent[]> = {};'
);
fs.writeFileSync('src/pages/History.tsx', code);
