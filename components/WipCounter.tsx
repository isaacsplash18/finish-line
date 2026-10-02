import { cn } from '@/lib/cn';

export interface WipCounterProps {
  activeCount: number;
  cap: number;
  /** Points per day currently bleeding (0 or negative). */
  dailyBleed?: number;
  className?: string;
}

/**
 * The always-visible "2 of 3 active" counter (PRD §8.2), with the soft-cap
 * states from SPEC-CHANGES §4:
 *
 *   under cap → neutral
 *   at cap    → accent orange
 *   over cap  → AMBER, with the bleed rate ("4 of 3 active — over cap, -10/day")
 *
 * Red is NOT used here. Red means Stuck or Forfeited, nothing else.
 */
export function WipCounter({ activeCount, cap, dailyBleed = 0, className }: WipCounterProps) {
  const overBy = Math.max(0, activeCount - cap);
  const atCap = overBy === 0 && activeCount >= cap;

  return (
    <span
      className={cn(
        'tabular inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium',
        overBy > 0
          ? 'border-warn/60 bg-warn-wash text-warn'
          : atCap
            ? 'border-accent/50 bg-accent-wash text-accent'
            : 'border-line bg-surface-2 text-muted',
        className,
      )}
    >
      {activeCount} of {cap} active
      {overBy > 0 && (
        <span className="text-warn/90">
          — over cap{dailyBleed ? `, ${dailyBleed}/day` : ''}
        </span>
      )}
    </span>
  );
}
