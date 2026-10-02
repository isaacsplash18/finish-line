import { withApi } from '@/lib/api/handler';
import { revalidateAllScreens } from '@/lib/api/revalidate';
import { computeAndSnapshotToday } from '@/lib/data';

/**
 * POST /api/v1/scores/recompute — same work as the nightly cron and the
 * Settings button: stuck flags → reward gate → Flow → Focus → upsert today's
 * snapshot. Idempotent. Returns the full breakdown.
 */
export const POST = withApi(async () => {
  const result = await computeAndSnapshotToday();
  revalidateAllScreens();
  return result;
});
