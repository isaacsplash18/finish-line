import { withApi } from '@/lib/api/handler';
import { reviewQuery } from '@/lib/api/schemas';
import { parseQuery } from '@/lib/api/validation';
import { getReviewState } from '@/lib/data';

/**
 * GET /api/v1/review[?weekStart=YYYY-MM-DD] — the Sunday review for a week
 * (default: the week under review today). SPEC-V2 §4.
 */
export const GET = withApi(async (request) => {
  const query = parseQuery(request, reviewQuery);
  return getReviewState(query.weekStart);
});
