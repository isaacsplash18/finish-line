import 'server-only';

import { today } from '@/lib/dates';
import { pickTodaysMove } from '@/lib/scores';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type {
  DateKey,
  MoveOutcome,
  Project,
  ProgressKind,
  ProjectWithMeta,
  TodaysMove,
  UUID,
} from '@/lib/types';

import {
  DatabaseError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
  unwrap,
  unwrapNullable,
} from './errors';
import {
  fetchDailyMovesSince,
  fetchProgressEventsSince,
  getDailyMovesSince,
  getProgressEventsSince,
  progressLookbackStart,
  recordProgress,
  rotationLookbackStart,
} from './progress-events';
import { fetchProjectRows, getAllProjectRows, isTerminalStage, toProjectWithMeta } from './projects';

/* ================================================================== */
/* Reads                                                              */
/* ================================================================== */

/**
 * SPEC-V2 §1 — the one card on the home screen. Three parallel reads
 * (projects, recent progress, recent daily moves), each deduped per request,
 * then the pure `pickTodaysMove` from lib/scores.ts.
 */
export async function getTodaysMove(
  asOf: DateKey = today(),
  options: { fresh?: boolean } = {},
): Promise<TodaysMove> {
  // `fresh` = a read that follows a write in this request: skip the per-request
  // cache so the write is seen (ARCHITECTURE.md, "Read-after-write").
  const [projects, progress, moves] = await Promise.all(
    options.fresh
      ? [
          fetchProjectRows(),
          fetchProgressEventsSince(progressLookbackStart(asOf)),
          fetchDailyMovesSince(rotationLookbackStart(asOf)),
        ]
      : [
          getAllProjectRows(),
          getProgressEventsSince(progressLookbackStart(asOf)),
          getDailyMovesSince(rotationLookbackStart(asOf)),
        ],
  );
  return pickTodaysMove(projects, progress, moves, asOf);
}

/* ================================================================== */
/* Writes                                                             */
/* ================================================================== */

async function loadProject(id: UUID, context: string): Promise<Project> {
  const supabase = await getSupabaseServerClient();
  const project = unwrapNullable(
    await supabase.from('projects').select('*').eq('id', id).maybeSingle(),
    context,
  );
  if (!project) throw new NotFoundError('Project', id);
  return project;
}

export interface LogProgressOptions {
  /**
   * The "Next action?" prompt after a Did-it (SPEC-V2 §1c). Omitted, blank or
   * unchanged ⇒ keep the current one (the prompt never blocks). A different
   * non-blank value replaces it and is itself a progress signal.
   */
  nextAction?: string | null;
  /** Defaults to today (SGT). */
  day?: DateKey;
}

export interface LogProgressResult {
  project: ProjectWithMeta;
  kind: ProgressKind;
  day: DateKey;
  /** True when this cleared a Stuck flag. */
  unstuck: boolean;
  /** True when `next_action` was replaced. */
  nextActionUpdated: boolean;
}

/**
 * Record progress on a project or area (SPEC-V2 §1, §2). For a Did-it tap:
 *
 *  (a) writes `progress_events(project_id, kind, day)` — idempotent per day
 *  (b) for `did_it`, upserts `daily_moves(day, project_id, outcome='did_it')`
 *      so the card advances and the project won't reappear today
 *  (c) clears `stuck_since` instantly
 *  (d) optionally replaces `next_action` (and records that as progress too)
 *
 * The live Focus moves on the next read (`getFocusWeek`) — no recompute.
 * `stage` progress is written by `moveProjectStage`, not here.
 */
export async function logProgress(
  projectId: UUID,
  kind: ProgressKind = 'did_it',
  options: LogProgressOptions = {},
): Promise<LogProgressResult> {
  if (kind === 'stage') {
    throw new ValidationError('Stage progress is recorded by moving the stage.', 'kind');
  }
  const supabase = await getSupabaseServerClient();
  const day = options.day ?? today();
  const current = await loadProject(projectId, 'logProgress:load');

  if (isTerminalStage(current.stage)) {
    throw new InvalidTransitionError(
      `"${current.name}" is ${current.stage}. There is nothing left to move.`,
    );
  }

  const patch: Partial<Project> = {};
  const unstuck = current.stuck_since !== null;
  if (unstuck) patch.stuck_since = null;

  const nextAction = typeof options.nextAction === 'string' ? options.nextAction.trim() : '';
  const nextActionUpdated = nextAction !== '' && nextAction !== current.next_action.trim();
  if (nextActionUpdated) {
    patch.next_action = nextAction;
    patch.next_action_updated_at = new Date().toISOString();
  }

  // Independent writes, one round trip: the progress event, today's move
  // outcome, the row patch, and (if replaced) the next-action signal.
  const [, moveResult, updateResult] = await Promise.all([
    recordProgress(projectId, kind, day),
    kind === 'did_it'
      ? supabase
          .from('daily_moves')
          .upsert(
            { day, project_id: projectId, outcome: 'did_it' as MoveOutcome },
            { onConflict: 'day,project_id' },
          )
      : null,
    Object.keys(patch).length > 0
      ? supabase.from('projects').update(patch).eq('id', projectId).select('*').single()
      : null,
    nextActionUpdated && kind !== 'next_action'
      ? recordProgress(projectId, 'next_action', day, { bestEffort: true })
      : null,
  ]);
  if (moveResult?.error) {
    throw new DatabaseError(`logProgress:daily_moves: ${moveResult.error.message}`, moveResult.error);
  }
  const project = updateResult ? unwrap(updateResult, 'logProgress:update') : current;

  return { project: toProjectWithMeta(project), kind, day, unstuck, nextActionUpdated };
}

export interface SkipResult {
  projectId: UUID;
  day: DateKey;
  /** What today's row says now — a skip never downgrades an earlier Did-it. */
  outcome: MoveOutcome;
}

/**
 * "Not today" (SPEC-V2 §1): no penalty, the card advances, and the project
 * won't reappear until tomorrow. If it was already done today, the Did-it
 * stands.
 */
export async function skipTodaysMove(projectId: UUID, day: DateKey = today()): Promise<SkipResult> {
  const supabase = await getSupabaseServerClient();
  await loadProject(projectId, 'skipTodaysMove:load');

  const { error } = await supabase
    .from('daily_moves')
    .upsert(
      { day, project_id: projectId, outcome: 'skipped' as MoveOutcome },
      { onConflict: 'day,project_id', ignoreDuplicates: true },
    );
  if (error) throw new DatabaseError(`skipTodaysMove: ${error.message}`, error);

  const row = unwrapNullable(
    await supabase
      .from('daily_moves')
      .select('outcome')
      .eq('day', day)
      .eq('project_id', projectId)
      .maybeSingle(),
    'skipTodaysMove:read',
  );
  return { projectId, day, outcome: row?.outcome ?? 'skipped' };
}
