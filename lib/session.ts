/**
 * Finish Line — password-gate session cookie.
 *
 * The whole app is single-user, so there's no session store: the cookie
 * value is just an HMAC-SHA256 signature (keyed by `APP_PASSWORD`) over a
 * fixed payload string. Anyone who knows the password can compute a valid
 * cookie; changing `APP_PASSWORD` invalidates every existing cookie because
 * the signature no longer verifies against the new key.
 *
 * Uses the Web Crypto API (`crypto.subtle`), which is available both in
 * Next.js Middleware's edge runtime and in Node — so this file works
 * unmodified from `middleware.ts` and from the `/login` server action.
 * `crypto.subtle.verify` does the HMAC comparison itself, which is
 * constant-time by construction (no manual byte-by-byte compare needed).
 */

export const SESSION_COOKIE_NAME = 'fl_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

/** Arbitrary fixed string. Only its signature under `APP_PASSWORD` matters. */
const SESSION_PAYLOAD = 'finish-line:authenticated:v1';

const encoder = new TextEncoder();

function importKey(password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Parses a hex string into bytes, or returns `null` if it isn't valid hex. */
function fromHex(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Constant-time string comparison (no early exit on the first mismatch). */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const length = Math.max(aBytes.length, bBytes.length, 1);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

/** Computes the cookie value for a correct `password`. */
export async function createSessionToken(password: string): Promise<string> {
  const key = await importKey(password);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(SESSION_PAYLOAD));
  return toHex(signature);
}

/** Verifies a cookie value against `APP_PASSWORD` in constant time. */
export async function isValidSessionToken(
  token: string | undefined | null,
  password: string,
): Promise<boolean> {
  if (!token || !password) return false;
  const signature = fromHex(token);
  if (!signature) return false;
  const key = await importKey(password);
  // Cast needed: some @types/node + lib.dom combinations infer a manually
  // constructed `Uint8Array` as `Uint8Array<ArrayBufferLike>`, which is not
  // structurally a `BufferSource` even though it is one at runtime.
  return crypto.subtle.verify(
    'HMAC',
    key,
    signature as unknown as BufferSource,
    encoder.encode(SESSION_PAYLOAD),
  );
}
