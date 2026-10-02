import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DatabaseError,
  DomainError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
} from '@/lib/data/errors';

import { ApiError, GENERIC_ERROR_MESSAGE, errorResponse, mapError } from './errors';

afterEach(() => {
  vi.restoreAllMocks();
});

function silenceConsole() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('mapError — DomainError codes', () => {
  it('VALIDATION → 400, keeps message and field', () => {
    const mapped = mapError(new ValidationError('Every project needs a next action.', 'next_action'));
    expect(mapped).toEqual({
      status: 400,
      body: {
        ok: false,
        error: 'Every project needs a next action.',
        code: 'VALIDATION',
        field: 'next_action',
      },
    });
  });

  it('NOT_FOUND → 404', () => {
    const mapped = mapError(new NotFoundError('Project', 'abc'));
    expect(mapped.status).toBe(404);
    expect(mapped.body).toEqual({ ok: false, error: 'Project abc not found.', code: 'NOT_FOUND' });
  });

  it('INVALID_TRANSITION → 409', () => {
    const mapped = mapError(new InvalidTransitionError('That is final.'));
    expect(mapped.status).toBe(409);
    expect(mapped.body.code).toBe('INVALID_TRANSITION');
    expect(mapped.body.error).toBe('That is final.');
  });

  it('DATABASE → 500 and is logged', () => {
    const spy = silenceConsole();
    const mapped = mapError(new DatabaseError('getProjects: connection refused'));
    expect(mapped.status).toBe(500);
    expect(mapped.body.code).toBe('DATABASE');
    expect(spy).toHaveBeenCalled();
  });

  it('a bare DomainError maps by its code', () => {
    expect(mapError(new DomainError('NOT_FOUND', 'gone')).status).toBe(404);
  });
});

describe('mapError — ApiError', () => {
  it('uses its own status and code', () => {
    const mapped = mapError(new ApiError(401, 'UNAUTHORIZED', 'Missing or invalid API key.'));
    expect(mapped).toEqual({
      status: 401,
      body: { ok: false, error: 'Missing or invalid API key.', code: 'UNAUTHORIZED' },
    });
  });
});

describe('mapError — unknown errors', () => {
  it('→ 500 with a generic message, real error logged not leaked', () => {
    const spy = silenceConsole();
    const secret = new Error('relation "projects" does not exist at 10.0.0.3');
    const mapped = mapError(secret);
    expect(mapped.status).toBe(500);
    expect(mapped.body).toEqual({ ok: false, error: GENERIC_ERROR_MESSAGE, code: 'INTERNAL' });
    expect(JSON.stringify(mapped.body)).not.toContain('10.0.0.3');
    expect(spy).toHaveBeenCalledWith(expect.any(String), secret);
  });

  it('handles non-Error throwables', () => {
    silenceConsole();
    expect(mapError('boom').status).toBe(500);
    expect(mapError(undefined).body.code).toBe('INTERNAL');
  });
});

describe('errorResponse', () => {
  it('builds a JSON Response with the mapped status', async () => {
    const response = errorResponse(new InvalidTransitionError('Final.'));
    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ ok: false, error: 'Final.', code: 'INVALID_TRANSITION' });
  });
});
