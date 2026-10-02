import 'server-only';

import { config } from '@/lib/config';
import { daysBetween, daysSince, today, toDateKey } from '@/lib/dates';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type {
  CreateProjectInput,
  DateKey,
  ImportProjectInput,
  KeyDate,
  Project,
  ProjectDetail,
  ProjectStage,
  ProjectWithMeta,
  Reward,
  StageEvent,
  UpdateProjectInput,
  UUID,
} from '@/lib/types';

import {
  IMPORT_EVENT_MARKER,
  describeActivationCost,
  describeKillBonus,
  type WipCostPreview,
} from '@/lib/scores';

import {
  DatabaseError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
  requireText,
  unwrap,
  unwrapNullable,
} from './errors';
import { applyRewardLockingRule } from './rewards';

/* ================================================================== */
/* Helpers                                                            */
/* ================================================================== */

export function isActiveStage(stage: ProjectStage): boolean {
  return config.projects.activeStages.includes(stage);
}

export function isTerminalStage(stage: ProjectStage): boolean {
  return config.projects.terminalStages.includes(stage);
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
    isStuck: project.stuck_since !== null,
    isActive: isActiveStage(project.stage),
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
}

/**
 * All projects, decorated with reward + staleness metadata.
 * Sorted stuck-first then most-idle-first.
 */
export async function getProjects(options: GetProjectsOptions = {}): Promise<ProjectWithMeta[]> {
  const supabase = await getSupabaseServerClient();

  let query = supabase.from('projects').select('*');
  if (options.stages?.length) query = query.in('stage', options.stages as ProjectStage[]);
  else if (options.includeTerminal === false) {
    query = query.not('stage', 'in', `(${config.projects.terminalStages.join(',')})`);
  }
  if (options.onlyStuck) query = query.not('stuck_since', 'is', null);

  const projects = unwrap(await query, 'getProjects');
  const rewards = unwrap(await supabase.from('rewards').select('*'), 'getProjects:rewards');
  const rewardByProject = new Map<UUID, Reward>();
  for (const reward of rewards) {
    if (reward.project_id) rewardByProject.set(reward.project_id, reward);
  }

  const asOf = today();
  return projects
    .map((p) => toProjectWithMeta(p, rewardByProject.get(p.id) ?? null, asOf))
    .sort(byUrgency);
}

/** Convenience: the Building + Commercialising projects (PRD "Active"). */
export async function getActiveProjects(): Promise<ProjectWithMeta[]> {
  return getProjects({ stages: config.projects.activeStages });
}

/** PRD §3.2.1 — how many of the 3 slots are taken. */
export async function getActiveProjectCount(): Promise<number> {
  const supabase = await getSupabaseServerClient();
  const { count, error } = await supabase
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .in('stage', config.projects.activeStages as ProjectStage[]);
  if (error) throw new NotFoundError('projects');
  return count ?? 0;
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
 * SPEC-CHANGES §1 — the cap is soft. This never gates anything; it exists so
 * the UI can state the price. Nothing here disables a control.
 */
export async function getWipStatus(): Promise<WipStatus> {
  const active = await getActiveProjects();
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
 * SPEC-CHANGES §1/§4 — what a specific stage move will cost, for the
 * confirmation copy. Never blocks; the caller always gets a preview and can
 * always proceed.
 */
export async function previewStageMove(
  id: UUID,
  toStage: ProjectStage,
): Promise<WipCostPreview & { killBonusCopy: string | null }> {
  const supabase = await getSupabaseServerClient();
  const project = unwrapNullable(
    await supabase.from('projects').select('*').eq('id', id).maybeSingle(),
    'previewStageMove',
  );
  if (!project) throw new NotFoundError('Project', id);

  const activeCount = await getActiveProjectCount();
  const becomesActive = isActiveStage(toStage) && !isActiveStage(project.stage);
  const leavesActive = !isActiveStage(toStage) && isActiveStage(project.stage);
  const after = activeCount + (becomesActive ? 1 : 0) - (leavesActive ? 1 : 0);

  // −15 only applies to a *new* build start (from Idea), not to coming back
  // from Shipped/Commercialising.
  const isNewBuild = toStage === 'building' && project.stage === 'idea';

  return {
    ...describeActivationCost(after, { isNewBuild }),
    killBonusCopy: toStage === 'killed' ? describeKillBonus(project.stage) : null,
  };
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
      })
      .select('*')
      .single(),
    'createProject',
  );

  await supabase.from('stage_events').insert({
    project_id: project.id,
    from_stage: null,
    to_stage: stage,
    note: 'Created',
  });

  // Going over cap locks unclaimed rewards from that moment (SPEC-CHANGES §3).
  if (isActiveStage(stage)) await applyRewardLockingRule();

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
  await supabase.from('stage_events').insert({
    project_id: project.id,
    from_stage: null,
    to_stage: input.stage,
    note: `${IMPORT_EVENT_MARKER} pre-existing project, started ${startedAt}`,
  });

  // Going over cap locks unclaimed rewards from that moment (SPEC-CHANGES §3).
  if (isActiveStage(input.stage)) await applyRewardLockingRule();

  return toProjectWithMeta(project);
}

