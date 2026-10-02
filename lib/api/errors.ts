/**
 * REST API (`/api/v1/*`) error mapping.
 *
 * Every failure leaves the API as `{ ok: false, error, code }` with an HTTP
 * status derived from the error:
 *
 *   ApiError            → its own status + code (auth, bad JSON, bad body)
 *   DomainError         → VALIDATION 400, NOT_FOUND 404,
 *                         INVALID_TRANSITION 409, DATABASE 500
 *   anything else       → 500 with a generic message; the real error is
 *                         logged server-side only (it is a bug, and its
 *                         message may contain internals)
 *
 * Pure apart from the `console.error` — no Next.js imports — so it is unit
 * tested directly (`errors.test.ts`).
 */

import { isDomainError, type DomainErrorCode } from '@/lib/data/errors';

export type ApiErrorCode = DomainErrorCode | 'UNAUTHORIZED' | 'INTERNAL';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly field?: string;

  constructor(status: number, code: ApiErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export interface ApiErrorBody {
  ok: false;
  error: string;
  code: ApiErrorCode;
  field?: string;
}

export interface MappedError {
  status: number;
  body: ApiErrorBody;
}

export const DOMAIN_STATUS: Record<DomainErrorCode, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  DATABASE: 500,
};

export const GENERIC_ERROR_MESSAGE = 'Something went wrong on the server.';

function body(code: ApiErrorCode, error: string, field?: string): ApiErrorBody {
  return field ? { ok: false, error, code, field } : { ok: false, error, code };
}

/** Turn any thrown value into an HTTP status + error envelope. */
export function mapError(error: unknown): MappedError {
  if (error instanceof ApiError) {
    return { status: error.status, body: body(error.code, error.message, error.field) };
  }
  if (isDomainError(error)) {
    if (error.code === 'DATABASE') console.error('[api] database error', error);
    return { status: DOMAIN_STATUS[error.code], body: body(error.code, error.message, error.field) };
  }
  console.error('[api] unhandled error', error);
  return { status: 500, body: body('INTERNAL', GENERIC_ERROR_MESSAGE) };
}

export function errorResponse(error: unknown): Response {
  const { status, body: payload } = mapError(error);
  return Response.json(payload, { status });
}
