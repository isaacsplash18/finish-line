import { withApi } from '@/lib/api/handler';
import { revalidateAllScreens } from '@/lib/api/revalidate';
import { createKeyDateBody, listKeyDatesQuery } from '@/lib/api/schemas';
import { parseJsonBody, parseQuery } from '@/lib/api/validation';
import { createKeyDate, getKeyDates } from '@/lib/data';

/** GET /api/v1/key-dates[?limit=5][&upcomingOnly=true] — soonest first, with countdowns. */
export const GET = withApi(async (request) => {
  const query = parseQuery(request, listKeyDatesQuery);
  return getKeyDates({ limit: query.limit, upcomingOnly: query.upcomingOnly ?? false });
});

/**
 * POST /api/v1/key-dates {name, date, project_id?} — a linked key date that
 * passes while its project is not Done makes that project Stuck.
 */
export const POST = withApi(
  async (request) => {
    const body = await parseJsonBody(request, createKeyDateBody);
    const keyDate = await createKeyDate(body);
    revalidateAllScreens();
    return keyDate;
  },
  { status: 201 },
);
