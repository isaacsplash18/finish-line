import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface CardProps {
  children: ReactNode;
  className?: string;
  /**
   * `stuck` adds the red edge + pulse (PRD §8.2). `overCap` is amber.
   * Red is reserved: only pass `stuck` for genuinely stuck/forfeited things.
   */
  tone?: 'default' | 'accent' | 'overCap' | 'stuck';
  as?: 'div' | 'article' | 'li' | 'section';
}

export function Card({ children, className, tone = 'default', as: Tag = 'div' }: CardProps) {
  return (
    <Tag
      className={cn(
        'rounded-2xl border bg-surface p-4',
        tone === 'default' && 'border-line',
        tone === 'accent' && 'border-accent/40',
        tone === 'overCap' && 'border-warn/50 bg-warn-wash/40',
        tone === 'stuck' && 'border-danger/60 bg-danger-wash/40 pulse-stuck',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-3 flex items-start justify-between gap-3', className)}>{children}</div>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">{children}</h2>
      {action}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-faint">
      {children}
    </p>
  );
}
