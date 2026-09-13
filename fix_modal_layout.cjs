const fs = require('fs');
let code = fs.readFileSync('src/components/ui/FamilyModal.tsx', 'utf8');

// Fix first modal wrapper
code = code.replace(
  `<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-gray-50 rounded-2xl w-full max-w-lg shadow-xl overflow-hidden flex flex-col max-h-[90vh]">`,
  `<div className="fixed inset-0 z-[100] overflow-y-auto bg-black/40 backdrop-blur-sm">
      <div className="flex min-h-full items-center justify-center p-4 sm:p-6 text-center">
        <div className="relative transform overflow-hidden rounded-3xl bg-gray-50 text-left shadow-2xl transition-all w-full max-w-lg flex flex-col max-h-[85vh] border border-gray-100/50">`
);

// Fix second modal wrapper
code = code.replace(
  `<div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 text-center">`,
  `<div className="fixed inset-0 z-[110] overflow-y-auto bg-black/40 backdrop-blur-sm">
      <div className="flex min-h-full items-center justify-center p-4 sm:p-6 text-center">
        <div className="relative transform overflow-hidden rounded-3xl bg-white text-center shadow-2xl transition-all w-full max-w-sm flex flex-col max-h-[85vh] p-6 border border-gray-100/50">`
);

// Fix headers to be a bit more Apple-like (larger padding, clean)
code = code.replace(
  `<div className="flex justify-between items-center p-4 bg-white border-b border-gray-100">`,
  `<div className="flex justify-between items-center px-6 py-5 bg-white border-b border-gray-100">`
);

fs.writeFileSync('src/components/ui/FamilyModal.tsx', code);
