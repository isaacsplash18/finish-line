import 'server-only';

import { cache } from 'react';

import { config } from '@/lib/config';
import { daysBetween, daysSince, today, toDateKey } from '@/lib/dates';
import { normalizeGithubRepo } from '@/lib/github';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type {
  CreateProjectInput,
  DateKey,
  ImportProjectInput,
  KeyDate,
  Project,
  ProjectDetail,
  ProjectKind,
  ProjectStage,
  ProjectWithMeta,
  Reward,
  StageEvent,
  Timestamp,
  UpdateProjectInput,
  UUID,
} from '@/lib/types';
import { PROJECT_KINDS } from '@/lib/types';

import {
  IMPORT_EVENT_MARKER,
  countActiveProjects,
  describeActivationCost,
  describeStageMoveCost,
  describeKillBonus,
  isArea,
  isVisibleInSeason,
  projectKindOf,
  stuckSince,
  type WipCostPreview,
} from '@/lib/scores';

import {
  DatabaseError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
  fetchAllRows,
  requireText,
  unwrap,
  unwrapNullable,
} from './errors';
import { fetchProgressEventsSince, progressLookbackStart, recordProgress } from './progress-events';
import { applyRewardLockingRule, getRewards } from './rewards';

/* ================================================================== */
/* Helpers                                                            */
/* ================================================================== */

export function isActiveStage(stage: ProjectStage): boolean {
  return config.projects.activeStages.includes(stage);
}

export function isTerminalStage(stage: ProjectStage): boolean {
  return config.projects.terminalStages.includes(stage);
}

/**
 * v2: counts toward WIP — an active stage AND kind='project'. Areas never do
 * (SPEC-V2 §5).
 */
export function isActiveProject(project: Pick<Project, 'stage'> & { kind?: ProjectKind | null }): boolean {
  return !isArea(project) && isActiveStage(project.stage);
}

/** Decorate a raw row with everything the UI needs. Pure — safe to reuse. */
export function toProjectWithMeta(
  project: Project,
  reward: Reward | null = null,
  asOf: DateKey = today(),
): ProjectWithMeta {
  const idleFrom =
    project.next_action_updated_at > project.stage_changed_at
      ? project.next_action_updated_at
      : project.stage_changed_at;

  return {
    ...project,
    // Rows read before migration 0002 have no kind/github_repo — default them.
    kind: projectKindOf(project),
    github_repo: project.github_repo ?? null,
    isStuck: !isArea(project) && project.stuck_since !== null,
    isActive: isActiveProject(project),
    isTerminal: isTerminalStage(project.stage),
    daysInStage: daysSince(project.stage_changed_at, asOf),
    daysIdle: daysSince(idleFrom, asOf),
    daysToTarget: project.stage_target_date
      ? daysBetween(asOf, project.stage_target_date)
      : null,
    reward,
  };
}

/** Order projects sensibly for lists: stuck first, then most idle. */
function byUrgency(a: ProjectWithMeta, b: ProjectWithMeta): number {
  if (a.isStuck !== b.isStuck) return a.isStuck ? -1 : 1;
  return b.daysIdle - a.daysIdle;
}

/* ================================================================== */
/* Reads                                                              */
/* ================================================================== */

export interface GetProjectsOptions {
  /** Restrict to these stages. Defaults to all. */
  stages?: readonly ProjectStage[];
  /** When false, Done/Killed/Abandoned are excluded. Default true. */
  includeTerminal?: boolean;
  /** Only projects currently flagged Stuck. */
  onlyStuck?: boolean;
  /** v2: restrict to these kinds. Defaults to both. */
  kinds?: readonly ProjectKind[];
  /**
   * v2 §7: hide terminal projects that ended before this season start (the
   * board's default once a new season starts). Omit to show everything.
   */
  seasonStartedAt?: Timestamp | null;
}

/**
 * Every project row, one query, deduped per request. Everything that needs a
 * filtered view (`getProjects`, `getActiveProjects`, WIP counts, key-date
 * project names) derives it in memory from this single read.
 *
 * Read path only. Mutations must not go through this — they hit Supabase
 * directly so a later re-render in the same request can't see a stale copy.
 */
export const getAllProjectRows = cache(async (): Promise<Project[]> => {
  const supabase = await getSupabaseServerClient();
  return unwrap(await supabase.from('projects').select('*'), 'getProjects');
});

