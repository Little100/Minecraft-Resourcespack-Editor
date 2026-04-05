import React, { forwardRef } from 'react';
import { cn } from '../../utils/cn';
import styles from './Button.module.css';

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  htmlType?: 'button' | 'submit' | 'reset';
  children?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'secondary',
      size = 'md',
      loading = false,
      icon,
      iconPosition = 'left',
      fullWidth = false,
      htmlType = 'button',
      disabled,
      className,
      children,
      ...rest
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        type={htmlType}
        disabled={isDisabled}
        className={cn(
          styles.button,
          styles[variant],
          styles[size],
          fullWidth && styles.fullWidth,
          loading && styles.loading,
          isDisabled && styles.disabled,
          className
        )}
        aria-disabled={isDisabled}
        aria-busy={loading}
        {...rest}
      >
        {loading && (
          <span className={styles.spinner} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="31.42 31.42" />
            </svg>
          </span>
        )}
        {icon && iconPosition === 'left' && !loading && (
          <span className={styles.icon} aria-hidden="true">{icon}</span>
        )}
        {children && <span className={styles.label}>{children}</span>}
        {icon && iconPosition === 'right' && !loading && (
          <span className={styles.icon} aria-hidden="true">{icon}</span>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
