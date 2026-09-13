const fs = require('fs');
let code = fs.readFileSync('src/pages/Today.tsx', 'utf8');

const badBlock = `        {/* Sticky Bottom Footer for Closing the Day */}
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

code = code.replace(badBlock, "      </MainLayout>");

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

// Find the LAST </MainLayout>
const lastIndex = code.lastIndexOf("    </MainLayout>");
if (lastIndex !== -1) {
  code = code.substring(0, lastIndex) + stickyFooter + code.substring(lastIndex + "    </MainLayout>".length);
}

fs.writeFileSync('src/pages/Today.tsx', code);