/**
 * Pure: decorate raw rows with reward + staleness metadata, apply the
 * `GetProjectsOptions` filters, and sort stuck-first then most-idle-first.
 * Used by `getProjects` and by the dashboard (which fetches its own rows so it
 * can run every read in one parallel batch).
 */
export function buildProjects(
  rows: readonly Project[],
  rewards: readonly Reward[],
  options: GetProjectsOptions = {},
  asOf: DateKey = today(),
): ProjectWithMeta[] {
  const rewardByProject = new Map<UUID, Reward>();
  for (const reward of rewards) {
    if (reward.project_id) rewardByProject.set(reward.project_id, reward);
  }

  const stages = options.stages?.length ? options.stages : null;
  return rows
    .filter((p) => {
      if (stages) {
        if (!stages.includes(p.stage)) return false;
      } else if (options.includeTerminal === false && isTerminalStage(p.stage)) {
        return false;
      }
      if (options.onlyStuck && (p.stuck_since === null || isArea(p))) return false;
      if (options.kinds?.length && !options.kinds.includes(projectKindOf(p))) return false;
      if (options.seasonStartedAt && !isVisibleInSeason(p, options.seasonStartedAt)) return false;
      return true;
    })
    .map((p) => toProjectWithMeta(p, rewardByProject.get(p.id) ?? null, asOf))
    .sort(byUrgency);
}

/**
 * All projects, decorated with reward + staleness metadata.
 * Sorted stuck-first then most-idle-first.
 *
 * Two parallel reads (projects, rewards), each deduped per request; filtering
 * happens in memory.
 */
export async function getProjects(options: GetProjectsOptions = {}): Promise<ProjectWithMeta[]> {
  const [rows, rewards] = await Promise.all([getAllProjectRows(), getRewards()]);
  return buildProjects(rows, rewards, options);
}

/** Convenience: the Building + Commercialising projects (PRD "Active"). Areas excluded. */
export async function getActiveProjects(): Promise<ProjectWithMeta[]> {
  return getProjects({ stages: config.projects.activeStages, kinds: ['project'] });
}

/** How many of the 3 slots are taken. Uncached (used right before writes). Areas never count. */
export async function getActiveProjectCount(): Promise<number> {
  const supabase = await getSupabaseServerClient();
  const rows = unwrap(
    await supabase
      .from('projects')
      .select('*')
      .in('stage', config.projects.activeStages as ProjectStage[]),
    'getActiveProjectCount',
  );
  return countActiveProjects(rows);
}

export interface WipStatus {
  /** How many projects are Building or Commercialising right now. */
  activeCount: number;
  /** The soft cap (`config.projects.wipLimit`, 3). */
  cap: number;
  /** activeCount − cap, floored at 0. */
  overBy: number;
  /** True when `activeCount === cap`. Render the counter in accent orange. */
  isAtCap: boolean;
  /** True when over cap. Render the counter in AMBER — red is stuck/forfeit only. */
  isOverCap: boolean;
  /** Points bleeding per day right now because of the overage (0 or negative). */
  dailyBleed: number;
  activeProjectNames: string[];
  /** "3 of 3 active" — the always-visible counter copy (PRD §8.2). */
  label: string;
  /** Cost copy to show if one MORE project were activated. */
  nextActivation: WipCostPreview;
}

/**
 * Pure WIP maths over any list of projects — pass the whole portfolio,
 * non-active rows are ignored.
 */
export function computeWipStatus(projects: readonly Project[]): WipStatus {
  // Same ordering `getActiveProjects()` always gave: stuck first, then most idle.
  const asOf = today();
  const active = projects
    .filter((p) => isActiveProject(p))
    .map((p) => toProjectWithMeta(p, null, asOf))
    .sort(byUrgency);
  const cap = config.projects.wipLimit;
  const overBy = Math.max(0, active.length - cap);

  return {
    activeCount: active.length,
    cap,
    overBy,
    isAtCap: active.length === cap,
    isOverCap: overBy > 0,
    dailyBleed: overBy * config.focus.overCapPenaltyPerProjectPerDay,
    activeProjectNames: active.map((p) => p.name),
    label: `${active.length} of ${cap} active`,
    nextActivation: describeActivationCost(active.length + 1, { isNewBuild: true }),
  };
}

