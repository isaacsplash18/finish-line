import { withApi } from '@/lib/api/handler';
import { revalidateAllScreens } from '@/lib/api/revalidate';
import { createSeasonBody } from '@/lib/api/schemas';
import { parseJsonBody } from '@/lib/api/validation';
import { getCurrentSeason, startSeason } from '@/lib/data';

/** GET /api/v1/seasons — the current season (null if none). */
export const GET = withApi(async () => getCurrentSeason());

/**
 * POST /api/v1/seasons {name?} — start a new season now (SPEC-V2 §7). Season
 * counters restart; last season's terminal projects drop off the board;
 * history is untouched.
 */
export const POST = withApi(
  async (request) => {
    const body = await parseJsonBody(request, createSeasonBody);
    const season = await startSeason(body.name);
    revalidateAllScreens();
    return season;
  },
  { status: 201 },
);
