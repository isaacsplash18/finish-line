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

import { claimReward, isDomainError, toggleRoutine } from '@/lib/data';

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
