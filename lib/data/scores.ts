import 'server-only';

import { config } from '@/lib/config';
import { addDays, today } from '@/lib/dates';
import {
  explainFlowScore,
  explainFocusScore,
  type FlowScoreBreakdown,
  type FocusScoreBreakdown,
} from '@/lib/scores';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type { DateKey, ScoreSnapshot } from '@/lib/types';

import { unwrap, unwrapNullable } from './errors';
import { getStageEvents, recomputeStuckFlags, type StuckRecomputeResult } from './projects';
import { applyRewardLockingRule, type RewardLockResult } from './rewards';
import { getRoutineChecks, getRoutines } from './routines';

/**
 * The last `days` daily snapshots, OLDEST FIRST — feed this straight into
 * `<Sparkline />`. PRD §6: 30-day sparklines.
 *
 * Days with no snapshot are simply absent; the Sparkline handles short series.
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
  focus: FocusScoreBreakdown;
  stuck: StuckRecomputeResult;
  rewards: RewardLockResult;
}

/**
 * The nightly job, and the lazy dashboard fallback. PRD §6 + §13.2/§13.5.
 *
 * In order:
 *  1. recompute `stuck_since` on every project (14-day idle, plus passed key
 *     dates on projects that are not Done)
 *  2. apply the reward locking rule — unclaimed rewards lock while anything is
 *     Stuck OR the portfolio is over the soft WIP cap (SPEC-CHANGES §3)
 *  3. compute the Flow score from the rolling 7-day routine window
 *  4. compute the Focus score from the rolling 30-day stage-event window,
 *     the currently-stuck set, and the reconstructed over-cap days
 *  5. upsert today's `score_snapshots` row
 *
 * Idempotent: safe to run many times a day. Call it from
 * `GET /api/cron` (Vercel Cron) and lazily from the dashboard when today's
 * snapshot is missing.
 */
export async function computeAndSnapshotToday(
  asOf: DateKey = today(),
): Promise<RecomputeResult> {
  const supabase = await getSupabaseServerClient();

  // 1 + 2 — state first, so the scores read a consistent world.
  const stuck = await recomputeStuckFlags(asOf);
  const rewards = await applyRewardLockingRule();

  // 3 — Flow.
  const flowFrom = addDays(asOf, -(config.flow.windowDays - 1));
  const [routines, checks] = await Promise.all([
    getRoutines(false),
    getRoutineChecks(flowFrom, asOf),
  ]);
  const flow = explainFlowScore({ routines, checks, asOf });

  // 4 — Focus. The whole event history is passed in: the over-cap bleed
  // reconstructs each day's Active count from it (see countOverCapProjectDays).
  const events = await getStageEvents();
  const stuckProjects = unwrap(
    await supabase.from('projects').select('id, stuck_since').not('stuck_since', 'is', null),
    'computeAndSnapshotToday:stuck',
  );
  const focus = explainFocusScore({
    events,
    stuckProjects: stuckProjects.map((p) => ({ id: p.id, stuck_since: p.stuck_since })),
    asOf,
  });

  // 5 — snapshot.
  const snapshot = unwrap(
    await supabase
      .from('score_snapshots')
      .upsert({ date: asOf, flow: flow.score, focus: focus.score }, { onConflict: 'date' })
      .select('*')
      .single(),
    'computeAndSnapshotToday:upsert',
  );

  return { snapshot, flow, focus, stuck, rewards };
}

/**
 * Lazy path for the dashboard: if the cron has not run yet today, run it now.
 * Cheap when today's row already exists (one indexed lookup).
 */
export async function ensureTodaySnapshot(asOf: DateKey = today()): Promise<ScoreSnapshot> {
  const existing = await getTodaySnapshot(asOf);
  if (existing) return existing;
  const { snapshot } = await computeAndSnapshotToday(asOf);
  return snapshot;
}
