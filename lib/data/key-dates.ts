import 'server-only';

import { config } from '@/lib/config';
import { daysBetween, today } from '@/lib/dates';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type {
  CreateKeyDateInput,
  KeyDate,
  KeyDateWithCountdown,
  Project,
  UpdateKeyDateInput,
  UUID,
} from '@/lib/types';

import { ValidationError, requireText, unwrap, unwrapNullable } from './errors';
import { getAllProjectRows } from './projects';

export interface GetKeyDatesOptions {
  /** Only dates today or later. Default false (Settings wants the lot). */
  upcomingOnly?: boolean;
  /** Cap the result. The dashboard uses `config.keyDates.dashboardCount` (5). */
  limit?: number;
}

/**
 * Raw key-date rows (uncached). Split out so the dashboard can fetch them in
 * the same parallel batch as everything else and decorate in memory.
 */
export async function fetchKeyDateRows(options: GetKeyDatesOptions = {}): Promise<KeyDate[]> {
  const supabase = await getSupabaseServerClient();

  let query = supabase.from('key_dates').select('*').order('date', { ascending: true });
  if (options.upcomingOnly) query = query.gte('date', today());
  if (options.limit) query = query.limit(options.limit);

  return unwrap(await query, 'getKeyDates');
}

/**
 * Pure: attach the countdown and the linked project's name/stage. `projects`
 * is any list that includes the linked ones (the full portfolio is fine).
 */
export function decorateKeyDates(
  rows: readonly KeyDate[],
  projects: readonly Pick<Project, 'id' | 'name' | 'stage'>[],
): KeyDateWithCountdown[] {
  const asOf = today();
  const byId = new Map(
    projects.map((p) => [p.id, { id: p.id, name: p.name, stage: p.stage }] as const),
  );
  return rows.map((row) => ({
    ...row,
    daysAway: daysBetween(asOf, row.date),
    project: row.project_id ? byId.get(row.project_id) ?? null : null,
  }));
}

/**
 * PRD §7 — key dates with their countdowns and linked project pre-resolved.
 * Sorted soonest first.
 *
 * The linked project names come from the (per-request deduped) projects read,
 * fetched in parallel with the key dates — no second sequential trip.
 */
export async function getKeyDates(
  options: GetKeyDatesOptions = {},
): Promise<KeyDateWithCountdown[]> {
  const [rows, projects] = await Promise.all([fetchKeyDateRows(options), getAllProjectRows()]);
  return decorateKeyDates(rows, projects);
}

/** One key date by id, or null. */
export async function getKeyDate(id: UUID): Promise<KeyDate | null> {
  const supabase = await getSupabaseServerClient();
  return unwrapNullable(
    await supabase.from('key_dates').select('*').eq('id', id).maybeSingle(),
    'getKeyDate',
  );
}

/** PRD §7.2 — the next N as countdown chips on the dashboard. */
export async function getUpcomingKeyDates(
  limit = config.keyDates.dashboardCount,
): Promise<KeyDateWithCountdown[]> {
  return getKeyDates({ upcomingOnly: true, limit });
}

export async function createKeyDate(input: CreateKeyDateInput): Promise<KeyDate> {
  const supabase = await getSupabaseServerClient();
  const name = requireText(input.name, 'name');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '')) {
    throw new ValidationError('Pick a date.', 'date');
  }

  return unwrap(
    await supabase
      .from('key_dates')
      .insert({ name, date: input.date, project_id: input.project_id ?? null })
      .select('*')
      .single(),
    'createKeyDate',
  );
}

export async function updateKeyDate(id: UUID, input: UpdateKeyDateInput): Promise<KeyDate> {
  const supabase = await getSupabaseServerClient();
  const patch: Partial<KeyDate> = {};
  if (input.name !== undefined) patch.name = requireText(input.name, 'name');
  if (input.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new ValidationError('Invalid date.', 'date');
    patch.date = input.date;
  }
  if (input.project_id !== undefined) patch.project_id = input.project_id;

  return unwrap(
    await supabase.from('key_dates').update(patch).eq('id', id).select('*').single(),
    'updateKeyDate',
  );
}

export async function deleteKeyDate(id: UUID): Promise<void> {
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.from('key_dates').delete().eq('id', id);
  if (error) throw new ValidationError(error.message);
}
