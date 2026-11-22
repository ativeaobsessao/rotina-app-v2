import React, { useEffect } from 'react';
import { Trash2, AlertCircle, RotateCcw } from 'lucide-react';
import { Button } from './Button';
import { Spinner } from './Spinner';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'neutral';
  icon?: 'trash' | 'revert';
  loading?: boolean;
  error?: string | null;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'danger',
  icon = 'trash',
  loading = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, loading, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 dark:bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={() => {
        if (!loading) onCancel();
      }}
    >
      <div
        className="bg-white dark:bg-[#121216] dark:border dark:border-white/[0.08] rounded-[2rem] w-full max-w-sm p-6 shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5 ${
            tone === 'danger'
              ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400'
              : 'bg-gray-100 dark:bg-[#1c1c22] text-gray-700 dark:text-zinc-200'
          }`}
        >
          {icon === 'revert' ? (
            <RotateCcw className="w-7 h-7" />
          ) : (
            <Trash2 className="w-7 h-7" />
          )}
        </div>

        <h3
          id="confirm-dialog-title"
          className="text-xl font-bold text-gray-900 dark:text-zinc-100 text-center mb-2 tracking-tight"
        >
          {title}
        </h3>

        <div className="text-sm text-gray-500 dark:text-zinc-400 text-center mb-6 leading-relaxed px-1">
          {description}
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-2xl bg-red-50 dark:bg-rose-950/45 border border-red-100 dark:border-rose-800/50 p-3.5 flex items-start gap-2.5 text-left"
          >
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <p className="text-xs font-medium text-red-700 dark:text-rose-200 leading-relaxed">
              {error}
            </p>
          </div>
        )}

        <div className="space-y-2.5">
          <Button
            type="button"
            disabled={loading}
            onClick={() => void onConfirm()}
            className={`w-full min-h-[48px] py-3.5 text-base font-bold rounded-2xl border-transparent shadow-sm active:scale-[0.98] transition-transform ${
              tone === 'danger'
                ? 'bg-rose-600 hover:bg-rose-700 text-white'
                : 'bg-gray-900 hover:bg-black dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-950'
            }`}
          >
            {loading ? (
              <Spinner className="w-5 h-5 text-white dark:text-zinc-950" />
            ) : (
              confirmLabel
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={loading}
            onClick={onCancel}
            className="w-full min-h-[48px] py-3.5 text-base font-semibold rounded-2xl bg-gray-100 dark:bg-[#1c1c22] hover:bg-gray-200 dark:hover:bg-[#222229] text-gray-700 dark:text-zinc-200 active:scale-[0.98] transition-transform"
          >
            {cancelLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