/**
 * SPEC-CHANGES §1 — the cap is soft. This never gates anything; it exists so
 * the UI can state the price. Nothing here disables a control.
 *
 * Pass an already-loaded project list to skip the query entirely (pages that
 * fetched `getProjects()` anyway). Without it, one deduped projects read.
 */
export async function getWipStatus(projects?: readonly Project[]): Promise<WipStatus> {
  return computeWipStatus(projects ?? (await getAllProjectRows()));
}

/** `previewStageMove`'s result: the price tag plus the kill-bonus line. */
export type StageMovePreview = WipCostPreview & {
  /** True only for a start (Idea/creation → active) — the only move the −15 can apply to. */
  isActivation: boolean;
  killBonusCopy: string | null;
};

/**
 * SPEC-CHANGES §1/§4 — what a specific stage move will cost, for the
 * confirmation copy. Never blocks; the caller always gets a preview and can
 * always proceed.
 */
export async function previewStageMove(
  id: UUID,
  toStage: ProjectStage,
): Promise<StageMovePreview> {
  const supabase = await getSupabaseServerClient();
  const project = unwrapNullable(
    await supabase.from('projects').select('*').eq('id', id).maybeSingle(),
    'previewStageMove',
  );
  if (!project) throw new NotFoundError('Project', id);

  const activeCount = await getActiveProjectCount();
  const killBonusCopy = toStage === 'killed' ? describeKillBonus(project.stage) : null;

  // Areas are exempt from the cap and from activation charges (SPEC-V2 §5).
  if (isArea(project)) {
    return {
      ...describeActivationCost(activeCount, {}),
      copy: '',
      isActivation: false,
      killBonusCopy,
    };
  }

  // Only a start (Idea → active) can carry the −15; any other move — e.g. the
  // Shipped → Commercialising last mile — says "no activation charge" and only
  // mentions the bleed if it adds an active project over the cap.
  return { ...describeStageMoveCost(project.stage, toStage, activeCount), killBonusCopy };
}

/**
 * SPEC-CHANGES §4 — the kill confirmation needs to say "Decisive kill: +10 Focus"
 * when the project reached Building or beyond, and say nothing for Idea kills.
 */
export async function getKillPreview(
  id: UUID,
): Promise<{ project: Project; bonusCopy: string | null }> {
  const supabase = await getSupabaseServerClient();
  const project = unwrapNullable(
    await supabase.from('projects').select('*').eq('id', id).maybeSingle(),
    'getKillPreview',
  );
  if (!project) throw new NotFoundError('Project', id);
  return { project, bonusCopy: describeKillBonus(project.stage) };
}

/** One project with its full stage history and linked key dates. Null if absent. */
export async function getProject(id: UUID): Promise<ProjectDetail | null> {
  const supabase = await getSupabaseServerClient();

  const project = unwrapNullable(
    await supabase.from('projects').select('*').eq('id', id).maybeSingle(),
    'getProject',
  );
  if (!project) return null;

  const [events, rewards, keyDates] = await Promise.all([
    supabase.from('stage_events').select('*').eq('project_id', id).order('created_at', { ascending: false }),
    supabase.from('rewards').select('*').eq('project_id', id).limit(1),
    supabase.from('key_dates').select('*').eq('project_id', id).order('date', { ascending: true }),
  ]);

  const reward = (unwrap(rewards, 'getProject:rewards')[0] as Reward | undefined) ?? null;

  return {
    ...toProjectWithMeta(project, reward),
    events: unwrap(events, 'getProject:events') as StageEvent[],
    keyDates: unwrap(keyDates, 'getProject:keyDates') as KeyDate[],
  };
}

export async function getProjectOrThrow(id: UUID): Promise<ProjectDetail> {
  const project = await getProject(id);
  if (!project) throw new NotFoundError('Project', id);
  return project;
}

/* ================================================================== */
/* Writes                                                             */
/* ================================================================== */

/**
 * PRD §3.1.3 — `next_action` is required; a project without one cannot be
 * saved. Also writes the opening `stage_events` row so the timeline and the
 * Focus score have something to read.
 *
 * SPEC-CHANGES §1: creating directly into Building/Commercialising is ALWAYS
 * allowed, including over the soft WIP cap. Call `getWipStatus()` first if you
 * want to show the price before the user confirms.
 */
