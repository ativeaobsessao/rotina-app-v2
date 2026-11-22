import * as React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  usePortal?: boolean;
}

// Reference counter so nested sheets never unlock body scroll prematurely
let openSheetCount = 0;

export function BottomSheet({
  isOpen,
  onClose,
  title,
  children,
  usePortal = false,
}: BottomSheetProps) {
  React.useEffect(() => {
    if (!isOpen) return;

    openSheetCount += 1;
    const prevOverflow = document.body.style.overflow;
    if (openSheetCount === 1) {
      document.body.style.overflow = 'hidden';
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      openSheetCount = Math.max(0, openSheetCount - 1);
      if (openSheetCount === 0) {
        document.body.style.overflow = prevOverflow && prevOverflow !== 'hidden' ? prevOverflow : '';
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sheetNode = (
    <div className="fixed inset-0 z-[90] flex flex-col justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/45 dark:bg-black/75 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Painel'}
        className="relative w-full max-w-lg mx-auto bg-white dark:bg-[#121216] dark:border-t dark:border-white/[0.08] rounded-t-3xl shadow-2xl flex flex-col max-h-[90dvh] pb-safe-bottom animate-in slide-in-from-bottom-full duration-200"
      >
        <div className="pt-2.5 pb-1 flex justify-center shrink-0" aria-hidden="true">
          <div className="w-10 h-1 rounded-full bg-gray-300/80 dark:bg-white/[0.18]" />
        </div>

        <div className="flex items-center justify-between px-4 pb-3 pt-1 border-b border-gray-100 dark:border-white/[0.08] shrink-0">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-zinc-100 pr-2">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] -mr-1 rounded-full bg-gray-100/85 dark:bg-white/[0.08] hover:bg-gray-200/85 dark:hover:bg-white/[0.14] active:scale-95 transition-all text-gray-600 dark:text-zinc-300 flex items-center justify-center shrink-0"
            aria-label="Fechar"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain p-4 flex-1">{children}</div>
      </div>
    </div>
  );

  if (usePortal && typeof document !== 'undefined' && document.body) {
    return createPortal(sheetNode, document.body);
  }

  return sheetNode;
}
