const fs = require('fs');
let code = fs.readFileSync('src/services/api.ts', 'utf-8');

function applyCache(funcName, args, cacheKeyExpr, fallbackStr) {
  const regex = new RegExp(`export async function ${funcName}\\(${args}\\)[^{]*\\{\\s*const \\{ data, error \\} = await supabase([\\s\\S]*?)if \\(error\\) throw error;\\s*return data[\\s\\S]*?;\\s*\\}`);
  
  const match = code.match(regex);
  if (!match) {
    console.log("Could not find match for", funcName);
    return;
  }
  
  const supabaseQuery = match[1];
  
  const newFunc = `export async function ${funcName}(${args}) {
  return fetchWithCache(
    ${cacheKeyExpr},
    async () => {
      const { data, error } = await supabase${supabaseQuery}if (error) throw error;
      return data || ${fallbackStr};
    },
    ${fallbackStr}
  );
}`;
  
  code = code.replace(match[0], newFunc);
}

applyCache('getMealLogs', 'patientId: string, eventDate: string', '`mealLogs_${patientId}_${eventDate}`', '[]');
applyCache('getMedicationLogs', 'patientId: string, eventDate: string', '`medLogs_${patientId}_${eventDate}`', '[]');
applyCache('getDailyClosure', 'patientId: string, date: string', '`closure_${patientId}_${date}`', 'null');
applyCache('getCurrentProfile', '', '`currentProfile`', 'null');

fs.writeFileSync('src/services/api.ts', code);
