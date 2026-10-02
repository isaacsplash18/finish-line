'use client';

import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

const FIELD_BASE = cn(
  'w-full rounded-xl bg-surface-2 border border-line text-text',
  'placeholder:text-faint transition-colors',
  'focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent',
  'disabled:opacity-50',
);

/**
 * Padding + type scale live apart from the base so a caller can pick a size
 * without fighting it. `cn` is a plain joiner, not tailwind-merge: passing
 * `py-1` in `className` does NOT beat `py-2.5` here — the stylesheet order
 * decides, and the larger value wins. Anything size-related must therefore be
 * chosen, never overridden.
 */
const FIELD_SIZES = {
  md: 'px-3 py-2.5 text-sm',
  sm: 'px-2.5 py-1.5 text-xs',
} as const;

export type FieldSize = keyof typeof FIELD_SIZES;

const FIELD = cn(FIELD_BASE, FIELD_SIZES.md);

interface FieldChrome {
  label?: string;
  /** Small grey line under the label. */
  hint?: string;
  /** Validation message. Rendered in AMBER, not red — red is stuck/forfeit only. */
  error?: string;
}

function Chrome({
  id,
  label,
  hint,
  error,
  children,
}: FieldChrome & { id: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-xs font-medium uppercase tracking-wide text-muted">
          {label}
        </label>
      )}
      {children}
      {hint && !error && <p className="text-xs text-faint">{hint}</p>}
      {error && <p className="text-xs text-warn">{error}</p>}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement>, FieldChrome {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, className, id, ...props },
  ref,
) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <Chrome id={fieldId} label={label} hint={hint} error={error}>
      <input
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        className={cn(FIELD, error && 'border-warn', className)}
        {...props}
      />
    </Chrome>
  );
});

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement>,
    FieldChrome {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, id, rows = 3, ...props },
  ref,
) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <Chrome id={fieldId} label={label} hint={hint} error={error}>
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        className={cn(FIELD, 'resize-y', error && 'border-warn', className)}
        {...props}
      />
    </Chrome>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement>, FieldChrome {
  /** Compact variant for the kanban cards. `size` is taken by the native attr. */
  fieldSize?: FieldSize;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, className, id, children, fieldSize = 'md', ...props },
  ref,
) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <Chrome id={fieldId} label={label} hint={hint} error={error}>
      <select
        ref={ref}
        id={fieldId}
        className={cn(
          FIELD_BASE,
          FIELD_SIZES[fieldSize],
          'appearance-none',
          fieldSize === 'sm' ? 'pr-7' : 'pr-8',
          error && 'border-warn',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    </Chrome>
  );
});