export async function createProject(input: CreateProjectInput): Promise<ProjectWithMeta> {
  const supabase = await getSupabaseServerClient();

  const name = requireText(input.name, 'name', 'Give it a name.');
  const nextAction = requireText(
    input.next_action,
    'next_action',
    'Every project needs a next action. That is the whole point.',
  );
  const stage: ProjectStage = input.stage ?? 'idea';
  if (isTerminalStage(stage)) {
    throw new ValidationError('You cannot create a project that is already finished.', 'stage');
  }

  // v2 columns are only sent when asked for, so v1 callers keep working
  // against a database that has not had migration 0002 applied yet.
  const v2: Partial<Pick<Project, 'kind' | 'github_repo'>> = {};
  if (input.kind !== undefined) v2.kind = parseKind(input.kind);
  if (input.github_repo !== undefined) v2.github_repo = parseRepo(input.github_repo);

  const now = new Date().toISOString();
  const project = unwrap(
    await supabase
      .from('projects')
      .insert({
        name,
        next_action: nextAction,
        resolution: input.resolution?.trim() || null,
        stage,
        stage_target_date: input.stage_target_date ?? null,
        stage_changed_at: now,
        next_action_updated_at: now,
        ...v2,
      })
      .select('*')
      .single(),
    'createProject',
  );

  await Promise.all([
    supabase.from('stage_events').insert({
      project_id: project.id,
      from_stage: null,
      to_stage: stage,
      note: 'Created',
    }),
    recordProgress(project.id, 'stage', today(), { bestEffort: true }),
  ]);

  // Going over cap locks unclaimed rewards from that moment (SPEC-CHANGES §3).
  if (isActiveProject(project)) await applyRewardLockingRule();

  return toProjectWithMeta(project);
}

const IMPORTABLE_STAGES: readonly ProjectStage[] = ['building', 'shipped', 'commercialising'];

/**
 * "Import existing projects" (Settings) — bring real, already-in-flight work
 * into the app without the usual entry tax.
 *
 * Running a pre-existing project through `createProject` + `moveProjectStage`
 * would be wrong in two ways:
 *
 *  1. It would charge the -15 "new project into Building" penalty for
 *     something that was never a new shiny object.
 *  2. Backdating the stage_events row so "days in stage" looks right would
 *     let `countOverCapProjectDays` replay the portfolio as over-cap for the
 *     whole historical span, bleeding Focus retroactively for weeks Isaac
 *     never even had this app.
 *
 * So the two clocks are deliberately split:
 *
 *  - `stage_changed_at` (display only — drives "days in stage" on the
 *    kanban) is backdated to `startedAt`.
 *  - The `stage_events` row that scoring reads is inserted with the DB's
 *    real `now()` (never backdated) and its `note` is prefixed with
 *    `IMPORT_EVENT_MARKER`, which `isNewBuildingEvent` in `lib/scores.ts`
 *    checks for and skips. That waives the -15 charge and means the
 *    over-cap replay only starts counting this project from today forward
 *    — any bleed starts tomorrow, not retroactively.
 *  - `next_action_updated_at` is set to now, not backdated, so a project
 *    that has genuinely sat idle for months isn't flagged Stuck the instant
 *    it lands here.
 *
 * Kill / abandon / done deltas are untouched and apply normally afterwards —
 * only this one-time entry charge is waived. Idea-stage work doesn't need
 * this at all (ideas are free); call `createProject` for those instead.
 */
