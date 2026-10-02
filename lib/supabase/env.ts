/**
 * Supabase environment plumbing.
 *
 * Both clients read `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
 * Nothing is hard-coded and nothing throws at module load — that would break
 * `next build` on a machine without `.env.local`. Failures surface lazily, when
 * a client is actually constructed, as a typed `SupabaseConfigError`.
 *
 * Note: `process.env.NEXT_PUBLIC_*` must be referenced as a full literal
 * expression for Next.js to inline it into the client bundle. Do not refactor
 * these into dynamic lookups.
 */

export class SupabaseConfigError extends Error {
  readonly code = 'SUPABASE_NOT_CONFIGURED';

  constructor() {
    super(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (see .env.example).',
    );
    this.name = 'SupabaseConfigError';
  }
}

export function getSupabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || undefined;
}

export function getSupabaseAnonKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined;
}

/**
 * Cheap, throw-free check. Use this in a server component to render a
 * "connect Supabase" empty state instead of blowing up the page.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

/** Returns the pair or throws `SupabaseConfigError`. */
export function requireSupabaseEnv(): { url: string; anonKey: string } {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey) throw new SupabaseConfigError();
  return { url, anonKey };
}
