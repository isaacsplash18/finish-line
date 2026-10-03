import 'server-only';

import { cache } from 'react';

import { config } from '@/lib/config';
import { addDays, today } from '@/lib/dates';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type { DailyMove, DateKey, ProgressEvent, ProgressKind, UUID } from '@/lib/types';

import { DatabaseError, fetchAllRows } from './errors';

/**
 * Low-level reads/writes for the v2 `progress_events` and `daily_moves`
 * tables (SPEC-V2 §1, §2). A leaf module: `projects.ts` writes progress from
 * here without an import cycle.
 *
 * Every read is `optional`: until migration 0002 is applied the tables do not
 * exist, and the readers return [] (with one console warning) rather than
 * breaking v1 screens.
 */

/** Start of the window `progress_events` are read over for stuck + Today's move. */
export function progressLookbackStart(asOf: DateKey = today()): DateKey {
  return addDays(asOf, -config.projects.progressLookbackDays);
}

/** Uncached: progress events with `day >= from`, oldest first, all pages. */
export async function fetchProgressEventsSince(from: DateKey): Promise<ProgressEvent[]> {
  const supabase = await getSupabaseServerClient();
  return fetchAllRows<ProgressEvent>(
    (lo, hi) =>
      supabase
        .from('progress_events')
        .select('*')
        .gte('day', from)
        .order('day', { ascending: true })
        .order('id', { ascending: true })
        .range(lo, hi),
    'fetchProgressEventsSince',
    { optional: true },
  );
}

/** Per-request deduped `fetchProgressEventsSince`. */
export const getProgressEventsSince = cache(fetchProgressEventsSince);

/**
 * Uncached: every Did-it ever (just `project_id`, `day`) — feeds the up-only
 * "Did-it days" counter. Tiny rows, paged.
 */
export async function fetchDidItEvents(): Promise<Pick<ProgressEvent, 'project_id' | 'day' | 'kind'>[]> {
  const supabase = await getSupabaseServerClient();
  return fetchAllRows<Pick<ProgressEvent, 'project_id' | 'day' | 'kind'>>(
    (lo, hi) =>
      supabase
        .from('progress_events')
        .select('project_id, day, kind')
        .eq('kind', 'did_it')
        .order('day', { ascending: true })
        .order('project_id', { ascending: true })
        .range(lo, hi),
    'fetchDidItEvents',
    { optional: true },
  );
}

export const getDidItEvents = cache(fetchDidItEvents);

/** Uncached: `daily_moves` with `day >= from`, oldest first. */
export async function fetchDailyMovesSince(from: DateKey): Promise<DailyMove[]> {
  const supabase = await getSupabaseServerClient();
  return fetchAllRows<DailyMove>(
    (lo, hi) =>
      supabase
        .from('daily_moves')
        .select('*')
        .gte('day', from)
        .order('day', { ascending: true })
        .order('id', { ascending: true })
        .range(lo, hi),
    'fetchDailyMovesSince',
    { optional: true },
  );
}

export const getDailyMovesSince = cache(fetchDailyMovesSince);

/** Start of the `daily_moves` window that feeds the round-robin tiebreak. */
export function rotationLookbackStart(asOf: DateKey = today()): DateKey {
  return addDays(asOf, -config.todaysMove.rotationLookbackDays);
}

/**
 * Record a progress signal. Idempotent — the table is unique on
 * (project_id, kind, day), duplicates are ignored.
 *
 * `bestEffort: true` (used by the stage-move / next-action writes) logs and
 * swallows a failure instead of throwing: those writes are a secondary record —
 * the `stage_changed_at` / `next_action_updated_at` clocks on the row already
 * carry the same signal — so a missing table must never block a stage move.
 */
export async function recordProgress(
  projectId: UUID,
  kind: ProgressKind,
  day: DateKey = today(),
  options: { bestEffort?: boolean } = {},
): Promise<boolean> {
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase
    .from('progress_events')
    .upsert(
      { project_id: projectId, kind, day },
      { onConflict: 'project_id,kind,day', ignoreDuplicates: true },
    );
  if (!error) return true;
  if (options.bestEffort) {
    console.warn(`[data] recordProgress(${kind}) skipped: ${error.message}`);
    return false;
  }
  throw new DatabaseError(`recordProgress: ${error.message}`, error);
}
