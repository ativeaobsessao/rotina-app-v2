const fs = require('fs');
let content = fs.readFileSync('src/pages/History.tsx', 'utf-8');

const oldMap = `              />
            ))
          )}
        </div>
      </div>`;

const newMap = `              />
            ))
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
          )}
        </div>
      </div>`;

content = content.replace(oldMap, newMap);
fs.writeFileSync('src/pages/History.tsx', content);
