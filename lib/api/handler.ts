/**
 * `withApi` — the wrapper every `/api/v1/*` route handler goes through.
 *
 *  1. checks `Authorization: Bearer <API_KEY>` (401 otherwise)
 *  2. resolves the dynamic route params
 *  3. runs the handler, which returns plain data
 *  4. wraps it as `{ ok: true, data }`, or maps any thrown error to
 *     `{ ok: false, error, code }` with the right status (lib/api/errors.ts)
 *
 * Handlers stay thin: parse input (lib/api/validation.ts), call `lib/data/*`,
 * revalidate (lib/api/revalidate.ts), return the result.
 */

import 'server-only';

import { assertApiKey } from './auth';
import { errorResponse } from './errors';

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

type RouteParams = Record<string, string | string[] | undefined>;

export interface WithApiOptions {
  /** HTTP status for a successful response. Default 200. */
  status?: number;
}

export function withApi<P extends RouteParams = RouteParams>(
  handler: (request: Request, params: P) => Promise<unknown>,
  options: WithApiOptions = {},
) {
  return async (request: Request, context: { params: Promise<P> }): Promise<Response> => {
    try {
      assertApiKey(request);
      const params = ((await context?.params) ?? {}) as P;
      const data = await handler(request, params);
      const payload: ApiSuccess<unknown> = { ok: true, data: data ?? null };
      return Response.json(payload, {
        status: options.status ?? 200,
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
