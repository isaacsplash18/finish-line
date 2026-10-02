'use server';

import { revalidatePath } from 'next/cache';

import {
  checkRoutine,
  clearSabbath,
  incrementRoutine,
  isDomainError,
  setSabbath,
  toggleRoutine,
  updateRoutine,
} from '@/lib/data';
import type { DateKey, UUID } from '@/lib/types';

export type RoutineActionResult = { ok: true } | { ok: false; error: string };

function revalidateRoutineScreens(): void {
  revalidatePath('/routines');
  revalidatePath('/settings');
  revalidatePath('/');
}

async function run(fn: () => Promise<unknown>): Promise<RoutineActionResult> {
  try {
    await fn();
    revalidateRoutineScreens();
    return { ok: true };
  } catch (error) {
    if (isDomainError(error)) return { ok: false, error: error.message };
    throw error;
  }
}

/** The 1-tap check-off for daily-cadence routines. */
export async function toggleRoutineAction(
  routineId: UUID,
  date: DateKey,
): Promise<RoutineActionResult> {
  return run(() => toggleRoutine(routineId, date));
}

/** +1 for weekly counters (Workouts). */
export async function incrementRoutineAction(
  routineId: UUID,
  date: DateKey,
  by = 1,
): Promise<RoutineActionResult> {
  return run(() => incrementRoutine(routineId, date, by));
}

/** -1 correction for weekly counters, given the count the client already has. */
export async function decrementRoutineAction(
  routineId: UUID,
  date: DateKey,
  currentCount: number,
): Promise<RoutineActionResult> {
  return run(() => checkRoutine(routineId, date, Math.max(0, currentCount - 1)));
}

export async function setSabbathAction(date: DateKey): Promise<RoutineActionResult> {
  return run(() => setSabbath(date));
}

export async function clearSabbathAction(date: DateKey): Promise<RoutineActionResult> {
  return run(() => clearSabbath(date));
}

/** Inline "edit target" affordance on the Routines screen. */
export async function updateRoutineTargetAction(
  id: UUID,
  weeklyTarget: number,
): Promise<RoutineActionResult> {
  return run(() => updateRoutine(id, { weekly_target: weeklyTarget }));
}
