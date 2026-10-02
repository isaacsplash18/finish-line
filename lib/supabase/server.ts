import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import type { Database } from '@/lib/types';
import { requireSupabaseEnv } from './env';

export type { Database } from '@/lib/types';
export { SupabaseConfigError, isSupabaseConfigured } from './env';

export type SupabaseServerClient = ReturnType<typeof createServerClient<Database>>;

/**
 * Supabase client for server components, server actions and route handlers.
 *
 * Always call this per request — never hoist the result into a module-level
 * constant, because it closes over the request's cookie jar.
 *
 * ```ts
 * const supabase = await getSupabaseServerClient();
 * const { data } = await supabase.from('projects').select('*');
 * ```
 *
 * Throws `SupabaseConfigError` when env vars are missing. It never throws at
 * import time, so `next build` succeeds without a `.env.local`.
 */
export async function getSupabaseServerClient(): Promise<SupabaseServerClient> {
  const { url, anonKey } = requireSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a server component, where cookies are read-only.
          // Safe to ignore: middleware / route handlers refresh the session.
        }
      },
    },
  });
}

/** Alias matching the Supabase docs' naming, for muscle memory. */
export const createClient = getSupabaseServerClient;
