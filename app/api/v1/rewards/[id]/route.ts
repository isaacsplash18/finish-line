import { ApiError } from '@/lib/api/errors';
import { withApi } from '@/lib/api/handler';
import { revalidateAllScreens } from '@/lib/api/revalidate';
import { updateRewardBody } from '@/lib/api/schemas';
import { parseId, parseJsonBody } from '@/lib/api/validation';
import {
  NotFoundError,
  ValidationError,
  applyRewardLockingRule,
  deleteReward,
  getReward,
  updateReward,
} from '@/lib/data';

type Params = { id: string };

async function requireReward(id: string) {
  const reward = await getReward(id);
  if (!reward) throw new NotFoundError('Reward', id);
  return reward;
}

/**
 * PATCH /api/v1/rewards/:id {name?, price?, project_id?} — status is not
 * editable here: claim via /claim, forfeits only happen through abandon.
 */
export const PATCH = withApi<Params>(async (request, params) => {
  const id = parseId(params.id);
  const body = await parseJsonBody(request, updateRewardBody);
  if (Object.keys(body).length === 0) {
    throw new ApiError(400, 'VALIDATION', 'Nothing to update.');
  }
  await requireReward(id);
  await updateReward(id, body);
  await applyRewardLockingRule();
  revalidateAllScreens();
  return requireReward(id);
});

/** DELETE /api/v1/rewards/:id — unassigned rewards only (same rule as Settings). */
export const DELETE = withApi<Params>(async (_request, params) => {
  const id = parseId(params.id);
  const reward = await requireReward(id);
  if (reward.project_id) {
    throw new ValidationError('Unassign the reward from its project before deleting it.');
  }
  await deleteReward(id);
  revalidateAllScreens();
  return { id, deleted: true };
});
