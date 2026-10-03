import { withApi } from '@/lib/api/handler';
import { getTodaysMove } from '@/lib/data';

/** GET /api/v1/moves/today — the one card on the home screen (SPEC-V2 §1). */
export const GET = withApi(async () => getTodaysMove());
