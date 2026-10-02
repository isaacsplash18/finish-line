'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  timingSafeEqual,
} from '@/lib/session';

export type LoginActionResult = { ok: false; error: string };

/** Small deterrent, not real rate limiting — see ARCHITECTURE.md's brief. */
const FAILURE_DELAY_MS = 600;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loginAction(
  _prev: LoginActionResult | null,
  formData: FormData,
): Promise<LoginActionResult> {
  const password = process.env.APP_PASSWORD;
  const submitted = String(formData.get('password') ?? '');

  if (!password || !timingSafeEqual(submitted, password)) {
    await delay(FAILURE_DELAY_MS);
    return { ok: false, error: 'Wrong password.' };
  }

  const token = await createSessionToken(password);
  const jar = await cookies();
  jar.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: '/',
  });

  redirect('/');
}
