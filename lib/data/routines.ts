import 'server-only';

import { cache } from 'react';

import { config } from '@/lib/config';
import { addDays, dayOfWeek, lastNDates, today } from '@/lib/dates';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type {
  CreateRoutineInput,
  DateKey,
  Routine,
  RoutineCheck,
  RoutineWithChecks,
  UpdateRoutineInput,
  UUID,
} from '@/lib/types';

import { NotFoundError, ValidationError, requireText, unwrap, unwrapNullable } from './errors';

/* ================================================================== */
/* Reads                                                              */
/* ================================================================== */

/** Uncached read. Writers and the recompute job use this so they never see a stale copy. */
export async function fetchRoutines(includeInactive = false): Promise<Routine[]> {
  const supabase = await getSupabaseServerClient();
  let query = supabase.from('routines').select('*').order('sort_order', { ascending: true });
  if (!includeInactive) query = query.eq('active', true);
  return unwrap(await query, 'getRoutines');
}

const getRoutinesCached = cache(fetchRoutines);

/** Routines, deduped per request (primitive arg, so `React.cache` can key on it). */
export async function getRoutines(includeInactive = false): Promise<Routine[]> {
  return getRoutinesCached(includeInactive);
}

export async function getRoutine(id: UUID): Promise<Routine | null> {
  const supabase = await getSupabaseServerClient();
  return unwrapNullable(
    await supabase.from('routines').select('*').eq('id', id).maybeSingle(),
    'getRoutine',
  );
}

/** The routine that marks a day as rest (PRD §5.2.2). Null if none configured. */
export async function getSabbathRoutine(): Promise<Routine | null> {
  const supabase = await getSupabaseServerClient();
  const rows = unwrap(
    await supabase.from('routines').select('*').eq('is_sabbath', true).limit(1),
    'getSabbathRoutine',
  );
  return rows[0] ?? null;
}

/** Uncached raw checks in a date range, inclusive. */
export async function fetchRoutineChecks(from: DateKey, to: DateKey): Promise<RoutineCheck[]> {
  const supabase = await getSupabaseServerClient();
  return unwrap(
    await supabase
      .from('routine_checks')
      .select('*')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true }),
    'getRoutineChecks',
  );
}

const getRoutineChecksCached = cache(fetchRoutineChecks);

/** Raw checks in a date range, inclusive, deduped per request. Feeds `computeFlowScore`. */
export async function getRoutineChecks(from: DateKey, to: DateKey): Promise<RoutineCheck[]> {
  return getRoutineChecksCached(from, to);
}

/**
 * Pure: routines + their check history in the shape the heat calendar wants.
 * `getRoutinesWithChecks` and the dashboard both use it.
 */
export function buildRoutinesWithChecks(
  routines: readonly Routine[],
  checks: readonly RoutineCheck[],
  asOf: DateKey = today(),
): RoutineWithChecks[] {
  const windowKeys = new Set(lastNDates(config.flow.windowDays, asOf));

  return routines.map((routine) => {
    const checksByDate: Record<DateKey, number> = {};
    let windowCount = 0;
    for (const check of checks) {
      if (check.routine_id !== routine.id) continue;
      checksByDate[check.date] = check.count;
      if (check.count > 0 && windowKeys.has(check.date)) windowCount += check.count;
    }
    return {
      ...routine,
      checksByDate,
      doneToday: (checksByDate[asOf] ?? 0) > 0,
      windowCount,
    };
  });
}

/**
 * Routines plus their recent history, ready for the Beaver-Habits-style heat
 * calendar (PRD §5.3.1). `days` defaults to the 4-week view.
 */
export async function getRoutinesWithChecks(options: {
  days?: number;
  asOf?: DateKey;
  includeInactive?: boolean;
} = {}): Promise<RoutineWithChecks[]> {
  const asOf = options.asOf ?? today();
  const days = options.days ?? config.ui.heatCalendarWeeks * 7;
  const from = addDays(asOf, -(days - 1));

  const [routines, checks] = await Promise.all([
    getRoutines(options.includeInactive ?? false),
    getRoutineChecks(from, asOf),
  ]);

  return buildRoutinesWithChecks(routines, checks, asOf);
}

/**
 * Pure: the sabbath dates already present in a loaded `getRoutinesWithChecks`
 * result. Lets a screen that has the routines in hand skip a second round of
 * routine/check queries.
 */
