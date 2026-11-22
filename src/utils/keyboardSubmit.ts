import type React from 'react';

export function dismissMobileKeyboard(target?: HTMLElement | null) {
  if (target && typeof target.blur === 'function') {
    target.blur();
  }
  if (typeof document !== 'undefined') {
    const active = document.activeElement as HTMLElement | null;
    if (active && typeof active.blur === 'function') {
      active.blur();
    }
  }
}

export function handleEnterKeySubmit(
  e: React.KeyboardEvent<HTMLInputElement>,
  onSubmit: () => void | Promise<void>
) {
  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) {
    e.preventDefault();
    dismissMobileKeyboard(e.currentTarget);
    void onSubmit();
  }
}
