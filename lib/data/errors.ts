/**
 * Typed errors thrown by `lib/data/*`.
 *
 * Screen code should catch `DomainError` and render `error.message` — the
 * messages are written to be shown to Isaac verbatim, in the app's voice.
 * Anything that is not a `DomainError` is a bug and should bubble.
 */

export type DomainErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'DATABASE';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  /** Field name, when the error is about one specific input. */
  readonly field?: string;

  constructor(code: DomainErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.field = field;
  }
}

/**
 * NOTE (SPEC-CHANGES §1): there is deliberately NO `WipLimitError`.
 * The WIP cap of 3 is a soft, economic cap — `createProject` and
 * `moveProjectStage` never block or throw on it. Read `getWipStatus()` and
 * render the cost copy instead of disabling the control.
 */

export class ValidationError extends DomainError {
  constructor(message: string, field?: string) {
    super('VALIDATION', message, field);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string, id?: string) {
    super('NOT_FOUND', id ? `${what} ${id} not found.` : `${what} not found.`);
    this.name = 'NotFoundError';
  }
}

/** PRD §3.2.4 — Done / Killed / Abandoned are final. No archive-and-forget. */
export class InvalidTransitionError extends DomainError {
  constructor(message: string) {
    super('INVALID_TRANSITION', message);
    this.name = 'InvalidTransitionError';
  }
}

export class DatabaseError extends DomainError {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super('DATABASE', message);
    this.name = 'DatabaseError';
    this.cause = cause;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

/**
 * A Supabase `{ data, error }` result. Written as a generic over the *whole*
 * result object rather than over `data`, because postgrest-js returns a
 * discriminated union (`{data: T, error: null} | {data: null, error: E}`) and
 * inferring `T` out of that union collapses it to `never`.
 */
export type SupabaseResult = { data: unknown; error: { message: string } | null };

/** Narrow a Supabase result or throw a `DatabaseError`. */
export function unwrap<R extends SupabaseResult>(
  result: R,
  context: string,
): NonNullable<R['data']> {
  if (result.error) throw new DatabaseError(`${context}: ${result.error.message}`, result.error);
  if (result.data == null) throw new DatabaseError(`${context}: no data returned`);
  return result.data as NonNullable<R['data']>;
}

/** Same as `unwrap`, but tolerates a null payload (e.g. `.maybeSingle()`). */
export function unwrapNullable<R extends SupabaseResult>(
  result: R,
  context: string,
): R['data'] | null {
  if (result.error) throw new DatabaseError(`${context}: ${result.error.message}`, result.error);
  return result.data ?? null;
}

/** Trim and require a non-empty string. */
export function requireText(value: unknown, field: string, message?: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new ValidationError(message ?? `${field} is required.`, field);
  return text;
}

/* ------------------------------------------------------------------ */
/* v2 helpers                                                          */
/* ------------------------------------------------------------------ */

/**
 * True when Postgres / PostgREST says the table (or column) does not exist —
 * i.e. migration 0002_v2.sql has not been applied yet. Lets the read paths
 * degrade to "no v2 data" instead of taking the whole app down.
 */
export function isMissingSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: string; message?: string };
  if (code && ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code)) return true;
  return typeof message === 'string' && /does not exist|schema cache/i.test(message);
}

const warnedMissing = new Set<string>();

/**
 * `unwrap` for reads of v2 tables: a missing table/column (migration not yet
 * applied) yields `fallback` and one console warning per context, every other
 * error still throws.
 */
export function unwrapOptional<R extends SupabaseResult, F>(
  result: R,
  context: string,
  fallback: F,
): NonNullable<R['data']> | F {
  if (result.error && isMissingSchemaError(result.error)) {
    if (!warnedMissing.has(context)) {
      warnedMissing.add(context);
      console.warn(
        `[data] ${context}: ${result.error.message} — has supabase/migrations/0002_v2.sql been applied?`,
      );
    }
    return fallback;
  }
  if (result.error) throw new DatabaseError(`${context}: ${result.error.message}`, result.error);
  return (result.data ?? fallback) as NonNullable<R['data']> | F;
}

/** PostgREST's default `max_rows`. */
export const PAGE_SIZE = 1000;

/**
 * Read every row of a query, page by page, so a table that outgrows
 * PostgREST's 1000-row cap never silently truncates a score. `page(from, to)`
 * must return the same ordered query with `.range(from, to)` applied. The
 * first page is one request; more pages only happen when it comes back full.
 *
 * `optional: true` treats a missing table (migration not applied) as empty.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  context: string,
  options: { optional?: boolean } = {},
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await page(from, from + PAGE_SIZE - 1);
    const data = options.optional
      ? (unwrapOptional(result, context, [] as T[]) as T[])
      : (unwrap(result, context) as T[]);
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}
