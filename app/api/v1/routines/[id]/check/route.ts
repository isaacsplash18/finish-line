import { withApi } from '@/lib/api/handler';
import { revalidateRoutineScreens } from '@/lib/api/revalidate';
import { checkRoutineBody } from '@/lib/api/schemas';
import { parseId, parseJsonBody } from '@/lib/api/validation';
import { checkRoutine } from '@/lib/data';

type Params = { id: string };

/**
 * POST /api/v1/routines/:id/check {date?, count} — set the exact count for a
 * date (idempotent). 0 un-ticks. Ideal for an external app pushing totals.
 */
export const POST = withApi<Params>(async (request, params) => {
  const id = parseId(params.id);
  const body = await parseJsonBody(request, checkRoutineBody);
  const check = await checkRoutine(id, body.date, body.count);
  revalidateRoutineScreens();
  return check;
});
