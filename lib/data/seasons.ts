import 'server-only';

import { cache } from 'react';

import { getSupabaseServerClient } from '@/lib/supabase/server';
import type { Season } from '@/lib/types';

import { DatabaseError, unwrap, unwrapOptional } from './errors';

/**
 * SPEC-V2 §7 — "Start a new season" instead of a wipe. The latest `seasons`
 * row is the current season: season counters count from its `started_at`, and
 * terminal projects that ended before it are hidden from the board by default
 * (`buildProjects({ seasonStartedAt })`). Nothing is ever deleted.
 */

/** Uncached: the current (latest) season, or null if there is none / pre-migration. */
export async function fetchCurrentSeason(): Promise<Season | null> {
  const supabase = await getSupabaseServerClient();
  const rows = unwrapOptional(
    await supabase.from('seasons').select('*').order('started_at', { ascending: false }).limit(1),
    'getCurrentSeason',
    [] as Season[],
  );
  return rows[0] ?? null;
}

/** The current season, deduped per request. */
export const getCurrentSeason = cache(fetchCurrentSeason);

/**
 * Start a new season now. `name` defaults to "Season N". Counters restart from
 * this moment; history (projects, events, snapshots) is untouched.
 */
export async function startSeason(name?: string | null): Promise<Season> {
  const supabase = await getSupabaseServerClient();
  const { count, error } = await supabase
    .from('seasons')
    .select('id', { count: 'exact', head: true });
  if (error) throw new DatabaseError(`startSeason:count: ${error.message}`, error);

  const label = typeof name === 'string' && name.trim() ? name.trim() : `Season ${(count ?? 0) + 1}`;
  return unwrap(
    await supabase
      .from('seasons')
      .insert({ name: label, started_at: new Date().toISOString() })
      .select('*')
      .single(),
    'startSeason',
  );
}
