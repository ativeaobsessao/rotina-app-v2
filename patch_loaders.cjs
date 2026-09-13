const fs = require('fs');
let appCode = fs.readFileSync('src/App.tsx', 'utf-8');
let selectorCode = fs.readFileSync('src/pages/ContextSelector.tsx', 'utf-8');

// App.tsx
appCode = appCode.replace(
  /<div className="flex h-screen items-center justify-center bg-gray-50">\s*<Spinner className="w-8 h-8 text-gray-900" \/>\s*<\/div>/g,
  '<div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-gray-950 transition-colors"></div>'
);

appCode = appCode.replace(
  /<div className="flex h-\[100dvh\] items-center justify-center bg-gray-50">\s*<Spinner className="w-8 h-8 text-gray-900" \/>\s*<\/div>/g,
  '<div className="flex h-[100dvh] items-center justify-center bg-gray-50 dark:bg-gray-950 transition-colors"></div>'
);

fs.writeFileSync('src/App.tsx', appCode);

// ContextSelector.tsx
selectorCode = selectorCode.replace(
  /<div className="flex h-\[100dvh\] items-center justify-center bg-gray-50">\s*<Spinner className="w-8 h-8 text-indigo-600" \/>\s*<\/div>/g,
  '<div className="flex h-[100dvh] items-center justify-center bg-gray-50 dark:bg-gray-950 transition-colors"></div>'
);

// We should also keep the background in sync for ContextSelector when not loading
selectorCode = selectorCode.replace(
  /bg-gray-50/g,
  'bg-gray-50 dark:bg-gray-950 transition-colors'
);
selectorCode = selectorCode.replace(
  /bg-white/g,
  'bg-white dark:bg-gray-900 transition-colors'
);
selectorCode = selectorCode.replace(
  /text-gray-900/g,
  'text-gray-900 dark:text-gray-100'
);

fs.writeFileSync('src/pages/ContextSelector.tsx', selectorCode);
