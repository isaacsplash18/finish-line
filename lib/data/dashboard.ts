import 'server-only';

import { config } from '@/lib/config';
import { addDays, today } from '@/lib/dates';
import { computeFlow, pickTodaysMove, reviewDueFor, reviewWeekFor, weekStartSgt } from '@/lib/scores';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type {
  DailyMove,
  DashboardData,
  DateKey,
  Project,
  Reward,
  Review,
  ScoreSnapshot,
  Season,
} from '@/lib/types';

import { unwrap, unwrapOptional } from './errors';
import { decorateKeyDates, fetchKeyDateRows } from './key-dates';
import {
  fetchDailyMovesSince,
  fetchDidItEvents,
  fetchProgressEventsSince,
  progressLookbackStart,
  rotationLookbackStart,
} from './progress-events';
import { buildProjects, computeWipStatus, getStageEvents, type WipStatus } from './projects';
import { computeRewardGate } from './rewards';
import { buildRoutinesWithChecks, fetchRoutineChecks, fetchRoutines } from './routines';
import { computeAndSnapshotToday, countersFromRows, focusWeekFromRows } from './scores';

export interface DashboardPayload extends DashboardData {
  wip: WipStatus;
  /** True while the portfolio is over the soft cap — the only reward-lock reason in v2. */
  isOverCap: boolean;
  /**
   * Distinct days this ISO week (Mon → today, SGT) with at least one Did-it —
   * the home ledger line. Same counting as the up-only "Did-it days" counter.
   */
  didItDaysThisWeek: number;
}

/**
 * ONE parallel batch — one network round trip's worth of latency — for the
 * whole v2 home screen:
 *
 *   projects · rewards · routines · 4 weeks of checks · 30 days of snapshots ·
 *   key dates · the stage-event log · recent progress events · every Did-it ·
 *   recent daily moves · the current season · the review row for this week
 *
 * Everything else — Today's move, live Focus with its breakdown, live Flow,
 * counters, WIP, the reward gate, the review banner — is derived in memory by
 * the pure functions in lib/scores.ts.
 *
 * Uncached readers on purpose: this function owns the whole page's reads, and
 * the fallback path below may write and then needs to read fresh. The v2
 * tables are read with `optional` so a database without migration 0002 still
 * renders (with empty v2 sections).
 */
async function loadDashboardRows(asOf: DateKey) {
  const supabase = await getSupabaseServerClient();
  const snapshotFrom = addDays(asOf, -(config.ui.sparklinePoints - 1));
  const checksFrom = addDays(asOf, -(config.ui.heatCalendarWeeks * 7 - 1));
  const reviewWeek = reviewWeekFor(asOf);

  const [
    projectsRes,
    rewardsRes,
    routines,
    checks,
    snapshotsRes,
    keyDateRows,
    stageEvents,
    progressEvents,
    didItEvents,
    dailyMoves,
    seasonRes,
    reviewRes,
  ] = await Promise.all([
    supabase.from('projects').select('*'),
    supabase.from('rewards').select('*').order('created_at', { ascending: false }),
    fetchRoutines(false),
    fetchRoutineChecks(checksFrom, asOf),
    supabase
      .from('score_snapshots')
      .select('*')
      .gte('date', snapshotFrom)
      .lte('date', asOf)
      .order('date', { ascending: true }),
    fetchKeyDateRows(),
    getStageEvents(),
    fetchProgressEventsSince(progressLookbackStart(asOf)),
    fetchDidItEvents(),
    fetchDailyMovesSince(rotationLookbackStart(asOf)),
    supabase.from('seasons').select('*').order('started_at', { ascending: false }).limit(1),
    supabase.from('reviews').select('*').eq('week_start', reviewWeek).limit(1),
  ]);

  return {
    projects: unwrap(projectsRes, 'getDashboardData:projects') as Project[],
    rewards: unwrap(rewardsRes, 'getDashboardData:rewards') as Reward[],
    routines,
    checks,
    snapshots: unwrap(snapshotsRes, 'getDashboardData:snapshots') as ScoreSnapshot[],
    keyDateRows,
    stageEvents,
    progressEvents,
    didItEvents,
    dailyMoves: dailyMoves as DailyMove[],
    season:
      (unwrapOptional(seasonRes, 'getDashboardData:season', [] as Season[]) as Season[])[0] ?? null,
    review:
      (unwrapOptional(reviewRes, 'getDashboardData:review', [] as Review[]) as Review[])[0] ?? null,
  };
}

