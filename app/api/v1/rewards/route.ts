import { withApi } from '@/lib/api/handler';
import { revalidateAllScreens } from '@/lib/api/revalidate';
import { createRewardBody } from '@/lib/api/schemas';
import { parseJsonBody } from '@/lib/api/validation';
import { applyRewardLockingRule, createReward, getReward, getRewards } from '@/lib/data';

/** GET /api/v1/rewards — every reward, newest first, incl. forfeited tombstones. */
export const GET = withApi(async () => getRewards());

/**
 * POST /api/v1/rewards {name, price, project_id?} — always starts locked;
 * the reward gate then decides (same as Settings).
 */
export const POST = withApi(
  async (request) => {
    const body = await parseJsonBody(request, createRewardBody);
    const reward = await createReward(body);
    await applyRewardLockingRule();
    revalidateAllScreens();
    return (await getReward(reward.id)) ?? reward;
  },
  { status: 201 },
);
