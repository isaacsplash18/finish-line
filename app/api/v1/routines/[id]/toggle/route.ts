import { withApi } from '@/lib/api/handler';
import { revalidateRoutineScreens } from '@/lib/api/revalidate';
import { toggleRoutineBody } from '@/lib/api/schemas';
import { parseId, parseJsonBody } from '@/lib/api/validation';
import { toggleRoutine } from '@/lib/data';

type Params = { id: string };

/** POST /api/v1/routines/:id/toggle {date?} — tick ⇄ untick (date defaults to today, SGT). */
export const POST = withApi<Params>(async (request, params) => {
  const id = parseId(params.id);
  const body = await parseJsonBody(request, toggleRoutineBody);
  const check = await toggleRoutine(id, body.date);
  revalidateRoutineScreens();
  return check;
});
