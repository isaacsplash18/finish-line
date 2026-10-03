import { withApi } from '@/lib/api/handler';
import { revalidateProjectScreens } from '@/lib/api/revalidate';
import { didItBody } from '@/lib/api/schemas';
import { parseJsonBody } from '@/lib/api/validation';
import { getFocusWeek, getTodaysMove, logProgress } from '@/lib/data';

/**
 * POST /api/v1/moves/did-it {projectId, nextAction?}
 *
 * The Today's-move "Did it" tap (SPEC-V2 §1): records progress, removes the
 * project from today's rotation, clears Stuck, optionally replaces the next
 * action. Returns the result plus the live Focus and the next move, so a
 * client can update the card and the meter from one response.
 */
export const POST = withApi(async (request) => {
  const body = await parseJsonBody(request, didItBody);
  const progress = await logProgress(body.projectId, 'did_it', { nextAction: body.nextAction });
  revalidateProjectScreens(body.projectId);
  const [focusWeek, todaysMove] = await Promise.all([getFocusWeek(), getTodaysMove()]);
  return { ...progress, focusWeek, todaysMove };
});
