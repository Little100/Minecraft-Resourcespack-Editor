import { useEffect, useCallback } from 'react';

export interface KeyboardShortcutOptions {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  preventDefault?: boolean;
  enabled?: boolean;
}

export function useKeyboardShortcut(
  key: string,
  handler: (event: KeyboardEvent) => void,
  options: KeyboardShortcutOptions = {}
): void {
  const {
    ctrl = false,
    shift = false,
    alt = false,
    preventDefault = true,
    enabled = true,
  } = options;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      const ctrlMatch = ctrl ? (event.ctrlKey || event.metaKey) : !(event.ctrlKey || event.metaKey);
      const shiftMatch = shift ? event.shiftKey : !event.shiftKey;
      const altMatch = alt ? event.altKey : !event.altKey;

      if (ctrlMatch && shiftMatch && altMatch && event.key.toLowerCase() === key.toLowerCase()) {
        if (preventDefault) {
          event.preventDefault();
        }
        handler(event);
      }
    },
    [key, handler, ctrl, shift, alt, preventDefault, enabled]
  );

  useEffect(() => {
    if (!enabled) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, enabled]);
}
