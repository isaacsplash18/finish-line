import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { Sparkline } from './Sparkline';

export interface ScoreHeroProps {
  label: string;
  /** 0–100. Renders as the big number. */
  value: number;
  /** Oldest → newest, for the 30-day sparkline. */
  history?: (number | null)[];
  /** Change vs the previous snapshot. Positive renders emerald, negative amber. */
  delta?: number | null;
  /** One line of context under the number, e.g. "2 stuck, over cap". */
  caption?: ReactNode;
  /** `accent` = orange (Focus), `positive` = emerald (Flow). */
  tone?: 'accent' | 'positive';
  className?: string;
}

/**
 * The two hero numbers on the dashboard (PRD §6, §8.1). Big number, small
 * label, 30-day sparkline underneath.
 *
 * Presentational only — hand it a snapshot value; do not compute in here.
 */
export function ScoreHero({
  label,
  value,
  history = [],
  delta,
  caption,
  tone = 'accent',
  className,
}: ScoreHeroProps) {
  const stroke = tone === 'accent' ? 'var(--color-accent)' : 'var(--color-positive)';

  return (
    <div className={cn('rounded-2xl border border-line bg-surface p-4', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-faint">{label}</span>
        {delta != null && delta !== 0 && (
          <span
            className={cn(
              'tabular text-xs font-medium',
              delta > 0 ? 'text-positive' : 'text-warn',
            )}
          >
            {delta > 0 ? '+' : ''}
            {delta}
          </span>
        )}
      </div>

      <div
        className={cn(
          'tabular mt-1 text-6xl font-semibold leading-none tracking-tighter',
          tone === 'accent' ? 'text-accent' : 'text-positive',
        )}
      >
        {Math.round(value)}
      </div>

      {caption && <p className="mt-1.5 text-xs text-muted">{caption}</p>}

      <div className="mt-3">
        <Sparkline values={history} stroke={stroke} height={40} label={`${label}, last 30 days`} />
      </div>
    </div>
  );
}