/**
 * Everything the v2 home screen needs, in one call (SPEC-V2 §1): Today's move,
 * this week's live Focus with its breakdown, live Flow, the up-only counters,
 * WIP, the review banner — plus routines, key dates and rewards for the
 * below-the-fold sections, and the v1 fields existing screens still read.
 *
 * Read-only on the hot path. If today's snapshot is missing (the cron did not
 * fire), it runs `computeAndSnapshotToday()` once — without the GitHub sync,
 * so opening the app never waits on GitHub — and only re-reads when that pass
 * actually changed stuck flags or reward locks.
 */
export async function getDashboardData(asOf: DateKey = today()): Promise<DashboardPayload> {
  let rows = await loadDashboardRows(asOf);

  if (!rows.snapshots.some((s) => s.date === asOf)) {
    const result = await computeAndSnapshotToday(asOf, { syncGithub: false });
    const changed =
      result.stuck.newlyStuckProjectIds.length > 0 ||
      result.stuck.unstuckProjectIds.length > 0 ||
      result.rewards.changedRewardIds.length > 0;
    if (changed) {
      rows = await loadDashboardRows(asOf);
    } else {
      rows = { ...rows, snapshots: [...rows.snapshots, result.snapshot] };
    }
  }

  const {
    projects,
    rewards,
    routines,
    checks,
    snapshots,
    keyDateRows,
    stageEvents,
    progressEvents,
    didItEvents,
    dailyMoves,
    season,
    review,
  } = rows;
  const now = new Date();

  const active = buildProjects(projects, rewards, {
    stages: config.projects.activeStages,
    kinds: ['project'],
  });
  const stuck = buildProjects(projects, rewards, { onlyStuck: true, kinds: ['project'] });
  const areas = buildProjects(projects, rewards, { includeTerminal: false, kinds: ['area'] });
  const wip = computeWipStatus(projects);
  const gate = computeRewardGate(projects);

  const flow = computeFlow({ routines, checks, asOf });
  const weekStart = weekStartSgt(asOf);
  const focusWeek = focusWeekFromRows(
    { projects, stageEvents, progressEvents, keyDates: keyDateRows },
    weekStart,
    asOf === today() ? now : asOf,
  );
  const counters = countersFromRows({ projects, stageEvents, didItEvents, season }, now);
  const todaysMove = pickTodaysMove(projects, progressEvents, dailyMoves, asOf);
  const didItDaysThisWeek = new Set(
    didItEvents
      .filter((e) => (e.kind ?? 'did_it') === 'did_it' && e.day >= weekStart && e.day <= asOf)
      .map((e) => e.day),
  ).size;
  const upcoming = keyDateRows
    .filter((kd) => kd.date >= asOf)
    .slice(0, config.keyDates.dashboardCount);

  return {
    flow: flow.score,
    focus: focusWeek.score,
    snapshots,
    routines: buildRoutinesWithChecks(routines, checks, asOf),
    activeProjects: active,
    stuckProjects: stuck,
    keyDates: decorateKeyDates(upcoming, projects),
    rewards,
    rewardsLocked: gate.locked,
    activeCount: wip.activeCount,
    wipLimit: wip.cap,
    wip,
    isOverCap: wip.isOverCap,

    todaysMove,
    focusWeek,
    counters,
    didItDaysThisWeek,
    reviewDue: reviewDueFor(asOf, review?.completed_at ?? null),
    season,
    areas,
  };
}