export function sabbathDaysOf(routines: readonly RoutineWithChecks[]): DateKey[] {
  const sabbath = routines.find((r) => r.is_sabbath);
  if (!sabbath) return [];
  return Object.entries(sabbath.checksByDate)
    .filter(([, count]) => count > 0)
    .map(([date]) => date)
    .sort();
}

/**
 * Dates in the range that are marked as sabbath.
 *
 * Pass `preloaded` routines and/or checks you already have to avoid re-querying
 * them; whichever is missing is fetched (in parallel).
 */
export async function getSabbathDays(
  from: DateKey,
  to: DateKey,
  preloaded: { routines?: readonly Routine[]; checks?: readonly RoutineCheck[] } = {},
): Promise<DateKey[]> {
  const [sabbath, checks] = await Promise.all([
    preloaded.routines
      ? Promise.resolve(preloaded.routines.find((r) => r.is_sabbath) ?? null)
      : getSabbathRoutine(),
    preloaded.checks ? Promise.resolve(preloaded.checks) : getRoutineChecks(from, to),
  ]);
  if (!sabbath) return [];
  return checks
    .filter((c) => c.routine_id === sabbath.id && c.count > 0 && c.date >= from && c.date <= to)
    .map((c) => c.date);
}

/* ================================================================== */
/* Writes                                                             */
/* ================================================================== */

export async function createRoutine(input: CreateRoutineInput): Promise<Routine> {
  const supabase = await getSupabaseServerClient();
  const name = requireText(input.name, 'name');
  const target = Number(input.weekly_target);
  if (!Number.isInteger(target) || target < 1) {
    throw new ValidationError('Weekly target must be a whole number of 1 or more.', 'weekly_target');
  }

  if (input.is_sabbath) await clearExistingSabbathFlag();

  return unwrap(
    await supabase
      .from('routines')
      .insert({
        name,
        cadence: input.cadence,
        weekly_target: target,
        active: input.active ?? true,
        is_sabbath: input.is_sabbath ?? false,
        sort_order: input.sort_order ?? 100,
      })
      .select('*')
      .single(),
    'createRoutine',
  );
}

export async function updateRoutine(id: UUID, input: UpdateRoutineInput): Promise<Routine> {
  const supabase = await getSupabaseServerClient();
  const patch: Partial<Routine> = {};
  if (input.name !== undefined) patch.name = requireText(input.name, 'name');
  if (input.cadence !== undefined) patch.cadence = input.cadence;
  if (input.weekly_target !== undefined) {
    const target = Number(input.weekly_target);
    if (!Number.isInteger(target) || target < 1) {
      throw new ValidationError('Weekly target must be a whole number of 1 or more.', 'weekly_target');
    }
    patch.weekly_target = target;
  }
  if (input.active !== undefined) patch.active = input.active;
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
  if (input.is_sabbath !== undefined) {
    if (input.is_sabbath) await clearExistingSabbathFlag(id);
    patch.is_sabbath = input.is_sabbath;
  }

  return unwrap(
    await supabase.from('routines').update(patch).eq('id', id).select('*').single(),
    'updateRoutine',
  );
}

/**
 * Soft-delete by default: history is worth keeping and an inactive routine
 * drops out of the Flow maths anyway. Pass `{ hard: true }` to really remove it
 * (cascades to its checks).
 */
export async function deleteRoutine(id: UUID, options: { hard?: boolean } = {}): Promise<void> {
  const supabase = await getSupabaseServerClient();
  if (options.hard) {
    const { error } = await supabase.from('routines').delete().eq('id', id);
    if (error) throw new ValidationError(error.message);
    return;
  }
  await supabase.from('routines').update({ active: false }).eq('id', id);
}

async function clearExistingSabbathFlag(exceptId?: UUID): Promise<void> {
  const supabase = await getSupabaseServerClient();
  let query = supabase.from('routines').update({ is_sabbath: false }).eq('is_sabbath', true);
  if (exceptId) query = query.neq('id', exceptId);
  await query;
}

/**
 * PRD §5.3.1 — one tap. Upserts exactly one row per routine per date.
 *
 * `count` defaults to 1. Pass 0 to un-tick. Passing a bigger number is how the
 * weekly counters (workouts) record more than one in a day.
 *
 * Ticking the sabbath routine also enforces PRD §5.2.2 ("exactly 1 of Sat/Sun"):
 * any other sabbath mark in the same Sun–Sat week is cleared.
 */
