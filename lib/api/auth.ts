/**
 * Bearer-token auth for the REST API (`/api/v1/*`).
 *
 * `middleware.ts` deliberately lets `/api/v1/*` through without the session
 * cookie; every route handler checks `Authorization: Bearer <API_KEY>` itself
 * via `withApi` (lib/api/handler.ts), which calls `assertApiKey` below.
 *
 * Fails closed: if `API_KEY` is not configured on the server, every request
 * is rejected. The comparison is constant-time (`timingSafeEqual` from
 * lib/session.ts) so response timing does not leak how much of a guess was
 * right.
 */

import { timingSafeEqual } from '@/lib/session';

import { ApiError } from './errors';

const BEARER = /^Bearer\s+(.+)$/i;

/** Extracts the token from an `Authorization: Bearer <token>` header. */
export function readBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = BEARER.exec(header.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

/** Pure check: does this Authorization header carry the configured key? */
export function isAuthorized(
  header: string | null | undefined,
  apiKey: string | undefined = process.env.API_KEY,
): boolean {
  if (!apiKey) return false;
  const token = readBearerToken(header);
  if (!token) return false;
  return timingSafeEqual(token, apiKey);
}

/** Throws a 401 `ApiError` unless the request carries the API key. */
export function assertApiKey(
  request: Request,
  apiKey: string | undefined = process.env.API_KEY,
): void {
  if (!apiKey) {
    console.error('[api] API_KEY is not set — rejecting every /api/v1 request.');
  }
  if (!isAuthorized(request.headers.get('authorization'), apiKey)) {
    throw new ApiError(
      401,
      'UNAUTHORIZED',
      'Missing or invalid API key. Send Authorization: Bearer <API_KEY>.',
    );
  }
}

/**
 * `POST /api/v1/hooks/workout` (SPEC-V2 §8) — a separate, low-value token so
 * the public daily-app can tick workouts without ever holding `API_KEY`.
 * Constant-time compare; fails closed when `WORKOUT_HOOK_TOKEN` is unset. The
 * main API key is deliberately NOT accepted here, and this token is accepted
 * nowhere else.
 */
export function assertWorkoutHookToken(
  request: Request,
  token: string | undefined = process.env.WORKOUT_HOOK_TOKEN,
): void {
  if (!token) {
    console.error('[api] WORKOUT_HOOK_TOKEN is not set — rejecting every /hooks/workout request.');
  }
  if (!isAuthorized(request.headers.get('authorization'), token)) {
    throw new ApiError(
      401,
      'UNAUTHORIZED',
      'Missing or invalid hook token. Send Authorization: Bearer <WORKOUT_HOOK_TOKEN>.',
    );
  }
}