export async function importProject(input: ImportProjectInput): Promise<ProjectWithMeta> {
  const supabase = await getSupabaseServerClient();

  const name = requireText(input.name, 'name', 'Give it a name.');
  const nextAction = requireText(
    input.nextAction,
    'next_action',
    'Every project needs a next action. That is the whole point.',
  );
  if (!IMPORTABLE_STAGES.includes(input.stage)) {
    throw new ValidationError(
      'Import is for projects already in Building, Shipped, or Commercialising. Ideas are free — just add those normally.',
      'stage',
    );
  }
  const startedAt = typeof input.startedAt === 'string' ? input.startedAt.trim() : '';
  if (!startedAt) {
    throw new ValidationError('When did this actually start?', 'startedAt');
  }
  if (startedAt > today()) {
    throw new ValidationError("That start date hasn't happened yet.", 'startedAt');
  }

  const now = new Date().toISOString();
  // Midday UTC so the date key round-trips to the same calendar day
  // regardless of the app timezone's offset.
  const stageChangedAt = `${startedAt}T12:00:00.000Z`;

  const project = unwrap(
    await supabase
      .from('projects')
      .insert({
        name,
        next_action: nextAction,
        resolution: input.resolution?.trim() || null,
        stage: input.stage,
        stage_target_date: input.stageTargetDate ?? null,
        stage_changed_at: stageChangedAt,
        next_action_updated_at: now,
      })
      .select('*')
      .single(),
    'importProject',
  );

  // `created_at` is left to the DB default (`now()`) — deliberately NOT
  // backdated. See the doc comment above and `countOverCapProjectDays`.
  await Promise.all([
    supabase.from('stage_events').insert({
      project_id: project.id,
      from_stage: null,
      to_stage: input.stage,
      note: `${IMPORT_EVENT_MARKER} pre-existing project, started ${startedAt}`,
    }),
    recordProgress(project.id, 'stage', today(), { bestEffort: true }),
  ]);

  // Going over cap locks unclaimed rewards from that moment (SPEC-CHANGES §3).
  if (isActiveStage(input.stage)) await applyRewardLockingRule();

  return toProjectWithMeta(project);
}

/**
 * Edit name / resolution / next action / target date.
 * Touching `next_action` is a progress signal (SPEC-V2 §2): it resets the
 * staleness clock, records `progress_events(kind='next_action')` and clears
 * Stuck instantly.
 */
export async function updateProject(
  id: UUID,
  input: UpdateProjectInput,
): Promise<ProjectWithMeta> {
  const supabase = await getSupabaseServerClient();

  const patch: Partial<Project> = {};
  if (input.name !== undefined) patch.name = requireText(input.name, 'name');
  if (input.resolution !== undefined) patch.resolution = input.resolution?.trim() || null;
  if (input.stage_target_date !== undefined) patch.stage_target_date = input.stage_target_date;
  if (input.next_action !== undefined) {
    patch.next_action = requireText(
      input.next_action,
      'next_action',
      'Every project needs a next action. That is the whole point.',
    );
    patch.next_action_updated_at = new Date().toISOString();
    patch.stuck_since = null;
  }
  if (Object.keys(patch).length === 0) return (await getProjectOrThrow(id)) as ProjectWithMeta;

  const [result] = await Promise.all([
    supabase.from('projects').update(patch).eq('id', id).select('*').single(),
    patch.next_action !== undefined
      ? recordProgress(id, 'next_action', today(), { bestEffort: true })
      : null,
  ]);
  const project = unwrap(result, 'updateProject');
  return toProjectWithMeta(project);
}

export interface MoveProjectStageOptions {
  /** Free-text note stored on the stage_event (kill reason, context, etc). */
  note?: string;
  /** New target date for the stage being entered. */
  stageTargetDate?: DateKey | null;
  /** Written to `terminal_reason` when moving to a terminal stage. */
  terminalReason?: string;
}

/**
 * The one and only way a project changes stage.
 *
 * SPEC-CHANGES §1: this NEVER throws or blocks on the WIP cap. Going to 4-of-3
 * active is allowed; it is priced, not prevented. Use `previewStageMove()` to
 * get the cost copy to show before confirming.
 *
 * Enforces:
 *  - PRD §3.2.4 terminal stages are final — throws `InvalidTransitionError`.
 *  - PRD §3.2.3 killing must go through `killProject()` so a reason is captured.
 *
 * Side effects:
 *  - writes a `stage_events` row (the audit trail every score reads)
 *  - clears `stuck_since` (a stage change is exactly what un-sticks a project)
 *  - `done`      ⇒ the linked reward becomes `claimable` (PRD §4.2)
 *  - `abandoned` ⇒ the linked reward is permanently `forfeited` (PRD §4.3.2)
 *  - re-applies the global reward locking rule (stuck OR over cap —
 *    PRD §4.3.1 as amended by SPEC-CHANGES §3)
 */
