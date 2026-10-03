import { assertWorkoutHookToken } from '@/lib/api/auth';
import { withApi } from '@/lib/api/handler';
import { revalidateRoutineScreens } from '@/lib/api/revalidate';
import { logWorkoutFromHook } from '@/lib/data';

/**
 * CORS: the caller is the static daily-app page in a browser. The token rides
 * in the Authorization header (no cookies), so a wildcard origin is safe.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

/**
 * POST /api/v1/hooks/workout — increments TODAY's Workouts routine by one
 * (SPEC-V2 §8). Guarded by its own `WORKOUT_HOOK_TOKEN` (constant-time; 401
 * otherwise — the main API_KEY is not accepted). The body is ignored: the
 * caller cannot choose the routine, the date or the count.
 */
export const POST = withApi(
  async () => {
    const result = await logWorkoutFromHook();
    revalidateRoutineScreens();
    return { routine: result.routine, date: result.check.date, count: result.check.count };
  },
  { auth: (request) => assertWorkoutHookToken(request), headers: CORS },
);

/** CORS preflight. */
export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}
