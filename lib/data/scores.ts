import 'server-only';

import { config } from '@/lib/config';
import { addDays, today } from '@/lib/dates';
import {
  computeCounters,
  computeFlow,
  computeFocusWeek,
  isArea,
  reconcileLiveNow,
  weekStartSgt,
  type FlowScoreBreakdown,
} from '@/lib/scores';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type {
  CountersSummary,
  DateKey,
  FocusWeekBreakdown,
  KeyDate,
  ProgressEvent,
  Project,
  ScoreSnapshot,
  Season,
  StageEvent,
} from '@/lib/types';

import { unwrap, unwrapNullable } from './errors';
import { syncGithubProgress, type GithubSyncResult } from './github';
import { getAllKeyDateRows, fetchKeyDateRows } from './key-dates';
import {
  fetchDidItEvents,
  fetchProgressEventsSince,
  getDidItEvents,
  getProgressEventsSince,
  progressLookbackStart,
} from './progress-events';
import {
  fetchProjectRows,
  getAllProjectRows,
  getAllStageEvents,
  getStageEvents,
  recomputeStuckFlags,
  type StuckRecomputeResult,
} from './projects';
import { applyRewardLockingRule, type RewardLockResult } from './rewards';
import { fetchRoutineChecks, fetchRoutines } from './routines';
import { fetchCurrentSeason, getCurrentSeason } from './seasons';

/* ================================================================== */
/* Pure assembly (shared with the dashboard, which loads its own rows) */
/* ================================================================== */

/** Build this week's Focus from loaded rows. */
export function focusWeekFromRows(
  rows: {
    projects: readonly Project[];
    stageEvents: readonly StageEvent[];
    progressEvents: readonly ProgressEvent[];
    keyDates: readonly KeyDate[];
  },
  weekStart: DateKey,
  now: Date | DateKey = new Date(),
): FocusWeekBreakdown {
  // Rows are stamped by the database clock, `now` is the app's: never let a
  // live `now` sit before a row we just read (see `reconcileLiveNow`).
  const liveNow = reconcileLiveNow(now, [
    ...rows.stageEvents.map((e) => e.created_at),
    ...rows.progressEvents.map((e) => e.created_at),
  ]);
  return computeFocusWeek(
    {
      projects: rows.projects,
      stageEvents: rows.stageEvents,
      progressEvents: rows.progressEvents,
      keyDates: rows.keyDates.filter((k) => k.project_id != null),
    },
    weekStart,
    liveNow,
  );
}

/** Build the up-only counters from loaded rows. */
export function countersFromRows(
  rows: {
    projects: readonly Project[];
    stageEvents: readonly StageEvent[];
    didItEvents: readonly Pick<ProgressEvent, 'project_id' | 'day' | 'kind'>[];
    season: Season | null;
  },
  now: Date | DateKey = new Date(),
): CountersSummary {
  return computeCounters(
    {
      stageEvents: rows.stageEvents,
      didItEvents: rows.didItEvents,
      areaIds: rows.projects.filter(isArea).map((p) => p.id),
    },
    rows.season?.started_at ?? null,
    now,
  );
}

/* ================================================================== */
/* Live reads                                                         */
/* ================================================================== */

/**
 * This week's Focus, live (SPEC-V2 §3): computed on read from events since
 * Monday 00:00 SGT — a Did-it tap moves it on the next read, no recompute.
 * Four parallel reads, each deduped per request — or, with `fresh: true`
 * (a read that follows a write in the same request, e.g. the response of a
 * mutation), four uncached reads (ARCHITECTURE.md, "Read-after-write").
 */
export async function getFocusWeek(
  now: Date = new Date(),
  options: { fresh?: boolean } = {},
): Promise<FocusWeekBreakdown> {
  const asOf = today();
  const from = progressLookbackStart(asOf);
  const [projects, stageEvents, progressEvents, keyDates] = await Promise.all(
    options.fresh
      ? [fetchProjectRows(), getStageEvents(), fetchProgressEventsSince(from), fetchKeyDateRows()]
      : [getAllProjectRows(), getAllStageEvents(), getProgressEventsSince(from), getAllKeyDateRows()],
  );
  return focusWeekFromRows({ projects, stageEvents, progressEvents, keyDates }, weekStartSgt(now), now);
}

/** Up-only counters for the current season and lifetime (SPEC-V2 §3, §7). */
export async function getCounters(
  now: Date = new Date(),
  options: { fresh?: boolean } = {},
): Promise<CountersSummary> {
  const [projects, stageEvents, didItEvents, season] = await Promise.all(
    options.fresh
      ? [fetchProjectRows(), getStageEvents(), fetchDidItEvents(), fetchCurrentSeason()]
      : [getAllProjectRows(), getAllStageEvents(), getDidItEvents(), getCurrentSeason()],
  );
  return countersFromRows({ projects, stageEvents, didItEvents, season }, now);
}