export async function checkRoutine(
  routineId: UUID,
  date: DateKey = today(),
  count = 1,
): Promise<RoutineCheck> {
  const supabase = await getSupabaseServerClient();
  if (!Number.isInteger(count) || count < 0) {
    throw new ValidationError('Count must be 0 or a positive whole number.', 'count');
  }

  const routine = await getRoutine(routineId);
  if (!routine) throw new NotFoundError('Routine', routineId);

  if (routine.is_sabbath && count > 0) await clearSabbathElsewhereInWeek(routineId, date);

  return unwrap(
    await supabase
      .from('routine_checks')
      .upsert({ routine_id: routineId, date, count }, { onConflict: 'routine_id,date' })
      .select('*')
      .single(),
    'checkRoutine',
  );
}

/** The 1-tap home-screen affordance: on ⇄ off for the given date. */
export async function toggleRoutine(
  routineId: UUID,
  date: DateKey = today(),
): Promise<RoutineCheck> {
  const supabase = await getSupabaseServerClient();
  const existing = unwrapNullable(
    await supabase
      .from('routine_checks')
      .select('*')
      .eq('routine_id', routineId)
      .eq('date', date)
      .maybeSingle(),
    'toggleRoutine',
  );
  return checkRoutine(routineId, date, existing && existing.count > 0 ? 0 : 1);
}

/** Increment a weekly counter (workouts) by one for the given date. */
export async function incrementRoutine(
  routineId: UUID,
  date: DateKey = today(),
  by = 1,
): Promise<RoutineCheck> {
  const supabase = await getSupabaseServerClient();
  const existing = unwrapNullable(
    await supabase
      .from('routine_checks')
      .select('*')
      .eq('routine_id', routineId)
      .eq('date', date)
      .maybeSingle(),
    'incrementRoutine',
  );
  return checkRoutine(routineId, date, Math.max(0, (existing?.count ?? 0) + by));
}

/**
 * PRD §5.2.2 — mark a date as the sabbath. Sugar over `checkRoutine` for the
 * sabbath routine, so screens do not have to look it up.
 */
export async function setSabbath(date: DateKey = today()): Promise<RoutineCheck> {
  const sabbath = await getSabbathRoutine();
  if (!sabbath) {
    throw new ValidationError(
      'No sabbath routine configured. Add one in Settings and mark it as the rest day.',
    );
  }
  return checkRoutine(sabbath.id, date, 1);
}

export async function clearSabbath(date: DateKey = today()): Promise<RoutineCheck | null> {
  const sabbath = await getSabbathRoutine();
  if (!sabbath) return null;
  return checkRoutine(sabbath.id, date, 0);
}

/** "Exactly 1 of Sat/Sun": clear other sabbath marks in the same Sun–Sat week. */
async function clearSabbathElsewhereInWeek(routineId: UUID, date: DateKey): Promise<void> {
  const supabase = await getSupabaseServerClient();
  const weekStart = addDays(date, -dayOfWeek(date));
  const weekEnd = addDays(weekStart, 6);
  await supabase
    .from('routine_checks')
    .update({ count: 0 })
    .eq('routine_id', routineId)
    .gte('date', weekStart)
    .lte('date', weekEnd)
    .neq('date', date);
}

/* ================================================================== */
/* v2 — workout hook (SPEC-V2 §8)                                     */
/* ================================================================== */

/**
 * The routine `POST /api/v1/hooks/workout` ticks: the active routine named
 * `config.hooks.workoutRoutineName` ("Workouts"), case-insensitive.
 */
export async function getWorkoutRoutine(): Promise<Routine | null> {
  const wanted = config.hooks.workoutRoutineName.trim().toLowerCase();
  const routines = await fetchRoutines(false);
  return routines.find((r) => r.name.trim().toLowerCase() === wanted) ?? null;
}

/**
 * Increment TODAY's Workouts count by one — the only thing the workout hook
 * can do. No date, routine or count is taken from the caller.
 */
export async function logWorkoutFromHook(): Promise<{
  routine: Pick<Routine, 'id' | 'name'>;
  check: RoutineCheck;
}> {
  const routine = await getWorkoutRoutine();
  if (!routine) throw new NotFoundError(`Routine "${config.hooks.workoutRoutineName}"`);
  const check = await incrementRoutine(routine.id, today(), 1);
  return { routine: { id: routine.id, name: routine.name }, check };
}
