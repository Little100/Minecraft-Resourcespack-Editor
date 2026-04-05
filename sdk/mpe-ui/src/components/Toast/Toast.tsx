import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils/cn';
import styles from './Toast.module.css';

export interface ToastProps {
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastProps {
  id: string;
  exiting?: boolean;
}

interface ToastContextValue {
  toast: (props: ToastProps) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastCounter = 0;

const toastIcons: Record<string, React.ReactNode> = {
  info: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  success: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  warning: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  error: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (props: ToastProps): string => {
      const id = `toast-${++toastCounter}`;
      const item: ToastItem = { ...props, id };
      setToasts((prev) => [...prev, item]);

      const duration = props.duration ?? 4000;
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration);
        timersRef.current.set(id, timer);
      }

      return id;
    },
    [dismiss]
  );

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      {createPortal(
        <div className={styles.container} role="region" aria-label="Notifications">
          {toasts.map((item) => (
            <div
              key={item.id}
              className={cn(
                styles.toast,
                styles[item.type],
                item.exiting && styles.exiting
              )}
              role="alert"
            >
              <span className={styles.icon}>{toastIcons[item.type]}</span>
              <span className={styles.message}>{item.message}</span>
              {item.action && (
                <button
                  className={styles.action}
                  onClick={() => {
                    item.action!.onClick();
                    dismiss(item.id);
                  }}
                  type="button"
                >
                  {item.action.label}
                </button>
              )}
              <button
                className={styles.dismiss}
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss notification"
                type="button"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
};

ToastProvider.displayName = 'ToastProvider';

export function useToast(): (props: ToastProps) => string {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('[MPE/UI] useToast must be used within a <ToastProvider>');
  }
  return context.toast;
}

export function useToastContext(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('[MPE/UI] useToastContext must be used within a <ToastProvider>');
  }
  return context;
}
