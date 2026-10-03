import { withApi } from '@/lib/api/handler';
import { getFocusWeek } from '@/lib/data';

/** GET /api/v1/focus/week — this week's live Focus with one line per delta type (SPEC-V2 §3). */
export const GET = withApi(async () => getFocusWeek());
