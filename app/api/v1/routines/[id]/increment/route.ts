import { withApi } from '@/lib/api/handler';
import { revalidateRoutineScreens } from '@/lib/api/revalidate';
import { incrementRoutineBody } from '@/lib/api/schemas';
import { parseId, parseJsonBody } from '@/lib/api/validation';
import { incrementRoutine } from '@/lib/data';

type Params = { id: string };

/** POST /api/v1/routines/:id/increment {date?, by?} — add `by` (default 1, floors at 0). */
export const POST = withApi<Params>(async (request, params) => {
  const id = parseId(params.id);
  const body = await parseJsonBody(request, incrementRoutineBody);
  const check = await incrementRoutine(id, body.date, body.by ?? 1);
  revalidateRoutineScreens();
  return check;
});