export async function moveProjectStage(
  id: UUID,
  toStage: ProjectStage,
  options: MoveProjectStageOptions = {},
): Promise<ProjectWithMeta> {
  const supabase = await getSupabaseServerClient();

  const current = unwrapNullable(
    await supabase.from('projects').select('*').eq('id', id).maybeSingle(),
    'moveProjectStage:load',
  );
  if (!current) throw new NotFoundError('Project', id);

  if (isTerminalStage(current.stage)) {
    throw new InvalidTransitionError(
      `"${current.name}" is ${current.stage}. That is final — there is no archive-and-forget here.`,
    );
  }
  if (current.stage === toStage) return toProjectWithMeta(current);
  if (toStage === 'killed' && !options.terminalReason) {
    throw new ValidationError('Killing a project requires a one-line reason.', 'terminal_reason');
  }

  // NOTE: no WIP check here, by design. SPEC-CHANGES §1 made the cap soft.

  const now = new Date().toISOString();
  const patch: Partial<Project> = {
    stage: toStage,
    stage_changed_at: now,
    stuck_since: null,
  };
  if (options.stageTargetDate !== undefined) patch.stage_target_date = options.stageTargetDate;
  if (isTerminalStage(toStage)) {
    patch.stage_target_date = null;
    if (options.terminalReason) patch.terminal_reason = options.terminalReason.trim();
  }

  const project = unwrap(
    await supabase.from('projects').update(patch).eq('id', id).select('*').single(),
    'moveProjectStage:update',
  );

  await Promise.all([
    supabase.from('stage_events').insert({
      project_id: id,
      from_stage: current.stage,
      to_stage: toStage,
      note: options.note?.trim() || options.terminalReason?.trim() || null,
    }),
    // A stage change is a progress signal (SPEC-V2 §2).
    recordProgress(id, 'stage', today(), { bestEffort: true }),
  ]);

  // --- reward side effects -------------------------------------------
  if (toStage === 'done') {
    await supabase
      .from('rewards')
      .update({ status: 'claimable' })
      .eq('project_id', id)
      .in('status', ['locked_pending']);
  }
  if (toStage === 'abandoned') {
    // PRD §4.3.2: permanently forfeited, with a tombstone on the dashboard.
    await supabase
      .from('rewards')
      .update({ status: 'forfeited', forfeited_at: now })
      .eq('project_id', id)
      .in('status', ['locked_pending', 'claimable']);
  }

  // A stage change may move the portfolio across the cap — re-run the gate.
  await applyRewardLockingRule();

  return toProjectWithMeta(project);
}

/**
 * PRD §3.2.3 — deliberate kills are respectable, but they cost a sentence.
 * `reason` is required.
 *
 * SPEC-CHANGES §2: killing a project that had reached Building or beyond earns
 * +10 Focus (a "decisive kill"). Killing an Idea is Focus-neutral. Call
 * `getKillPreview(id)` before confirming to get the copy for that.
 */
export async function killProject(id: UUID, reason: string): Promise<ProjectWithMeta> {
  const text = requireText(
    reason,
    'reason',
    'Killing a project requires a one-line reason. Say why.',
  );
  return moveProjectStage(id, 'killed', { terminalReason: text, note: text });
}

/**
 * PRD §4.3.2 — abandonment. Costs −25 Focus and permanently forfeits the
 * linked reward. Use `killProject` for a deliberate, penalty-free stop.
 */
export async function abandonProject(id: UUID, reason?: string): Promise<ProjectWithMeta> {
  return moveProjectStage(id, 'abandoned', {
    terminalReason: reason?.trim() || 'Abandoned',
    note: reason?.trim() || null || undefined,
  });
}

export interface EraseProjectResult {
  id: UUID;
  name: string;
  /** How many `stage_events` rows went with it (FK cascade). */
  erasedEvents: number;
}

/**
 * Erase a data-entry mistake — a typo'd duplicate, a test row, something
 * created by accident. Hard-deletes the project; `stage_events` cascade,
 * and any reward / key date pointing at it is unlinked (FK `set null`).
 *
 * This is NOT a way out of a project. Done / Killed / Abandoned are the real
 * exits, and they are priced. So erasing is only allowed while the project
 * has left no real history:
 *
 *  - no claimed reward is attached to it, and
 *  - every one of its `stage_events` was either created today (app
 *    timezone) or written by `importProject` (`IMPORT_EVENT_MARKER`).
 *
 * Anything older throws `InvalidTransitionError` (HTTP 409 in the API).
 * Because the erased events no longer exist, any Focus delta they caused
 * today disappears with them on the next recompute — which is exactly right
 * for a mistake, and exactly why older history is protected.
 */
