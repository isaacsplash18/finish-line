import { describe, expect, it, vi } from 'vitest';

import { assertApiKey, isAuthorized, readBearerToken } from './auth';
import { ApiError, mapError } from './errors';

const KEY = 'test-key_0123456789abcdefghijklmnopqrstuvwxyz';

function request(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/v1/dashboard', { headers });
}

describe('readBearerToken', () => {
  it('extracts the token', () => {
    expect(readBearerToken(`Bearer ${KEY}`)).toBe(KEY);
    expect(readBearerToken(`bearer   ${KEY}  `)).toBe(KEY);
  });

  it('returns null for missing or non-bearer headers', () => {
    expect(readBearerToken(null)).toBeNull();
    expect(readBearerToken('')).toBeNull();
    expect(readBearerToken('Bearer ')).toBeNull();
    expect(readBearerToken(`Basic ${KEY}`)).toBeNull();
    expect(readBearerToken(KEY)).toBeNull();
  });
});

describe('isAuthorized', () => {
  it('rejects a missing header', () => {
    expect(isAuthorized(null, KEY)).toBe(false);
    expect(isAuthorized(undefined, KEY)).toBe(false);
  });

  it('rejects a wrong token', () => {
    expect(isAuthorized('Bearer nope', KEY)).toBe(false);
    expect(isAuthorized(`Bearer ${KEY}x`, KEY)).toBe(false);
    expect(isAuthorized(`Bearer ${KEY.slice(0, -1)}`, KEY)).toBe(false);
  });

  it('accepts the right token', () => {
    expect(isAuthorized(`Bearer ${KEY}`, KEY)).toBe(true);
  });

  it('fails closed when no API key is configured', () => {
    expect(isAuthorized('Bearer ', '')).toBe(false);
    expect(isAuthorized('Bearer anything', undefined)).toBe(false);
  });
});

describe('assertApiKey', () => {
  it('throws a 401 ApiError when the header is missing', () => {
    expect(() => assertApiKey(request(), KEY)).toThrow(ApiError);
    try {
      assertApiKey(request(), KEY);
    } catch (error) {
      const mapped = mapError(error);
      expect(mapped.status).toBe(401);
      expect(mapped.body).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
    }
  });

  it('throws a 401 ApiError when the token is wrong', () => {
    const wrong = request({ authorization: 'Bearer wrong-key' });
    expect(() => assertApiKey(wrong, KEY)).toThrow(ApiError);
    expect(mapError(captured(() => assertApiKey(wrong, KEY))).status).toBe(401);
  });

  it('passes with the right token', () => {
    expect(() => assertApiKey(request({ authorization: `Bearer ${KEY}` }), KEY)).not.toThrow();
  });

  it('rejects everything (and logs) when API_KEY is unset', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => assertApiKey(request({ authorization: 'Bearer ' }), undefined)).toThrow(ApiError);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

function captured(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}
