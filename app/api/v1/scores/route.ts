import { withApi } from '@/lib/api/handler';
import { listScoresQuery } from '@/lib/api/schemas';
import { parseQuery } from '@/lib/api/validation';
import { getScoreSnapshots } from '@/lib/data';

/** GET /api/v1/scores[?days=30] — daily Flow/Focus snapshots, oldest first. */
export const GET = withApi(async (request) => {
  const query = parseQuery(request, listScoresQuery);
  return getScoreSnapshots(query.days ?? 30);
});