export async function eraseProject(id: UUID): Promise<EraseProjectResult> {
  const supabase = await getSupabaseServerClient();

  const project = unwrapNullable(
    await supabase.from('projects').select('*').eq('id', id).maybeSingle(),
    'eraseProject:load',
  );
  if (!project) throw new NotFoundError('Project', id);

  const [events, claimed] = await Promise.all([
    supabase.from('stage_events').select('*').eq('project_id', id),
    supabase.from('rewards').select('id').eq('project_id', id).eq('status', 'claimed'),
  ]);

  if (unwrap(claimed, 'eraseProject:rewards').length > 0) {
    throw new InvalidTransitionError(
      `"${project.name}" has a claimed reward. That is history, not a typo — it cannot be erased.`,
    );
  }

  const stageEvents = unwrap(events, 'eraseProject:events') as StageEvent[];
  const asOf = today();
  const history = stageEvents.filter(
    (e) => toDateKey(e.created_at) !== asOf && !(e.note ?? '').startsWith(IMPORT_EVENT_MARKER),
  );
  if (history.length > 0) {
    throw new InvalidTransitionError(
      `"${project.name}" has stage history from before today. Erase is only for fresh mistakes — finish it, kill it, or abandon it instead.`,
    );
  }

  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw new DatabaseError(`eraseProject: ${error.message}`, error);

  // It may have been Active or Stuck — re-run the global reward gate.
  await applyRewardLockingRule();

  return { id, name: project.name, erasedEvents: stageEvents.length };
}

/* ================================================================== */
/* v2: kind + GitHub repo (SPEC-V2 §5, §6)                            */
/* ================================================================== */

function parseKind(kind: unknown): ProjectKind {
  if (typeof kind !== 'string' || !PROJECT_KINDS.includes(kind as ProjectKind)) {
    throw new ValidationError("Kind must be 'project' or 'area'.", 'kind');
  }
  return kind as ProjectKind;
}

function parseRepo(repo: unknown): string | null {
  if (repo === null || (typeof repo === 'string' && repo.trim() === '')) return null;
  const normalised = normalizeGithubRepo(typeof repo === 'string' ? repo : null);
  if (!normalised) {
    throw new ValidationError('GitHub repo must look like owner/name (or a github.com URL).', 'github_repo');
  }
  return normalised;
}

/**
 * Convert between a finishable project and an ongoing area (SPEC-V2 §5).
 * Areas are exempt from the cap, stuck and every score, so converting to an
 * area clears `stuck_since`; the reward gate is re-run because the WIP count
 * may have changed. Terminal projects cannot be converted.
 */
export async function setProjectKind(id: UUID, kind: ProjectKind): Promise<ProjectWithMeta> {
  const supabase = await getSupabaseServerClient();
  const next = parseKind(kind);

  const current = unwrapNullable(
    await supabase.from('projects').select('*').eq('id', id).maybeSingle(),
    'setProjectKind:load',
  );
  if (!current) throw new NotFoundError('Project', id);
  if (projectKindOf(current) === next) return toProjectWithMeta(current);
  if (isTerminalStage(current.stage)) {
    throw new InvalidTransitionError(
      `"${current.name}" is ${current.stage}. Finished history stays as it was.`,
    );
  }

  const patch: Partial<Project> = { kind: next };
  if (next === 'area') patch.stuck_since = null;

  const project = unwrap(
    await supabase.from('projects').update(patch).eq('id', id).select('*').single(),
    'setProjectKind',
  );
  await applyRewardLockingRule();
  return toProjectWithMeta(project);
}

/**
 * Link (or unlink with null) a GitHub repo. Accepts "owner/name" or any
 * github.com URL form; stored normalised as "owner/name". Commits on it become
 * `progress_events(kind='commit')` on the next sync (SPEC-V2 §6).
 */
export async function setProjectRepo(id: UUID, repo: string | null): Promise<ProjectWithMeta> {
  const supabase = await getSupabaseServerClient();
  const githubRepo = parseRepo(repo);
  const project = unwrapNullable(
    await supabase
      .from('projects')
      .update({ github_repo: githubRepo })
      .eq('id', id)
      .select('*')
      .maybeSingle(),
    'setProjectRepo',
  );
  if (!project) throw new NotFoundError('Project', id);
  return toProjectWithMeta(project);
}

