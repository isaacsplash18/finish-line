import { withApi } from '@/lib/api/handler';
import { revalidateAllScreens } from '@/lib/api/revalidate';
import { syncGithubProgress } from '@/lib/data';

/**
 * POST /api/v1/github/sync — "Check now" (SPEC-V2 §6). Fetches the last 7
 * days of commits for every linked repo and records commit days as progress.
 * Never fails on GitHub's account: per-repo status is in the result.
 */
export const POST = withApi(async () => {
  const result = await syncGithubProgress();
  if (result.inserted > 0) revalidateAllScreens();
  return result;
});
