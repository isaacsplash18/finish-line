import 'server-only';

import { config } from '@/lib/config';
import { addDays, today } from '@/lib/dates';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type { DashboardData, DateKey, Project, Reward, ScoreSnapshot } from '@/lib/types';

import { unwrap } from './errors';
import { decorateKeyDates, fetchKeyDateRows } from './key-dates';
import { buildProjects, computeWipStatus, type WipStatus } from './projects';
import { computeRewardGate } from './rewards';
import { buildRoutinesWithChecks, fetchRoutineChecks, fetchRoutines } from './routines';
import { computeAndSnapshotToday } from './scores';

export interface DashboardPayload extends DashboardData {
  wip: WipStatus;
  /** True while the portfolio is over the soft cap (SPEC-CHANGES §1/§3). */
  isOverCap: boolean;
}

/**
 * One parallel batch, six queries, one network round trip's worth of latency:
 * projects, rewards, routines, 4 weeks of checks, 30 days of snapshots, and the
 * upcoming key dates. Everything else (active / stuck / WIP / locked, the
 * linked-project names on key dates) is derived from those in memory.
 *
 * Uncached readers on purpose — this function owns the whole page's reads, and
 * the fallback path below may write and then needs to read fresh.
 */
async function loadDashboardRows(asOf: DateKey) {
  const supabase = await getSupabaseServerClient();
  const snapshotFrom = addDays(asOf, -(config.ui.sparklinePoints - 1));
  const checksFrom = addDays(asOf, -(config.ui.heatCalendarWeeks * 7 - 1));

  const [projectsRes, rewardsRes, routines, checks, snapshotsRes, keyDateRows] = await Promise.all([
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
    fetchKeyDateRows({ upcomingOnly: true, limit: config.keyDates.dashboardCount }),
  ]);

  return {
    projects: unwrap(projectsRes, 'getDashboardData:projects') as Project[],
    rewards: unwrap(rewardsRes, 'getDashboardData:rewards') as Reward[],
    routines,
    checks,
    snapshots: unwrap(snapshotsRes, 'getDashboardData:snapshots') as ScoreSnapshot[],
    keyDateRows,
  };
}

/**
 * Everything the Dashboard screen needs, in one call. PRD §8.1.
 *
 * Read-only on the hot path: it no longer re-applies the reward locking rule
 * (every mutation and the nightly cron already do, and the "locked?" flag shown
 * here is derived live from the same projects). If today's snapshot is missing
 * — the cron did not fire — it still falls back to `computeAndSnapshotToday()`
 * and re-reads, so opening the app is enough to make the scores correct
 * (PRD §13.5).
 */
export async function getDashboardData(asOf: DateKey = today()): Promise<DashboardPayload> {
  let rows = await loadDashboardRows(asOf);
  let snapshot = rows.snapshots.find((s) => s.date === asOf) ?? null;

  if (!snapshot) {
    // Rare (once a day, only if the cron missed): recompute, then re-read so the
    // projects/rewards reflect any stuck flags and lock changes it just made.
    ({ snapshot } = await computeAndSnapshotToday(asOf));
    rows = await loadDashboardRows(asOf);
  }

  const { projects, rewards, routines, checks, snapshots, keyDateRows } = rows;

  const active = buildProjects(projects, rewards, { stages: config.projects.activeStages });
  const stuck = buildProjects(projects, rewards, { onlyStuck: true });
  const wip = computeWipStatus(projects);
  const gate = computeRewardGate(projects);

  return {
    flow: snapshot.flow,
    focus: snapshot.focus,
    snapshots,
    routines: buildRoutinesWithChecks(routines, checks, asOf),
    activeProjects: active,
    stuckProjects: stuck,
    keyDates: decorateKeyDates(keyDateRows, projects),
    rewards,
    rewardsLocked: gate.locked,
    activeCount: wip.activeCount,
    wipLimit: wip.cap,
    wip,
    isOverCap: wip.isOverCap,
  };
}
