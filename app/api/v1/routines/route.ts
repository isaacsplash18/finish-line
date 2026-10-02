import { withApi } from '@/lib/api/handler';
import { listRoutinesQuery } from '@/lib/api/schemas';
import { parseQuery } from '@/lib/api/validation';
import { getRoutinesWithChecks } from '@/lib/data';

/** GET /api/v1/routines[?days=28][&includeInactive=true] — routines + per-date checks. */
export const GET = withApi(async (request) => {
  const query = parseQuery(request, listRoutinesQuery);
  return getRoutinesWithChecks({
    days: query.days ?? 28,
    includeInactive: query.includeInactive ?? false,
  });
});
