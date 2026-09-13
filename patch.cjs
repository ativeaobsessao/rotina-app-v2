const fs = require('fs');

// Patch App.tsx
let appCode = fs.readFileSync('src/App.tsx', 'utf8');
appCode = appCode.replace(
  "import React, { useEffect, useState } from 'react';",
  "import React, { useEffect, useState, useRef } from 'react';"
);
appCode = appCode.replace(
  "  const [needsContextSelection, setNeedsContextSelection] = useState(false);\n  const [hasCheckedContext, setHasCheckedContext] = useState(false);",
  "  const [needsContextSelection, setNeedsContextSelection] = useState(false);\n  const hasCheckedContextRef = useRef(false);"
);
appCode = appCode.replace(
  "      if (!hasCheckedContext) {\n        try {\n          const memberships = await getMyFamilyMemberships();\n          if (memberships.length === 0) {\n            setNeedsSetup(true);\n            setHasCheckedContext(true);\n          } else {\n            setNeedsContextSelection(true);\n          }",
  "      if (!hasCheckedContextRef.current) {\n        try {\n          const memberships = await getMyFamilyMemberships();\n          if (memberships.length === 0) {\n            setNeedsSetup(true);\n            hasCheckedContextRef.current = true;\n          } else {\n            setNeedsContextSelection(true);\n          }"
);
appCode = appCode.replace(
  "        onSelect={() => {\n          setNeedsContextSelection(false);\n          setHasCheckedContext(true);\n          setLoading(true);\n          checkPatient();\n        }}",
  "        onSelect={() => {\n          setNeedsContextSelection(false);\n          hasCheckedContextRef.current = true;\n          setLoading(true);\n          checkPatient();\n        }}"
);
fs.writeFileSync('src/App.tsx', appCode);

// Patch Today.tsx
let todayCode = fs.readFileSync('src/pages/Today.tsx', 'utf8');

// Add hasReopened state
todayCode = todayCode.replace(
  "  const [reopeningDay, setReopeningDay] = useState(false);",
  "  const [reopeningDay, setReopeningDay] = useState(false);\n  const [hasReopened, setHasReopened] = useState(false);"
);

// Update setHasReopened in handleReopenDay
todayCode = todayCode.replace(
  "      if (success) {\n        setDailyClosure(null);\n        refreshTimeline(patient.id, localDate);\n      }",
  "      if (success) {\n        setDailyClosure(null);\n        setHasReopened(true);\n        refreshTimeline(patient.id, localDate);\n      }"
);

// Add Banners
const banners = `        {/* Banners */}
        {!dailyClosure && hasReopened && (
          <div className="mx-6 mt-6 bg-amber-50 border border-amber-100 rounded-2xl p-4 flex items-start gap-3 shadow-sm animate-in fade-in slide-in-from-top-2">
            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-amber-800">Dia reaberto para alterações.</p>
              <p className="text-xs text-amber-700/80 mt-0.5">Não esqueça de encerrá-lo novamente ao terminar.</p>
            </div>
          </div>
        )}

        {!dailyClosure && !hasReopened && isAllEventsCompleted && (
          <div className="mx-6 mt-6 bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-start gap-3 shadow-sm animate-in fade-in slide-in-from-top-2">
            <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-emerald-800">Tudo pronto!</p>
              <p className="text-xs text-emerald-700/80 mt-0.5">Todas as atividades foram registradas. Você já pode encerrar o dia.</p>
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="px-6 py-6 space-y-8 pb-32">`;

todayCode = todayCode.replace(
  "        {/* Timeline */}\n        <div className=\"px-6 py-6 space-y-8\">",
  banners
);

// Remove the old closure card if completed, just keep the null fallback
todayCode = todayCode.replace(
  "          ) : isAllEventsCompleted ? (\n            <div className=\"bg-indigo-50 border border-indigo-100 rounded-xl p-5 flex flex-col items-center text-center\">\n              <h3 className=\"font-semibold text-indigo-900 mb-1\">Rotina do dia concluída</h3>\n              <p className=\"text-sm text-indigo-700/80 mb-4\">\n                Todos os eventos programados para hoje foram registrados.\n              </p>\n              <button \n                onClick={() => setShowClosureModal(true)}\n                className=\"bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl font-medium transition-colors w-full sm:w-auto\"\n              >\n                Encerrar Dia\n              </button>\n            </div>\n          ) : null}",
  "          ) : null}"
);

// Add the sticky footer right before the MainLayout closing tag
const stickyFooter = `      {/* Sticky Bottom Footer for Closing the Day */}
      {!dailyClosure && (hasReopened || isAllEventsCompleted) && (
        <div className="fixed bottom-[80px] left-0 right-0 z-40 px-4 sm:max-w-md mx-auto w-full pb-4 animate-in slide-in-from-bottom-6 fade-in duration-300">
          <div className="bg-white/80 backdrop-blur-md border border-gray-200 p-3 rounded-2xl shadow-lg flex items-center justify-between">
            <div className="pl-2 pr-4">
              <p className="text-sm font-bold text-gray-900">Encerrar Dia</p>
              <p className="text-[11px] font-medium text-gray-500">Confirme para salvar.</p>
            </div>
            <button
              onClick={() => setShowClosureModal(true)}
              className="bg-black hover:bg-gray-900 active:bg-gray-800 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-all shadow-md active:scale-95"
            >
              Encerrar
            </button>
          </div>
        </div>
      )}

    </MainLayout>`;

todayCode = todayCode.replace("    </MainLayout>", stickyFooter);

fs.writeFileSync('src/pages/Today.tsx', todayCode);
