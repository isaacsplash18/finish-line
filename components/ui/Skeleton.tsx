import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface SkeletonProps {
  className?: string;
}

/**
 * A placeholder block for `loading.tsx` screens. Same surface tokens as the
 * real cards, so the swap to content does not flash. Pulse is switched off
 * for `prefers-reduced-motion`.
 */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-lg bg-surface-3 motion-reduce:animate-none', className)}
    />
  );
}

/** A Card-shaped placeholder: same border/radius/padding as `<Card>`. */
export function SkeletonCard({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role="presentation"
      className={cn('rounded-2xl border border-line bg-surface p-4', className)}
    >
      {children}
    </div>
  );
}
