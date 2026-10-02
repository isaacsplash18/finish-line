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

export interface GetKeyDatesOptions {
  /** Only dates today or later. Default false (Settings wants the lot). */
  upcomingOnly?: boolean;
  /** Cap the result. The dashboard uses `config.keyDates.dashboardCount` (5). */
  limit?: number;
}

/**
 * PRD §7 — key dates with their countdowns and linked project pre-resolved.
 * Sorted soonest first.
 */
export async function getKeyDates(
  options: GetKeyDatesOptions = {},
): Promise<KeyDateWithCountdown[]> {
  const supabase = await getSupabaseServerClient();
  const asOf = today();

  let query = supabase.from('key_dates').select('*').order('date', { ascending: true });
  if (options.upcomingOnly) query = query.gte('date', asOf);
  if (options.limit) query = query.limit(options.limit);

  const rows = unwrap(await query, 'getKeyDates');
  const projectIds = [...new Set(rows.map((r) => r.project_id).filter(Boolean))] as UUID[];

  const projects = projectIds.length
    ? unwrap(
        await supabase.from('projects').select('id, name, stage').in('id', projectIds),
        'getKeyDates:projects',
      )
    : [];
  const byId = new Map(projects.map((p) => [p.id, p as Pick<Project, 'id' | 'name' | 'stage'>]));

  return rows.map((row) => ({
    ...row,
    daysAway: daysBetween(asOf, row.date),
    project: row.project_id ? byId.get(row.project_id) ?? null : null,
  }));
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
