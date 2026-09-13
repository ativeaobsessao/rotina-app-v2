const fs = require('fs');
let content = fs.readFileSync('src/pages/History.tsx', 'utf-8');

const originalFooter = `          {days.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-gray-400 text-sm">Nenhum registro histórico encontrado.</p>
              <p className="text-gray-300 text-xs mt-1">Os registros dos dias anteriores aparecerão aqui.</p>
            </div>
          ) : (`;

const newFooter = `          {days.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-gray-400 text-sm">Nenhum registro histórico encontrado nos últimos {daysLimit} dias.</p>
              <p className="text-gray-300 text-xs mt-1">Os registros dos dias anteriores aparecerão aqui.</p>
            </div>
          ) : (`;
          
content = content.replace(originalFooter, newFooter);

const oldDaysMap = `              ))}
            </div>
          )}`;

const newDaysMap = `              ))}
            </div>
          )}
          
          {days.length > 0 && (
            <div className="flex justify-center pt-8 pb-4">
              <button 
                onClick={() => setDaysLimit(prev => prev + 14)}
                className="text-sm font-medium text-indigo-600 bg-indigo-50 px-6 py-2.5 rounded-xl hover:bg-indigo-100 transition-colors"
              >
                Carregar mais antigos
              </button>
            </div>
          )}`;

content = content.replace(oldDaysMap, newDaysMap);

fs.writeFileSync('src/pages/History.tsx', content);
