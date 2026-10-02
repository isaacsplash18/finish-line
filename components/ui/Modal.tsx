'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Sub-line under the title. Good place for the WIP cost copy. */
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons. Rendered right-aligned on desktop, stacked full-width on mobile. */
  footer?: ReactNode;
  /** Adds a red left edge. Use ONLY for stuck / forfeit confirmations. */
  tone?: 'default' | 'warn' | 'danger';
}

/**
 * Bottom-sheet on mobile, centred dialog on desktop. Uses the native
 * `<dialog>` element so focus trapping and Esc come for free.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  tone = 'default',
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        'backdrop:bg-black/70 backdrop:backdrop-blur-sm',
        'm-0 w-full max-w-none bg-transparent p-0 text-text',
        'fixed inset-0 max-h-none flex items-end justify-center',
        'sm:items-center',
      )}
    >
      {open && (
        <div
          className={cn(
            'w-full max-w-lg rounded-t-2xl border border-line bg-surface p-5',
            'sm:rounded-2xl',
            tone === 'danger' && 'border-l-2 border-l-danger',
            tone === 'warn' && 'border-l-2 border-l-warn',
          )}
        >
          {title && <h2 className="text-lg font-semibold tracking-tight">{title}</h2>}
          {description && <div className="mt-1 text-sm text-muted">{description}</div>}
          {children && <div className="mt-4">{children}</div>}
          {footer && (
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