/* ================================================================== */
/* Stuck detection — SPEC-V2 §2                                       */
/* ================================================================== */

export interface StuckRecomputeResult {
  /** Projects that are stuck after this pass. */
  stuckProjectIds: UUID[];
  /** Projects that newly became stuck in this pass. */
  newlyStuckProjectIds: UUID[];
  /** Projects that stopped being stuck in this pass. */
  unstuckProjectIds: UUID[];
}

/**
 * Recompute `stuck_since` for every non-terminal project (SPEC-V2 §2), using
 * the pure `stuckSince()` from lib/scores.ts. A project is Stuck when EITHER:
 *
 *  1. it has had no progress signal — stage change, next-action edit, Did-it
 *     tap, or a commit on its linked repo (`progress_events`, plus the
 *     `stage_changed_at` / `next_action_updated_at` clocks) — for
 *     `config.projects.staleThresholdDays` (14) days, in Building / Shipped /
 *     Commercialising; or
 *  2. a linked key date has passed, the project is not Done, and there has
 *     been no progress signal since that date (any non-terminal stage).
 *
 * Areas are never stuck. Any progress signal clears both rules instantly
 * (`logProgress` / `updateProject` / `moveProjectStage` also clear the flag
 * themselves, so nobody waits for this nightly pass to un-stick).
 */
export async function recomputeStuckFlags(asOf: DateKey = today()): Promise<StuckRecomputeResult> {
  const supabase = await getSupabaseServerClient();

  const [projectsRes, keyDatesRes, progress] = await Promise.all([
    supabase
      .from('projects')
      .select('*')
      .not('stage', 'in', `(${config.projects.terminalStages.join(',')})`),
    supabase.from('key_dates').select('*').not('project_id', 'is', null),
    fetchProgressEventsSince(progressLookbackStart(asOf)),
  ]);
  const projects = unwrap(projectsRes, 'recomputeStuckFlags:projects');
  const keyDates = unwrap(keyDatesRes, 'recomputeStuckFlags:keyDates').filter(
    (kd) => kd.project_id != null,
  );

  const stuckProjectIds: UUID[] = [];
  const newlyStuckProjectIds: UUID[] = [];
  const unstuckProjectIds: UUID[] = [];
  // Writes are batched by target value: one UPDATE ... WHERE id IN (...) per
  // distinct `stuck_since` date, plus one for everything being un-stuck.
  const idsByStuckSince = new Map<DateKey, UUID[]>();

  for (const project of projects) {
    const since = stuckSince(project, progress, keyDates, asOf);

    if (since) {
      stuckProjectIds.push(project.id);
      if (project.stuck_since !== since) {
        if (!project.stuck_since) newlyStuckProjectIds.push(project.id);
        const ids = idsByStuckSince.get(since) ?? [];
        ids.push(project.id);
        idsByStuckSince.set(since, ids);
      }
    } else if (project.stuck_since) {
      unstuckProjectIds.push(project.id);
    }
  }

  const writes: PromiseLike<{ error: { message: string } | null }>[] = [];
  for (const [since, ids] of idsByStuckSince) {
    writes.push(supabase.from('projects').update({ stuck_since: since }).in('id', ids));
  }
  if (unstuckProjectIds.length > 0) {
    writes.push(supabase.from('projects').update({ stuck_since: null }).in('id', unstuckProjectIds));
  }
  for (const { error } of await Promise.all(writes)) {
    if (error) throw new DatabaseError(`recomputeStuckFlags: ${error.message}`, error);
  }

  return { stuckProjectIds, newlyStuckProjectIds, unstuckProjectIds };
}

/**
 * Every stage event (optionally since a date), NEWEST first, all pages.
 * Feeds `computeFocusWeek` / `computeCounters`. Uncached — writers and the
 * recompute job use this.
 */
export async function getStageEvents(sinceDate?: DateKey): Promise<StageEvent[]> {
  const supabase = await getSupabaseServerClient();
  return fetchAllRows<StageEvent>((from, to) => {
    let query = supabase.from('stage_events').select('*');
    if (sinceDate) query = query.gte('created_at', `${sinceDate}T00:00:00Z`);
    return query
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to);
  }, 'getStageEvents');
}

/** The whole stage-event log, deduped per request (read paths only). */
export const getAllStageEvents = cache(async (): Promise<StageEvent[]> => getStageEvents());
