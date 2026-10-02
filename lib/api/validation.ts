/**
 * Request parsing for the REST API: JSON bodies, query strings and path ids,
 * validated with zod. Every failure becomes a 400 `ApiError` with
 * `code: 'VALIDATION'`, so handlers never see malformed input.
 *
 * Note this only checks *shape*. Business rules (next action required, kill
 * needs a reason, terminal is terminal, the WIP cap is soft…) stay in
 * `lib/data/*` — the API calls straight through to those functions so the
 * economy is identical to the UI's.
 */

import { z } from 'zod';

import { ApiError } from './errors';

/* ------------------------------------------------------------------ */
/* Reusable field schemas                                              */
/* ------------------------------------------------------------------ */

/** `YYYY-MM-DD`, and a real calendar date. */
export const dateKey = z.iso.date({ message: 'Expected a date as YYYY-MM-DD.' });

/** Permissive UUID (any version) — Postgres `gen_random_uuid()` ids. */
export const uuid = z.guid({ message: 'Expected a UUID.' });

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function validationError(error: z.ZodError): ApiError {
  const issue = error.issues[0];
  const path = issue?.path.map(String).join('.') ?? '';
  const message = issue ? (path ? `${path}: ${issue.message}` : issue.message) : 'Invalid input.';
  return new ApiError(400, 'VALIDATION', message, path || undefined);
}

export function parseWith<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

/**
 * Parse a JSON request body against `schema`. An empty body is treated as
 * `{}`, so endpoints whose fields are all optional can be called bare.
 */
export async function parseJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.output<S>> {
  const text = await request.text();
  let value: unknown = {};
  if (text.trim()) {
    try {
      value = JSON.parse(text);
    } catch {
      throw new ApiError(400, 'VALIDATION', 'Request body must be valid JSON.');
    }
  }
  return parseWith(schema, value);
}

/** Parse the URL's query string against `schema` (values arrive as strings). */
export function parseQuery<S extends z.ZodType>(request: Request, schema: S): z.output<S> {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  return parseWith(schema, params);
}

/** Validate a `[id]` path segment. */
export function parseId(id: string | undefined): string {
  return parseWith(uuid, id);
}

/** `?flag=true|false|1|0` → boolean. */
export const queryBoolean = z
  .enum(['true', 'false', '1', '0'], { message: 'Expected true or false.' })
  .transform((v) => v === 'true' || v === '1');

/** `?n=28` → bounded positive integer. */
export function queryInt(min: number, max: number) {
  return z.coerce
    .number({ message: 'Expected a number.' })
    .int({ message: 'Expected a whole number.' })
    .min(min, { message: `Must be at least ${min}.` })
    .max(max, { message: `Must be at most ${max}.` });
}
