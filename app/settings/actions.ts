'use server';

import { revalidatePath } from 'next/cache';

import {
  ValidationError,
  applyRewardLockingRule,
  computeAndSnapshotToday,
  createKeyDate,
  createReward,
  createRoutine,
  deleteKeyDate,
  deleteReward,
  deleteRoutine,
  getReward,
  importProject,
  isDomainError,
  startSeason,
  syncGithubProgress,
  updateKeyDate,
  updateReward,
  updateRoutine,
  type GithubSyncResult,
  type RecomputeResult,
} from '@/lib/data';
import type {
  CreateKeyDateInput,
  CreateRewardInput,
  CreateRoutineInput,
  ImportProjectInput,
  UpdateKeyDateInput,
  UpdateRewardInput,
  UpdateRoutineInput,
  Season,
  UUID,
} from '@/lib/types';

export type SettingsActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function revalidateSettingsScreens(): void {
  revalidatePath('/settings');
  revalidatePath('/routines');
  revalidatePath('/projects');
  revalidatePath('/');
}

async function run<T>(fn: () => Promise<T>): Promise<SettingsActionResult<T>> {
  try {
    const data = await fn();
    revalidateSettingsScreens();
    return { ok: true, data };
  } catch (error) {
    if (isDomainError(error)) return { ok: false, error: error.message };
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Rewards                                                             */
/* ------------------------------------------------------------------ */

export async function createRewardAction(
  input: CreateRewardInput,
): Promise<SettingsActionResult<void>> {
  return run(async () => {
    await createReward(input);
    // Make an immediate assignment to an already-Done project reflect right
    // away, instead of waiting for the next recompute.
    await applyRewardLockingRule();
  });
}

export async function updateRewardAction(
  id: UUID,
  input: UpdateRewardInput,
): Promise<SettingsActionResult<void>> {
  return run(async () => {
    await updateReward(id, input);
    await applyRewardLockingRule();
  });
}

/** Settings only deletes unassigned rewards — pinned ones must be unassigned first. */
export async function deleteRewardAction(id: UUID): Promise<SettingsActionResult<void>> {
  return run(async () => {
    const reward = await getReward(id);
    if (reward?.project_id) {
      throw new ValidationError('Unassign the reward from its project before deleting it.');
    }
    await deleteReward(id);
  });
}

/* ------------------------------------------------------------------ */
/* Key dates                                                           */
/* ------------------------------------------------------------------ */

export async function createKeyDateAction(
  input: CreateKeyDateInput,
): Promise<SettingsActionResult<void>> {
  return run(async () => {
    await createKeyDate(input);
  });
}

export async function updateKeyDateAction(
  id: UUID,
  input: UpdateKeyDateInput,
): Promise<SettingsActionResult<void>> {
  return run(async () => {
    await updateKeyDate(id, input);
  });
}

export async function deleteKeyDateAction(id: UUID): Promise<SettingsActionResult<void>> {
  return run(async () => {
    await deleteKeyDate(id);
  });
}

/* ------------------------------------------------------------------ */
/* Routines                                                            */
/* ------------------------------------------------------------------ */

export async function createRoutineAction(
  input: CreateRoutineInput,
): Promise<SettingsActionResult<void>> {
  return run(async () => {
    await createRoutine(input);
  });
}

export async function updateRoutineAction(
  id: UUID,
  input: UpdateRoutineInput,
): Promise<SettingsActionResult<void>> {
  return run(async () => {
    await updateRoutine(id, input);
  });
}

/** Soft-delete: keeps history, drops out of Flow maths and the Routines screen. */
export async function deactivateRoutineAction(id: UUID): Promise<SettingsActionResult<void>> {
  return run(async () => {
    await deleteRoutine(id);
  });
}

export async function reactivateRoutineAction(id: UUID): Promise<SettingsActionResult<void>> {
  return run(async () => {
    await updateRoutine(id, { active: true });
  });
}

/** Hard delete: really removes the routine and its check history. */
export async function removeRoutineAction(id: UUID): Promise<SettingsActionResult<void>> {
  return run(async () => {
    await deleteRoutine(id, { hard: true });
  });
}

/* ------------------------------------------------------------------ */
/* Import existing projects                                            */
/* ------------------------------------------------------------------ */

/**
 * "Import existing projects" (Settings). No -15 entry charge — see
 * `importProject` in lib/data/projects.ts and `IMPORT_EVENT_MARKER` in
 * lib/scores.ts for the mechanism. Revalidates the three screens an import
 * can visibly change: the dashboard, the kanban, and Settings itself.
 */
export async function importProjectAction(
  input: ImportProjectInput,
): Promise<SettingsActionResult<{ id: UUID }>> {
  try {
    const project = await importProject(input);
    revalidatePath('/');
    revalidatePath('/projects');
    revalidatePath('/settings');
    return { ok: true, data: { id: project.id } };
  } catch (error) {
    if (isDomainError(error)) return { ok: false, error: error.message };
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Cron / recompute                                                    */
/* ------------------------------------------------------------------ */

/**
 * Manual "recompute now" (PRD §8.5). Calls the same sanctioned entry point as
 * `GET /api/cron` — `computeAndSnapshotToday()` — directly, rather than
 * round-tripping through our own HTTP route.
 */
export async function recomputeNowAction(): Promise<SettingsActionResult<RecomputeResult>> {
  return run(() => computeAndSnapshotToday());
}

/* ------------------------------------------------------------------ */
/* v2: seasons, GitHub                                                 */
/* ------------------------------------------------------------------ */

/**
 * SPEC-V2 §7 — "Start a new season". Counters restart, earlier terminal
 * projects hide from the board, active projects carry over, history stays.
 * Needs migration 0002 (`seasons`); before it a DatabaseError message comes back.
 */
export async function startSeasonAction(name?: string): Promise<SettingsActionResult<Season>> {
  return run(() => startSeason(name?.trim() || null));
}

/**
 * SPEC-V2 §6 — "Sync now". `syncGithubProgress` never throws (per-repo
 * statuses), so this just returns its result. The token is never included.
 */
export async function syncGithubNowAction(): Promise<SettingsActionResult<GithubSyncResult>> {
  return run(() => syncGithubProgress());
}
