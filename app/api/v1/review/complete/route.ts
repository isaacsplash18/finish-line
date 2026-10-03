import { withApi } from '@/lib/api/handler';
import { revalidateAllScreens } from '@/lib/api/revalidate';
import { completeReviewBody } from '@/lib/api/schemas';
import { parseJsonBody } from '@/lib/api/validation';
import { completeReview } from '@/lib/data';

/** POST /api/v1/review/complete {weekStart?} — record the review as done (hides the banner). */
export const POST = withApi(async (request) => {
  const body = await parseJsonBody(request, completeReviewBody);
  const review = await completeReview(body.weekStart);
  revalidateAllScreens();
  return review;
});
