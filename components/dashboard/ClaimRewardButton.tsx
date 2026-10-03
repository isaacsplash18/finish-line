'use client';

import { useState, useTransition } from 'react';

import { claimRewardAction } from '@/app/actions';
import { Button } from '@/components';

export interface ClaimRewardButtonProps {
  rewardId: string;
}

/** The claim action on a `claimable` `RewardCard`. */
export function ClaimRewardButton({ rewardId }: ClaimRewardButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="primary"
        loading={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await claimRewardAction(rewardId);
            if (!result.ok) setError(result.error ?? 'Could not claim that.');
          });
        }}
      >
        Claim
      </Button>
      {error && <span className="max-w-[10rem] text-right text-xs text-warn">{error}</span>}
    </div>
  );
}
