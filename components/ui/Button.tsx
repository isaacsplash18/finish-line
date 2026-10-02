'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'warn' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * - `primary`  orange, the main action
   * - `secondary` outlined surface
   * - `ghost`    text only
   * - `warn`     amber — "this costs you" confirmations (over the WIP cap)
   * - `danger`   RED — only for abandon / forfeit. Not for ordinary deletes.
   */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the container width — the default on mobile forms. */
  block?: boolean;
  /** Shows a spinner and blocks clicks. */
  loading?: boolean;
  icon?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-ink hover:bg-accent-hover active:bg-accent-dim focus-visible:outline-accent',
  secondary:
    'bg-surface-2 text-text border border-line hover:bg-surface-3 hover:border-line-strong focus-visible:outline-line-strong',
  ghost: 'bg-transparent text-muted hover:text-text hover:bg-surface-2 focus-visible:outline-line-strong',
  warn: 'bg-warn text-accent-ink hover:brightness-110 focus-visible:outline-warn',
  danger: 'bg-danger text-text hover:bg-danger-dim focus-visible:outline-danger',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-base gap-2 rounded-xl',
};

/**
 * NOTE (SPEC-CHANGES §1): do not disable buttons because of the WIP cap.
 * The cap is economic, not physical — show the cost copy and let it through.
 * `disabled` is for genuinely impossible actions only.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', block, loading, icon, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      {...props}
      disabled={props.disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-medium tracking-tight',
        'transition-colors outline-offset-2 focus-visible:outline-2',
        'disabled:cursor-not-allowed disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
    >
      {loading ? (
        <span
          aria-hidden
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        icon
      )}
      {children}
    </button>
  );
});
