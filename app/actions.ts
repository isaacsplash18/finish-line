'use server';

/**
 * Server actions for the Dashboard screen. PRD §8.1.
 *
 * Pattern from ARCHITECTURE.md §5: call the `@/lib/data` mutation, revalidate
 * every route whose cached render depends on the result, and turn a
 * `DomainError` into `{ ok: false, error }` instead of a thrown 500 — anything
 * else is a bug and should bubble.
 */

import { revalidatePath } from 'next/cache';

import {
  claimReward,
  getTodaysMove,
  isDomainError,
  logProgress,
  moveProjectStage,
  skipTodaysMove,
  toggleRoutine,
  updateProject,
} from '@/lib/data';
import type { TodaysMove } from '@/lib/types';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** The 1-tap routine checklist toggle (PRD §5.3.1). Always today's date. */
export async function toggleRoutineAction(routineId: string): Promise<ActionResult> {
  try {
    await toggleRoutine(routineId);
    revalidatePath('/');
    // Ticks also change the 4-week heat calendar on the Routines screen.
    revalidatePath('/routines');
    return { ok: true };
  } catch (error) {
    if (isDomainError(error)) return { ok: false, error: error.message };
    throw error;
  }
}

/** Claim a claimable reward (PRD §4.2). Throws server-side unless claimable. */
export async function claimRewardAction(rewardId: string): Promise<ActionResult> {
  try {
    await claimReward(rewardId);
    revalidatePath('/');
    // Rewards are also managed (CRUD) from Settings.
    revalidatePath('/settings');
    return { ok: true };
  } catch (error) {
    if (isDomainError(error)) return { ok: false, error: error.message };
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* v2 — Today's move (SPEC-V2 §1)                                      */
/* ------------------------------------------------------------------ */

export type MoveActionResult =
  | { ok: true; move: TodaysMove; unstuck?: boolean }
  | { ok: false; error: string };

/**
 * Re-read today's card after a write. If that read fails the write still
 * stands, so fall back to an `empty` card rather than reporting a failure —
 * the page re-render (revalidatePath) carries the real state either way.
 */
async function nextMove(): Promise<TodaysMove> {
  try {
    return await getTodaysMove(undefined, { fresh: true });
  } catch (error) {
    if (isDomainError(error)) return { status: 'empty', copy: 'Nothing in flight. Good.' };
    throw error;
  }
}

/**
 * "Did it": a progress event, today's move outcome, and an instant un-stick
 * (all inside `logProgress`). Returns the next move so the card can advance.
 * The next-action prompt that follows is a separate, optional action
 * (`setNextActionAction`) so this one never waits on typing.
 */
export async function logProgressAction(projectId: string): Promise<MoveActionResult> {
  try {
    const result = await logProgress(projectId, 'did_it');
    revalidatePath('/');
    revalidatePath('/projects');
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, move: await nextMove(), unstuck: result.unstuck };
  } catch (error) {
    if (isDomainError(error)) return { ok: false, error: error.message };
    throw error;
  }
}

/** "Not today": no penalty, the card advances, the project is back tomorrow. */
export async function skipTodaysMoveAction(projectId: string): Promise<MoveActionResult> {
  try {
    await skipTodaysMove(projectId);
    revalidatePath('/');
    return { ok: true, move: await nextMove() };
  } catch (error) {
    if (isDomainError(error)) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * The optional "Next action?" answer after a Did-it. Blank is rejected by the
 * domain layer (a next action is always required), so the client only calls
 * this when the text actually changed.
 */
export async function setNextActionAction(
  projectId: string,
  nextAction: string,
): Promise<ActionResult> {
  try {
    await updateProject(projectId, { next_action: nextAction });
    revalidatePath('/');
    revalidatePath('/projects');
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (error) {
    if (isDomainError(error)) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * "Start this?" on the home card: Idea -> Building. The price was shown on the
 * card; the cap is soft so this never blocks.
 */
export async function startIdeaAction(projectId: string): Promise<MoveActionResult> {
  try {
    await moveProjectStage(projectId, 'building');
    revalidatePath('/');
    revalidatePath('/projects');
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, move: await nextMove() };
  } catch (error) {
    if (isDomainError(error)) return { ok: false, error: error.message };
    throw error;
  }
}
