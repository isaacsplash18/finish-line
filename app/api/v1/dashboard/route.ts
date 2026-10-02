import { withApi } from '@/lib/api/handler';
import { getDashboardData } from '@/lib/data';

/** GET /api/v1/dashboard — everything the Dashboard screen renders. */
export const GET = withApi(async () => getDashboardData());
