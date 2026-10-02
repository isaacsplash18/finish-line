import { withApi } from '@/lib/api/handler';
import { getWipStatus } from '@/lib/data';

/** GET /api/v1/wip — soft WIP cap status and the price of one more activation. */
export const GET = withApi(async () => getWipStatus());
