import { withApi } from '@/lib/api/handler';
import { getCounters } from '@/lib/data';

/** GET /api/v1/counters — up-only counters, season + lifetime (SPEC-V2 §3, §7). */
export const GET = withApi(async () => getCounters());
