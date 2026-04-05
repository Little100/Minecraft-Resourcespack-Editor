import React from 'react';
import { Dialog } from '../Dialog';
import { Button } from '../Button';
import { cn } from '../../utils/cn';
import styles from './ConfirmDialog.module.css';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string | React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'info' | 'warning' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  className?: string;
}

const variantIcons: Record<string, React.ReactNode> = {
  info: (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  warning: (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  danger: (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
};

const confirmVariantMap: Record<string, 'primary' | 'danger'> = {
  info: 'primary',
  warning: 'primary',
  danger: 'danger',
};

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'info',
  onConfirm,
  onCancel,
  loading = false,
  className,
}) => {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      size="sm"
      animation="scale"
      showCloseButton={false}
      className={cn(styles.confirmDialog, className)}
    >
      <div className={styles.content}>
        <div className={cn(styles.iconWrapper, styles[`icon-${variant}`])}>
          {variantIcons[variant]}
        </div>
        <div className={styles.textContent}>
          <h3 className={styles.title}>{title}</h3>
          <div className={styles.message}>
            {typeof message === 'string' ? <p>{message}</p> : message}
          </div>
        </div>
      </div>
      <div className={styles.actions}>
        <Button
          variant="secondary"
          size="md"
          onClick={onCancel}
          disabled={loading}
        >
          {cancelText}
        </Button>
        <Button
          variant={confirmVariantMap[variant]}
          size="md"
          onClick={onConfirm}
          loading={loading}
        >
          {confirmText}
        </Button>
      </div>
    </Dialog>
  );
};

ConfirmDialog.displayName = 'ConfirmDialog';
