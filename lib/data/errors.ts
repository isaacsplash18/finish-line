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
