import { RewardCard } from '@/components';
import type { Reward, RewardStatus } from '@/lib/types';

import { ClaimRewardButton } from './ClaimRewardButton';

export interface RewardStripProps {
  rewards: Reward[];
  /** Why locked_pending rewards are locked right now, if they are. */
  lockReason?: string;
}

const STATUS_ORDER: Record<RewardStatus, number> = {
  claimable: 0,
  locked_pending: 1,
  claimed: 2,
  forfeited: 3,
};

/**
 * The reward status strip (PRD §8.1): claimable / locked / claimed / the
 * forfeited tombstone. `RewardCard` handles all four states; this just orders
 * and wires the claim action in.
 */
export function RewardStrip({ rewards, lockReason }: RewardStripProps) {
  if (rewards.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-faint">
        No rewards set up. Give yourself something worth finishing for.
      </p>
    );
  }

  const sorted = [...rewards].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  return (
    <div className="flex flex-col gap-3">
      {sorted.map((reward) => (
        <RewardCard
          key={reward.id}
          reward={reward}
          lockReason={reward.status === 'locked_pending' ? lockReason : undefined}
          action={reward.status === 'claimable' ? <ClaimRewardButton rewardId={reward.id} /> : undefined}
        />
      ))}
    </div>
  );
}
