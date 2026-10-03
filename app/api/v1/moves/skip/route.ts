import { withApi } from '@/lib/api/handler';
import { revalidateProjectScreens } from '@/lib/api/revalidate';
import { skipMoveBody } from '@/lib/api/schemas';
import { parseJsonBody } from '@/lib/api/validation';
import { getTodaysMove, skipTodaysMove } from '@/lib/data';

/**
 * POST /api/v1/moves/skip {projectId} — "Not today" (SPEC-V2 §1). No penalty;
 * the project leaves today's rotation until tomorrow. Returns the next move.
 */
export const POST = withApi(async (request) => {
  const body = await parseJsonBody(request, skipMoveBody);
  const skipped = await skipTodaysMove(body.projectId);
  revalidateProjectScreens();
  return { skipped, todaysMove: await getTodaysMove() };
});
