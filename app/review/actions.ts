'use server';

/**
 * Server actions for the Sunday review (SPEC-V2 §4). Same pattern as every
 * other screen: call the `@/lib/data` mutation, revalidate what depends on it,
 * and hand a `DomainError`'s message back instead of throwing.
 *
 * The review is a ritual, not a gate: nothing here checks the day of the week.
 */

import { revalidatePath } from 'next/cache';

import {
  completeReview,
  isDomainError,
  killProject,
  moveProjectStage,
  updateProject,
} from '@/lib/data';

export type ReviewActionResult = { ok: true } | { ok: false; error: string };

function revalidateAll(id?: string) {
  revalidatePath('/review');
  revalidatePath('/');
  revalidatePath('/projects');
  if (id) revalidatePath(`/projects/${id}`);
}

function fail(error: unknown): { ok: false; error: string } {
  if (isDomainError(error)) return { ok: false, error: error.message };
  throw error;
}

/**
 * Keep: the project stays as it is, with a (possibly new) next action. The
 * client only calls this when the text changed; an empty one is rejected here
 * as well as by the domain layer.
 */
export async function keepProjectAction(id: string, nextAction: string): Promise<ReviewActionResult> {
  if (!nextAction.trim()) return { ok: false, error: 'A project needs a next action.' };
  try {
    await updateProject(id, { next_action: nextAction.trim() });
    revalidateAll(id);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Kill: reason required; a decisive kill earns +10 (Building or beyond). */
export async function killProjectReviewAction(id: string, reason: string): Promise<ReviewActionResult> {
  if (!reason.trim()) return { ok: false, error: 'Say why, in one line.' };
  try {
    await killProject(id, reason.trim());
    revalidateAll(id);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Done: +20, and the pinned reward becomes claimable (if not over cap). */
export async function doneProjectReviewAction(id: string): Promise<ReviewActionResult> {
  try {
    await moveProjectStage(id, 'done');
    revalidateAll(id);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Finish review: records `reviews(week_start, completed_at)`; hides the home banner. */
export async function completeReviewAction(weekStart: string): Promise<ReviewActionResult> {
  try {
    await completeReview(weekStart);
    revalidateAll();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