/** Live Flow over the rolling 7 days (SPEC-V2 §3 — the formula is v1's). */
export async function getFlow(asOf: DateKey = today()): Promise<FlowScoreBreakdown> {
  const [routines, checks] = await Promise.all([
    fetchRoutines(false),
    fetchRoutineChecks(addDays(asOf, -(config.flow.windowDays - 1)), asOf),
  ]);
  return computeFlow({ routines, checks, asOf });
}

/* ================================================================== */
/* Snapshots (sparklines) + the nightly job                           */
/* ================================================================== */

/**
 * The last `days` daily snapshots, OLDEST FIRST — feed this straight into
 * `<Sparkline />`. Days with no snapshot are simply absent.
 */
export async function getScoreSnapshots(
  days: number = config.ui.sparklinePoints,
  asOf: DateKey = today(),
): Promise<ScoreSnapshot[]> {
  const supabase = await getSupabaseServerClient();
  const from = addDays(asOf, -(days - 1));
  return unwrap(
    await supabase
      .from('score_snapshots')
      .select('*')
      .gte('date', from)
      .lte('date', asOf)
      .order('date', { ascending: true }),
    'getScoreSnapshots',
  );
}

export async function getTodaySnapshot(asOf: DateKey = today()): Promise<ScoreSnapshot | null> {
  const supabase = await getSupabaseServerClient();
  return unwrapNullable(
    await supabase.from('score_snapshots').select('*').eq('date', asOf).maybeSingle(),
    'getTodaySnapshot',
  );
}

export interface RecomputeResult {
  snapshot: ScoreSnapshot;
  flow: FlowScoreBreakdown;
  /** This week's Focus as of the recompute (v2: weekly, not rolling 30 days). */
  focus: FocusWeekBreakdown;
  stuck: StuckRecomputeResult;
  rewards: RewardLockResult;
  /** Null when the GitHub sync was skipped (`syncGithub: false`). */
  github: GithubSyncResult | null;
}

/**
 * The nightly job, and the lazy dashboard fallback. Idempotent.
 *
 * In order:
 *  1. sync GitHub commits → `progress_events(kind='commit')` (never throws)
 *  2. recompute `stuck_since` (SPEC-V2 §2 — progress events + key dates)
 *  3. apply the reward gate (locked only while over cap)
 *  4. compute live Flow (rolling 7 days) and this week's Focus
 *  5. upsert today's `score_snapshots` row — the snapshot now only feeds the
 *     30-day sparklines; screens read Flow/Focus live.
 *
 * `syncGithub: false` skips step 1 (the dashboard fallback does, so opening
 * the app never waits on GitHub).
 */
export async function computeAndSnapshotToday(
  asOf: DateKey = today(),
  options: { syncGithub?: boolean } = {},
): Promise<RecomputeResult> {
  const supabase = await getSupabaseServerClient();

  // Inputs that nothing below writes start immediately and overlap with the
  // stateful steps. Uncached readers on purpose: this job writes state.
  const flowFrom = addDays(asOf, -(config.flow.windowDays - 1));
  const inputs = Promise.all([
    fetchRoutines(false),
    fetchRoutineChecks(flowFrom, asOf),
    getStageEvents(),
    fetchKeyDateRows(),
  ]);
  inputs.catch(() => undefined); // no unhandled rejection if a step below throws first

  // 1 — GitHub first, so commits count before stuck is decided.
  const github =
    options.syncGithub === false ? null : await syncGithubProgress({ recomputeStuck: false });

  // 2 + 3 — state, so the scores read a consistent world.
  const stuck = await recomputeStuckFlags(asOf);
  const [rewards, projectsRes, progressEvents] = await Promise.all([
    applyRewardLockingRule(),
    supabase.from('projects').select('*'),
    fetchProgressEventsSince(progressLookbackStart(asOf)),
  ]);
  const projects = unwrap(projectsRes, 'computeAndSnapshotToday:projects');

  // 4 — scores. Today ⇒ live at this instant; a past `asOf` ⇒ as of its close.
  const [routines, checks, stageEvents, keyDates] = await inputs;
  const flow = computeFlow({ routines, checks, asOf });
  const now: Date | DateKey = asOf === today() ? new Date() : asOf;
  const focus = focusWeekFromRows(
    { projects, stageEvents, progressEvents, keyDates },
    weekStartSgt(asOf),
    now,
  );

  // 5 — snapshot.
  const snapshot = unwrap(
    await supabase
      .from('score_snapshots')
      .upsert({ date: asOf, flow: flow.score, focus: focus.score }, { onConflict: 'date' })
      .select('*')
      .single(),
    'computeAndSnapshotToday:upsert',
  );

  return { snapshot, flow, focus, stuck, rewards, github };
}

/**
 * Lazy path: if the cron has not run yet today, run it now (without GitHub).
 * Cheap when today's row already exists (one indexed lookup).
 */
export async function ensureTodaySnapshot(asOf: DateKey = today()): Promise<ScoreSnapshot> {
  const existing = await getTodaySnapshot(asOf);
  if (existing) return existing;
  const { snapshot } = await computeAndSnapshotToday(asOf, { syncGithub: false });
  return snapshot;
}
