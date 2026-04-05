import React, { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils/cn';
import styles from './Dialog.module.css';

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'fullscreen';
export type DialogAnimation = 'fade' | 'slide-up' | 'scale' | 'none';
export type AcrylicLevel = 'subtle' | 'standard' | 'heavy';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  size?: DialogSize;
  closeOnOverlay?: boolean;
  closeOnEscape?: boolean;
  showCloseButton?: boolean;
  animation?: DialogAnimation;
  acrylic?: AcrylicLevel;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  overlayClassName?: string;
}

export const Dialog: React.FC<DialogProps> = ({
  open,
  onClose,
  title,
  description,
  size = 'md',
  closeOnOverlay = true,
  closeOnEscape = true,
  showCloseButton = true,
  animation = 'scale',
  acrylic,
  children,
  footer,
  className,
  overlayClassName,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      requestAnimationFrame(() => {
        contentRef.current?.focus();
      });
    } else {
      previousFocusRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open || !closeOnEscape) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, closeOnEscape, onClose]);

  useEffect(() => {
    if (open) {
      const original = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = original;
      };
    }
  }, [open]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (closeOnOverlay && e.target === e.currentTarget) {
        onClose();
      }
    },
    [closeOnOverlay, onClose]
  );

  const handleContentClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  if (!open) return null;

  const animationClass = animation !== 'none' ? styles[`animation-${animation}`] : '';

  const dialog = (
    <div
      className={cn(styles.overlay, animationClass && styles['overlay-animated'], overlayClassName)}
      onClick={handleOverlayClick}
      data-acrylic-overlay
      role="presentation"
    >
      <div
        ref={contentRef}
        className={cn(
          styles.content,
          styles[`size-${size}`],
          animationClass,
          className
        )}
        onClick={handleContentClick}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={description ? 'dialog-description' : undefined}
        tabIndex={-1}
        data-acrylic={acrylic}
      >
        {(title || showCloseButton) && (
          <div className={styles.header}>
            <div className={styles.headerText}>
              {title && <h2 className={styles.title}>{title}</h2>}
              {description && (
                <p className={styles.description} id="dialog-description">
                  {description}
                </p>
              )}
            </div>
            {showCloseButton && (
              <button
                className={styles.closeButton}
                onClick={onClose}
                aria-label="Close dialog"
                type="button"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        )}

        <div className={styles.body}>{children}</div>

        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
};

Dialog.displayName = 'Dialog';

export const DialogBody: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => <div className={cn(styles.bodySection, className)}>{children}</div>;

DialogBody.displayName = 'DialogBody';

export const DialogFooter: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => <div className={cn(styles.footerSection, className)}>{children}</div>;

DialogFooter.displayName = 'DialogFooter';
