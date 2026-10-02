'use server';

/**
 * Server actions for the Projects kanban + Project detail screens.
 *
 * Every action follows the pattern from ARCHITECTURE.md §5: try the domain
 * call, catch `DomainError` and hand its `.message` straight back (it is
 * already written in the app's voice), let anything else bubble as a bug.
 *
 * SPEC-CHANGES §1: nothing here ever blocks on the WIP cap. The cost-preview
 * actions (`previewStageMoveAction`, `getKillPreviewAction`) exist purely to
 * feed the confirmation copy the UI shows *before* the user commits.
 */

import { revalidatePath } from 'next/cache';

import {
  abandonProject,
  createProject,
  getKillPreview,
  isDomainError,
  killProject,
  moveProjectStage,
  previewStageMove,
  updateProject,
} from '@/lib/data';
import type { WipCostPreview } from '@/lib/scores';
import type { CreateProjectInput, DateKey, Project, ProjectStage, UUID } from '@/lib/types';

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

function revalidateProjectPaths(id?: UUID) {
  revalidatePath('/projects');
  if (id) revalidatePath(`/projects/${id}`);
  revalidatePath('/');
}

function fail(error: unknown): { ok: false; error: string; field?: string } {
  if (isDomainError(error)) return { ok: false, error: error.message, field: error.field };
  throw error;
}

/**
 * PRD §3.1.3 / SPEC-CHANGES: new projects always start at Idea — free, no
 * cap, no clock. Activating into Building is a separate, explicit stage
 * move that goes through the cost-preview confirm.
 */
export async function createProjectAction(input: {
  name: string;
  next_action: string;
  resolution?: string;
  stage_target_date?: DateKey | null;
}): Promise<ActionResult<{ id: UUID }>> {
  try {
    const payload: CreateProjectInput = {
      name: input.name,
      next_action: input.next_action,
      resolution: input.resolution,
      stage_target_date: input.stage_target_date ?? null,
      stage: 'idea',
    };
    const project = await createProject(payload);
    revalidateProjectPaths(project.id);
    return { ok: true, data: { id: project.id } };
  } catch (error) {
    return fail(error);
  }
}

/** Next-action inline edit / stage-target-date edit / name / resolution edit. */
export async function updateProjectAction(
  id: UUID,
  input: {
    name?: string;
    resolution?: string | null;
    next_action?: string;
    stage_target_date?: DateKey | null;
  },
): Promise<ActionResult> {
  try {
    await updateProject(id, input);
    revalidateProjectPaths(id);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

/**
 * SPEC-CHANGES §1/§4 — the price tag shown before any move that activates or
 * changes cap membership. Read-only; never blocks.
 */
export async function previewStageMoveAction(
  id: UUID,
  toStage: ProjectStage,
): Promise<ActionResult<WipCostPreview & { killBonusCopy: string | null }>> {
  try {
    const preview = await previewStageMove(id, toStage);
    return { ok: true, data: preview };
  } catch (error) {
    return fail(error);
  }
}

/** The one and only way a project changes stage (kill/abandon go through their own actions). */
export async function moveProjectStageAction(
  id: UUID,
  toStage: ProjectStage,
  options: { stageTargetDate?: DateKey | null } = {},
): Promise<ActionResult> {
  try {
    await moveProjectStage(id, toStage, { stageTargetDate: options.stageTargetDate });
    revalidateProjectPaths(id);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

/** SPEC-CHANGES §4 — the "+10 Focus — decisive" (or neutral) kill-confirm copy. */
export async function getKillPreviewAction(
  id: UUID,
): Promise<ActionResult<{ project: Project; bonusCopy: string | null }>> {
  try {
    const preview = await getKillPreview(id);
    return { ok: true, data: preview };
  } catch (error) {
    return fail(error);
  }
}

/** PRD §3.2.3 — reason required. Respectable; costs nothing (or earns +10). */
export async function killProjectAction(id: UUID, reason: string): Promise<ActionResult> {
  try {
    await killProject(id, reason);
    revalidateProjectPaths(id);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

/** PRD §4.3.2 — the worst outcome: -25 Focus, reward permanently forfeited. */
export async function abandonProjectAction(id: UUID, reason?: string): Promise<ActionResult> {
  try {
    await abandonProject(id, reason);
    revalidateProjectPaths(id);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}
