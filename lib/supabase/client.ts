'use client';

import { createBrowserClient } from '@supabase/ssr';

import type { Database } from '@/lib/types';
import { requireSupabaseEnv } from './env';

export { SupabaseConfigError, isSupabaseConfigured } from './env';

export type SupabaseBrowserClient = ReturnType<typeof createBrowserClient<Database>>;

let cached: SupabaseBrowserClient | null = null;

/**
 * Supabase client for client components (realtime subscriptions, optimistic
 * check-offs, auth). Prefer server actions in `lib/data/` for mutations —
 * reach for this only when you genuinely need the browser.
 *
 * Throws `SupabaseConfigError` when env vars are missing; call
 * `isSupabaseConfigured()` first if you want to degrade gracefully.
 */
export function getSupabaseBrowserClient(): SupabaseBrowserClient {
  if (cached) return cached;
  const { url, anonKey } = requireSupabaseEnv();
  cached = createBrowserClient<Database>(url, anonKey);
  return cached;
}

/** Alias matching the Supabase docs' naming, for muscle memory. */
export const createClient = getSupabaseBrowserClient;
