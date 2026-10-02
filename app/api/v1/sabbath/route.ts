import { withApi } from '@/lib/api/handler';
import { revalidateRoutineScreens } from '@/lib/api/revalidate';
import { sabbathBody } from '@/lib/api/schemas';
import { parseJsonBody } from '@/lib/api/validation';
import { clearSabbath, setSabbath } from '@/lib/data';

/**
 * POST /api/v1/sabbath {date} — mark a rest day. Clears any other sabbath in
 * the same Sun–Sat week ("exactly 1 of Sat/Sun").
 */
export const POST = withApi(async (request) => {
  const { date } = await parseJsonBody(request, sabbathBody);
  const check = await setSabbath(date);
  revalidateRoutineScreens();
  return check;
});

/** DELETE /api/v1/sabbath {date} — un-mark a rest day. */
export const DELETE = withApi(async (request) => {
  const { date } = await parseJsonBody(request, sabbathBody);
  const check = await clearSabbath(date);
  revalidateRoutineScreens();
  return check;
});
