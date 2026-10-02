import { withApi } from '@/lib/api/handler';
import { revalidateAllScreens } from '@/lib/api/revalidate';
import { parseId } from '@/lib/api/validation';
import { claimReward } from '@/lib/data';

type Params = { id: string };

/** POST /api/v1/rewards/:id/claim — only a `claimable` reward can be claimed (400 otherwise). */
export const POST = withApi<Params>(async (_request, params) => {
  const reward = await claimReward(parseId(params.id));
  revalidateAllScreens();
  return reward;
});
