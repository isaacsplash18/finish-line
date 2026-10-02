import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import type { Reward } from '@/lib/types';

export interface RewardCardProps {
  reward: Reward;
  /** Name of the project it is pinned to, for the sub-line. */
  projectName?: string | null;
  /**
   * Why an unclaimed reward is locked right now. Shown on `locked_pending`
   * cards, e.g. "2 projects stuck" or "4 of 3 active — over cap".
   */
  lockReason?: string;
  /** The claim button / form. Only rendered when the reward is claimable. */
  action?: ReactNode;
  className?: string;
}

function money(price: number): string {
  return `$${Number(price).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/**
 * The four reward states (PRD §4, §9.3):
 *
 *  - `claimable`      emerald — earned, gate open, go buy it
 *  - `locked_pending` zinc    — not earned yet, or locked by a stuck project /
 *                              over-cap portfolio (SPEC-CHANGES §3)
 *  - `claimed`        muted   — logged, done
 *  - `forfeited`      RED tombstone — "Forfeited: $300 watch strap" (PRD §4.3.2)
 */
export function RewardCard({
  reward,
  projectName,
  lockReason,
  action,
  className,
}: RewardCardProps) {
  const { status, name, price } = reward;

  if (status === 'forfeited') {
    return (
      <div
        className={cn(
          'rounded-2xl border border-danger/50 bg-danger-wash/50 p-4',
          className,
        )}
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-danger">Forfeited</p>
        <p className="mt-1 text-base font-semibold text-text line-through decoration-danger/70">
          {money(price)} {name}
        </p>
        {projectName && (
          <p className="mt-1 text-xs text-muted">Abandoned with {projectName}.</p>
        )}
      </div>
    );
  }

  const tone =
    status === 'claimable'
      ? 'border-positive/50 bg-positive-wash/40'
      : status === 'claimed'
        ? 'border-line bg-surface opacity-70'
        : 'border-line bg-surface';

  return (
    <div className={cn('rounded-2xl border p-4', tone, className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className={cn(
              'text-xs font-semibold uppercase tracking-widest',
              status === 'claimable' ? 'text-positive' : 'text-faint',
            )}
          >
            {status === 'claimable' ? 'Claimable' : status === 'claimed' ? 'Claimed' : 'Locked'}
          </p>
          <p className="mt-1 truncate text-base font-semibold text-text">
            {money(price)} {name}
          </p>
          {projectName && <p className="mt-0.5 truncate text-xs text-muted">{projectName}</p>}
          {status === 'locked_pending' && lockReason && (
            <p className="mt-1.5 text-xs text-warn">{lockReason}</p>
          )}
        </div>
        {status === 'claimable' && action}
      </div>
    </div>
  );
}