/**
 * Edit name / resolution / next action / target date.
 * Touching `next_action` resets the staleness clock (PRD §3.1.5) and, if the
 * project was Stuck for idleness, un-sticks it.
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

  const project = unwrap(
    await supabase.from('projects').update(patch).eq('id', id).select('*').single(),
    'updateProject',
  );

  if (patch.stuck_since === null) await applyRewardLockingRule();
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

  await supabase.from('stage_events').insert({
    project_id: id,
    from_stage: current.stage,
    to_stage: toStage,
    note: options.note?.trim() || options.terminalReason?.trim() || null,
  });

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

  // A stage change may have un-stuck the last stuck project — re-run the lock.
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
/* Stuck detection (called by the nightly recompute)                  */
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
 * Recompute `stuck_since` for every non-terminal project. PRD §3.1.5 + §7.3.
 *
 * A project is Stuck when EITHER:
 *  1. it has had no stage change AND no next-action edit for
 *     `config.projects.staleThresholdDays` (14) days — applied only to the
 *     stages in `config.projects.staleStages`, so parked Ideas stay free
 *     (PRD §3.3: "Ideas cost nothing"); or
 *  2. a linked key date has passed and the project is not Done (PRD §7.3) —
 *     this one applies to every non-terminal stage, Ideas included.
 *
 * `stuck_since` is backdated to the day the project actually went stale, so
 * the recurring Focus penalty is correct even if the cron missed a few nights.
 */
export async function recomputeStuckFlags(asOf: DateKey = today()): Promise<StuckRecomputeResult> {
  const supabase = await getSupabaseServerClient();

  const projects = unwrap(
    await supabase
      .from('projects')
      .select('*')
      .not('stage', 'in', `(${config.projects.terminalStages.join(',')})`),
    'recomputeStuckFlags:projects',
  );
  const keyDates = unwrap(
    await supabase.from('key_dates').select('*').not('project_id', 'is', null),
    'recomputeStuckFlags:keyDates',
  );

  const passedKeyDateByProject = new Map<UUID, DateKey>();
  for (const kd of keyDates) {
    if (!kd.project_id) continue;
    if (kd.date > asOf) continue; // hasn't happened yet
    const existing = passedKeyDateByProject.get(kd.project_id);
    if (!existing || kd.date < existing) passedKeyDateByProject.set(kd.project_id, kd.date);
  }

  const stuckProjectIds: UUID[] = [];
  const newlyStuckProjectIds: UUID[] = [];
  const unstuckProjectIds: UUID[] = [];

  for (const project of projects) {
    let stuckSince: DateKey | null = null;

    // (1) idle too long
    if (config.projects.staleStages.includes(project.stage)) {
      const idleFrom =
        project.next_action_updated_at > project.stage_changed_at
          ? project.next_action_updated_at
          : project.stage_changed_at;
      const wentStaleOn = addDaysToKey(toDateKey(idleFrom), config.projects.staleThresholdDays);
      if (wentStaleOn <= asOf) stuckSince = wentStaleOn;
    }

    // (2) a linked key date passed and this is not Done
    const passedOn = passedKeyDateByProject.get(project.id);
    if (passedOn && (!stuckSince || passedOn < stuckSince)) stuckSince = passedOn;

    if (stuckSince) {
      stuckProjectIds.push(project.id);
      if (project.stuck_since !== stuckSince) {
        if (!project.stuck_since) newlyStuckProjectIds.push(project.id);
        await supabase.from('projects').update({ stuck_since: stuckSince }).eq('id', project.id);
      }
    } else if (project.stuck_since) {
      unstuckProjectIds.push(project.id);
      await supabase.from('projects').update({ stuck_since: null }).eq('id', project.id);
    }
  }

  return { stuckProjectIds, newlyStuckProjectIds, unstuckProjectIds };
}

function addDaysToKey(key: DateKey, days: number): DateKey {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Every stage event ever, newest first. Feeds `computeFocusScore`. */
export async function getStageEvents(sinceDate?: DateKey): Promise<StageEvent[]> {
  const supabase = await getSupabaseServerClient();
  let query = supabase.from('stage_events').select('*').order('created_at', { ascending: false });
  if (sinceDate) query = query.gte('created_at', `${sinceDate}T00:00:00Z`);
  return unwrap(await query, 'getStageEvents');
}
