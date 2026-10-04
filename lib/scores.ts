/**
 * Finish Line — score maths and the v2 loop (SPEC-V2.md).
 *
 * Everything in here is PURE: no Supabase, no `fetch`, no clock reads beyond an
 * optional `now` / `today` default. Pass data in, get a value out. That is what
 * makes `lib/scores.test.ts` possible and what lets a screen recompute
 * optimistically without a round-trip.
 *
 * Every tunable lives in `lib/config.ts`. Pass a modified config as the last
 * argument to experiment.
 *
 *   Focus  — weekly, resets Monday 00:00 SGT, live      computeFocusWeek
 *   Flow   — rolling 7 days, live                        computeFlow
 *   Stuck  — 14 days without a progress signal           isStuck / stuckSince
 *   Today's move — the one card on the home screen       pickTodaysMove
 *   Counters — up-only, per season and lifetime          computeCounters
 *
 * Areas (`kind = 'area'`) never count toward WIP, stuck, or any score.
 */

import { config as defaultConfig, type AppConfig, type TodaysMoveCriterion } from './config';
import { addDays, dayOfWeek, daysBetween, lastNDates, toDateKey, today as todayKey } from './dates';
import type {
  Counters,
  CountersSummary,
  DateKey,
  FocusDeltaType,
  FocusWeekBreakdown,
  FocusWeekLine,
  MoveOutcome,
  ProgressKind,
  ProjectKind,
  ProjectStage,
  ReviewDue,
  RoutineCadence,
  Timestamp,
  TodaysMove,
  TodaysMoveProject,
  TodaysMoveReason,
  WipCostPreview,
} from './types';

export type { WipCostPreview } from './types';

/* ================================================================== */
/* Shared helpers                                                     */
/* ================================================================== */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Normalise -0 to 0 so breakdown values compare and render cleanly. */
function z(value: number): number {
  return value === 0 ? 0 : value;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function isDateKey(value: unknown): value is DateKey {
  return typeof value === 'string' && DATE_KEY.test(value);
}

function maxKey(a: DateKey | null, b: DateKey | null): DateKey | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * Resolve a `now` argument. A bare `YYYY-MM-DD` means "the END of that day"
 * (everything on it has happened, the day has closed). A `Date` or ISO
 * timestamp means that exact instant (the day it falls on is still open).
 */
function resolveNow(
  now: Date | string,
  cfg: AppConfig,
): { today: DateKey; instant: number | null } {
  if (isDateKey(now)) return { today: now, instant: null };
  const date = typeof now === 'string' ? new Date(now) : now;
  return { today: toDateKey(date, cfg.timezone), instant: date.getTime() };
}

/**
 * How far the database clock may run ahead of the app clock before we stop
 * trusting it. Rows get `created_at` from Postgres `now()`, but a live
 * `computeFocusWeek` drops rows stamped after its `now` (the app's clock), so a
 * fraction of a second of skew makes a write that just committed invisible to
 * the very next read — the Did-it you just tapped is missing from the Focus.
 */
export const CLOCK_SKEW_TOLERANCE_MS = 60_000;

/**
 * Make a LIVE `now` safe against database/app clock skew: never earlier than
 * the newest row timestamp we just read, as long as that stamp is within
 * `CLOCK_SKEW_TOLERANCE_MS` of the wall clock. Not live (a bare date, or an
 * instant more than the tolerance away from the real clock — i.e. a historical
 * replay) ⇒ returned untouched, so "as of" views still hide later rows.
 * Pure: pass `wallClock` to test.
 */
export function reconcileLiveNow(
  now: Date | string,
  createdAts: Iterable<string | null | undefined>,
  wallClock: number = Date.now(),
): Date | string {
  if (typeof now === 'string' && isDateKey(now)) return now;
  const instant = (typeof now === 'string' ? new Date(now) : now).getTime();
  if (Number.isNaN(instant) || Math.abs(instant - wallClock) > CLOCK_SKEW_TOLERANCE_MS) return now;
  let newest = instant;
  for (const createdAt of createdAts) {
    if (!createdAt) continue;
    const at = new Date(createdAt).getTime();
    if (Number.isNaN(at) || at <= newest || at - wallClock > CLOCK_SKEW_TOLERANCE_MS) continue;
    newest = at;
  }
  return newest === instant ? now : new Date(newest);
}

/**
 * The kind of a project row. Rows read before migration 0002 has run have no
 * `kind` column — they are projects.
 */
export function projectKindOf(project: { kind?: ProjectKind | null }): ProjectKind {
  return project.kind === 'area' ? 'area' : 'project';
}

export function isArea(project: { kind?: ProjectKind | null }): boolean {
  return projectKindOf(project) === 'area';
}

/**
 * Monday (SGT) of the week `date` falls in — the Focus week boundary
 * (SPEC-V2 §3). Accepts a `YYYY-MM-DD` key (taken as-is) or a Date / ISO
 * timestamp (bucketed into the app timezone first).
 */
export function weekStartSgt(
  date: Date | string = new Date(),
  cfg: AppConfig = defaultConfig,
): DateKey {
  const key = isDateKey(date) ? date : toDateKey(typeof date === 'string' ? new Date(date) : date, cfg.timezone);
  const offset = (dayOfWeek(key) - cfg.focus.weekStartsOn + 7) % 7;
  return addDays(key, -offset);
}

/** Every date key from `from` to `to`, inclusive. Empty if `to < from`. */
function daysFromTo(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/* ================================================================== */
/* WIP + reward gate (areas never count)                              */
/* ================================================================== */

export interface WipProjectInput {
  stage: ProjectStage | string;
  kind?: ProjectKind | null;
}

/** How many kind='project' rows are in an active stage. Areas never count. */
export function countActiveProjects(
  projects: readonly WipProjectInput[],
  cfg: AppConfig = defaultConfig,
): number {
  return projects.filter(
    (p) => !isArea(p) && cfg.projects.activeStages.includes(p.stage as ProjectStage),
  ).length;
}

export interface RewardGate {
  locked: boolean;
  /** Informational only in v2 — stuck no longer locks rewards. */
  hasStuckProject: boolean;
  isOverCap: boolean;
  activeCount: number;
  cap: number;
}

/**
 * SPEC-V2 §3: unclaimed rewards lock ONLY while the portfolio is over the soft
 * cap. Stuck no longer locks anything (the Sunday review handles it).
 */
export function rewardGate(
  projects: readonly (WipProjectInput & { stuck_since?: string | null })[],
  cfg: AppConfig = defaultConfig,
): RewardGate {
  const activeCount = countActiveProjects(projects, cfg);
  const cap = cfg.projects.wipLimit;
  const isOverCap = activeCount > cap;
  const hasStuckProject = projects.some((p) => !isArea(p) && p.stuck_since != null);
  return { locked: isOverCap, hasStuckProject, isOverCap, activeCount, cap };
}

/* ================================================================== */
/* Flow score — live over the rolling 7 days                          */
/* ================================================================== */

/** The minimum shape `computeFlow` needs from a routine row. */
export interface FlowRoutineInput {
  id: string;
  name?: string;
  cadence: RoutineCadence;
  /** Times per week. Null falls back to `config.flow.defaultDailyTarget`. */
  weekly_target?: number | null;
  active?: boolean;
  /** The rest-day routine. Ticking it makes that date a sabbath day. */
  is_sabbath?: boolean;
}

/** The minimum shape `computeFlow` needs from a routine_checks row. */
export interface FlowCheckInput {
  routine_id: string;
  date: DateKey;
  count: number;
}

export interface FlowScoreInput {
  routines: FlowRoutineInput[];
  checks: FlowCheckInput[];
  /** Last day of the rolling window, inclusive. Defaults to today (SGT). */
  asOf?: DateKey;
}

export interface FlowRoutineBreakdown {
  id: string;
  name?: string;
  cadence: RoutineCadence;
  /** How many ticks happened in the window. */
  actual: number;
  /** How many were required, after sabbath days were removed from the denominator. */
  target: number;
  /** actual / target, clamped to 0–1. */
  rate: number;
}

export interface FlowScoreBreakdown {
  score: number;
  /** The date keys that made up the window, oldest first. */
  window: DateKey[];
  /** Dates in the window marked as sabbath. */
  sabbathDays: DateKey[];
  routines: FlowRoutineBreakdown[];
}

/**
 * Flow = routine adherence over a rolling 7 days, computed live on read
 * (SPEC-V2 §3 "Flow — unchanged formula, but live").
 *
 * Each *active* routine contributes its completion rate against target, and all
 * routines are weighted equally. Sabbath days are excluded from denominators:
 * a routine's target is pro-rated by the number of non-sabbath days in the
 * window, so one rest day in a 7-day window scales every target by 6/7.
 *
 * - `daily` routines: numerator = number of days in the window with any tick.
 * - `weekly` routines: numerator = sum of counts across the window.
 * - The sabbath routine itself is never pro-rated (it would score against
 *   itself); it is measured straight against its weekly target.
 *
 * Ticks that land ON a sabbath day still count towards the numerator.
 */
export function computeFlow(
  input: FlowScoreInput,
  cfg: AppConfig = defaultConfig,
): FlowScoreBreakdown {
  const asOf = input.asOf ?? todayKey(cfg.timezone);
  const windowDays = cfg.flow.windowDays;
  const window = lastNDates(windowDays, asOf);
  const windowSet = new Set(window);

  const routines = input.routines.filter((r) => r.active !== false);
  const sabbathRoutine = routines.find((r) => r.is_sabbath);

  // Ticks, bucketed by routine then by date, restricted to the window.
  const byRoutine = new Map<string, Map<DateKey, number>>();
  for (const check of input.checks) {
    if (!windowSet.has(check.date)) continue;
    if (!check.count) continue;
    let bucket = byRoutine.get(check.routine_id);
    if (!bucket) {
      bucket = new Map();
      byRoutine.set(check.routine_id, bucket);
    }
    bucket.set(check.date, (bucket.get(check.date) ?? 0) + check.count);
  }

  const sabbathDays = sabbathRoutine
    ? window.filter((d) => (byRoutine.get(sabbathRoutine.id)?.get(d) ?? 0) > 0)
    : [];
  const nonSabbathDays = windowDays - sabbathDays.length;

  const breakdowns: FlowRoutineBreakdown[] = routines.map((routine) => {
    const ticks = byRoutine.get(routine.id) ?? new Map<DateKey, number>();

    const weeklyTarget =
      routine.weekly_target ??
      (routine.cadence === 'daily' ? cfg.flow.defaultDailyTarget : 1);

    const weeksInWindow = windowDays / 7;
    const availability = routine.is_sabbath ? 1 : nonSabbathDays / windowDays;

    let target = weeklyTarget * weeksInWindow * availability;
    let actual: number;

    if (routine.cadence === 'daily') {
      actual = [...ticks.values()].filter((c) => c > 0).length;
      target = Math.min(target, routine.is_sabbath ? windowDays : nonSabbathDays);
    } else {
      actual = [...ticks.values()].reduce((sum, c) => sum + c, 0);
    }

    const rate = target <= 0 ? 1 : clamp(actual / target, 0, 1);
    return { id: routine.id, name: routine.name, cadence: routine.cadence, actual, target, rate };
  });

  if (breakdowns.length === 0) {
    return { score: cfg.flow.scoreWhenNoRoutines, window, sabbathDays, routines: [] };
  }

  const mean = breakdowns.reduce((sum, r) => sum + r.rate, 0) / breakdowns.length;
  const score = clamp(Math.round(mean * 100), cfg.flow.min, cfg.flow.max);

  return { score, window, sabbathDays, routines: breakdowns };
}

/** v1 name, kept: same maths as `computeFlow`. */
export function explainFlowScore(
  input: FlowScoreInput,
  cfg: AppConfig = defaultConfig,
): FlowScoreBreakdown {
  return computeFlow(input, cfg);
}

/** v1 name, kept: just the number. */
export function computeFlowScore(input: FlowScoreInput, cfg: AppConfig = defaultConfig): number {
  return computeFlow(input, cfg).score;
}

/* ================================================================== */
/* Stage-event replay                                                 */
/* ================================================================== */

/** The minimum shape the engine needs from a stage_events row. */
export interface FocusEventInput {
  project_id: string;
  from_stage?: ProjectStage | null;
  to_stage: ProjectStage;
  /** ISO timestamp. Bucketed into an app-timezone day before comparison. */
  created_at: string;
  /** Carries the import marker (`IMPORT_EVENT_MARKER`). */
  note?: string | null;
}

/**
 * Marks a `stage_events` row written by `importProject` rather than the normal
 * create/move flow: an already-running project is not "starting" anything, so
 * it never pays the activation charge.
 */
export const IMPORT_EVENT_MARKER = '[import]';

function isImportMarked(event: FocusEventInput): boolean {
  return typeof event.note === 'string' && event.note.startsWith(IMPORT_EVENT_MARKER);
}

/**
 * "Starting" something (SPEC-V2 §3): creation or a move from
 * `focus.activationFromStages` (Idea) into an active stage, unless imported.
 */
function isActivationEvent(event: FocusEventInput, cfg: AppConfig): boolean {
  return (
    cfg.projects.activeStages.includes(event.to_stage) &&
    (event.from_stage == null || cfg.focus.activationFromStages.includes(event.from_stage)) &&
    !isImportMarked(event)
  );
}

interface TimelineEntry {
  day: DateKey;
  at: number;
  stage: ProjectStage;
}

function toSet(ids: ReadonlySet<string> | readonly string[] | undefined): ReadonlySet<string> {
  if (!ids) return new Set();
  return ids instanceof Set ? ids : new Set(ids as readonly string[]);
}

/** project_id → its stage changes, oldest first (by full timestamp). */
function buildTimelines(
  events: readonly FocusEventInput[],
  cfg: AppConfig,
  exclude: ReadonlySet<string> = new Set(),
): Map<string, TimelineEntry[]> {
  const timelines = new Map<string, TimelineEntry[]>();
  for (const event of events) {
    if (exclude.has(event.project_id)) continue;
    const list = timelines.get(event.project_id) ?? [];
    list.push({
      day: toDateKey(event.created_at, cfg.timezone),
      at: new Date(event.created_at).getTime(),
      stage: event.to_stage,
    });
    timelines.set(event.project_id, list);
  }
  // Order by the full timestamp, not the day: a project is routinely created
  // and moved into Building on the same day, and it is the LAST event of the
  // day that decides its state at the day's close.
  for (const list of timelines.values()) list.sort((a, b) => a.at - b.at);
  return timelines;
}

/** Stage at the close of `day` (null ⇒ the project did not exist yet). */
function stageAtEndOf(list: readonly TimelineEntry[], day: DateKey): ProjectStage | null {
  let stage: ProjectStage | null = null;
  for (const entry of list) {
    if (entry.day > day) break;
    stage = entry.stage;
  }
  return stage;
}

/** Stage at an exact instant (null ⇒ did not exist yet). */
function stageAtInstant(list: readonly TimelineEntry[], instant: number): ProjectStage | null {
  let stage: ProjectStage | null = null;
  for (const entry of list) {
    if (entry.at > instant) break;
    stage = entry.stage;
  }
  return stage;
}

/**
 * For each day in `window`, how many kind='project' rows were Active at that
 * day's close, and how far over the soft cap that was. Derived from the
 * stage-event log, not stored — the log is the source of truth, it back-fills
 * if the cron misses a night, and correcting it corrects history.
 *
 * Pass `areaIds` so areas never count.
 */
export function countOverCapProjectDays(
  events: readonly FocusEventInput[],
  window: readonly DateKey[],
  cfg: AppConfig = defaultConfig,
  areaIds?: ReadonlySet<string> | readonly string[],
): { perDay: { date: DateKey; activeCount: number; overBy: number }[]; total: number; days: number } {
  const cap = cfg.projects.wipLimit;
  const active = new Set<ProjectStage>(cfg.projects.activeStages);
  const timelines = buildTimelines(events, cfg, toSet(areaIds));

  const perDay = window.map((date) => {
    let activeCount = 0;
    for (const list of timelines.values()) {
      const stage = stageAtEndOf(list, date);
      if (stage && active.has(stage)) activeCount += 1;
    }
    return { date, activeCount, overBy: Math.max(0, activeCount - cap) };
  });

  return {
    perDay,
    total: perDay.reduce((sum, d) => sum + d.overBy, 0),
    days: perDay.filter((d) => d.overBy > 0).length,
  };
}

/** Projects that reached a kill-bonus stage at or before `instant` (all-time if null). */
function reachedBonusStage(
  events: readonly FocusEventInput[],
  cfg: AppConfig,
): Map<string, number> {
  // project_id → earliest instant it entered a bonus stage
  const reached = new Map<string, number>();
  for (const e of events) {
    if (!cfg.focus.killBonusStages.includes(e.to_stage)) continue;
    const at = new Date(e.created_at).getTime();
    const prev = reached.get(e.project_id);
    if (prev === undefined || at < prev) reached.set(e.project_id, at);
  }
  return reached;
}

function isDecisiveKill(
  kill: FocusEventInput,
  reached: Map<string, number>,
  cfg: AppConfig,
): boolean {
  if (kill.from_stage != null && cfg.focus.killBonusStages.includes(kill.from_stage)) return true;
  const at = reached.get(kill.project_id);
  return at !== undefined && at <= new Date(kill.created_at).getTime();
}

/* ================================================================== */
/* Stuck — SPEC-V2 §2                                                 */
/* ================================================================== */

/** The minimum shape stuck detection needs from a project row. */
export interface StuckProjectInput {
  id: string;
  stage: ProjectStage;
  kind?: ProjectKind | null;
  /** When the current stage was entered — a progress signal on its day. */
  stage_changed_at?: Timestamp | null;
  /** When next_action was last edited — a progress signal on its day. */
  next_action_updated_at?: Timestamp | null;
  created_at?: Timestamp | null;
}

/** The minimum shape the engine needs from a progress_events row. */
export interface ProgressEventInput {
  project_id: string;
  kind?: ProgressKind;
  day: DateKey;
  created_at?: Timestamp | null;
}

/** The minimum shape the engine needs from a key_dates row. */
export interface StuckKeyDateInput {
  project_id: string | null;
  date: DateKey;
}

/** Days with any progress signal for one project, from events + the row's clocks. */
function progressDaysFor(
  project: StuckProjectInput,
  progressEvents: readonly ProgressEventInput[],
  extraDays: readonly DateKey[],
  cfg: AppConfig,
): DateKey[] {
  const days = new Set<DateKey>(extraDays);
  for (const e of progressEvents) if (e.project_id === project.id) days.add(e.day);
  if (project.stage_changed_at) days.add(toDateKey(project.stage_changed_at, cfg.timezone));
  if (project.next_action_updated_at) days.add(toDateKey(project.next_action_updated_at, cfg.timezone));
  return [...days];
}

/**
 * Core rule, evaluated at the close of `day` with the project in `stage`:
 *
 *  1. idle — no progress signal for `staleThresholdDays` (14) and the stage is
 *     Building / Shipped / Commercialising ⇒ stuck since last progress + 14;
 *  2. key date — a linked key date is on/before `day`, the project is not
 *     terminal, and there has been no progress signal on or after it ⇒ stuck
 *     since the key date (any non-terminal stage, Ideas included).
 *
 * Any progress signal clears both, instantly. Areas are never stuck.
 */
function stuckSinceOn(
  kind: ProjectKind,
  stage: ProjectStage | null,
  progressDays: readonly DateKey[],
  keyDates: readonly DateKey[],
  day: DateKey,
  cfg: AppConfig,
): DateKey | null {
  if (kind === 'area' || stage == null) return null;
  if (cfg.projects.terminalStages.includes(stage)) return null;

  const upTo = progressDays.filter((d) => d <= day);
  let since: DateKey | null = null;

  if (cfg.projects.staleStages.includes(stage)) {
    const last = upTo.reduce<DateKey | null>((m, d) => maxKey(m, d), null);
    if (last) {
      const wentStale = addDays(last, cfg.projects.staleThresholdDays);
      if (wentStale <= day) since = wentStale;
    }
  }

  for (const kd of keyDates) {
    if (kd > day) continue;
    const progressedSince = upTo.some((d) => d >= kd);
    if (!progressedSince && (since == null || kd < since)) since = kd;
  }

  return since;
}

/**
 * The day a project became stuck as of `now`, or null if it is not stuck
 * (SPEC-V2 §2). `progressEvents` / `keyDates` may contain other projects' rows;
 * they are filtered by id. Progress = any progress_events row (did it, commit,
 * next action, stage) plus the `stage_changed_at` / `next_action_updated_at`
 * clocks on the row.
 */
export function stuckSince(
  project: StuckProjectInput,
  progressEvents: readonly ProgressEventInput[],
  keyDates: readonly StuckKeyDateInput[],
  now: Date | string = new Date(),
  cfg: AppConfig = defaultConfig,
): DateKey | null {
  const { today } = resolveNow(now, cfg);
  return stuckSinceOn(
    projectKindOf(project),
    project.stage,
    progressDaysFor(project, progressEvents, [], cfg),
    keyDates.filter((k) => k.project_id === project.id).map((k) => k.date),
    today,
    cfg,
  );
}

/** SPEC-V2 §2 — is this project stuck as of `now`? */
export function isStuck(
  project: StuckProjectInput,
  progressEvents: readonly ProgressEventInput[],
  keyDates: readonly StuckKeyDateInput[],
  now: Date | string = new Date(),
  cfg: AppConfig = defaultConfig,
): boolean {
  return stuckSince(project, progressEvents, keyDates, now, cfg) !== null;
}

/* ================================================================== */
/* Focus — weekly, live, recoverable (SPEC-V2 §3)                     */
/* ================================================================== */

export interface FocusWeekInput {
  /** Every project row (kind decides what is scored). */
  projects: readonly StuckProjectInput[];
  /** The ENTIRE stage-event history — needed to replay who was Active when. */
  stageEvents: readonly FocusEventInput[];
  /**
   * Progress events covering at least `weekStart − staleThresholdDays` to now
   * (stuck detection) — `config.projects.progressLookbackDays` does this.
   */
  progressEvents: readonly ProgressEventInput[];
  /** Linked key dates (the key-date stuck rule). */
  keyDates?: readonly StuckKeyDateInput[];
}

const LINE_ORDER: FocusDeltaType[] = [
  'activation',
  'overCap',
  'stuck',
  'abandoned',
  'done',
  'decisiveKill',
  'didIt',
];

const LINE_LABELS: Record<FocusDeltaType, string> = {
  activation: 'Started over cap',
  overCap: 'Over cap (project-days)',
  stuck: 'Stuck this week',
  abandoned: 'Abandoned',
  done: 'Finished',
  decisiveKill: 'Killed on purpose',
  didIt: 'Did it',
};

/**
 * This week's Focus (SPEC-V2 §3). Starts at 100 every Monday 00:00 SGT and is
 * computed from events, live:
 *
 *   −15  activation into Building/Commercialising that puts the portfolio
 *        OVER the cap (at or under cap, starting is free). Immediate.
 *   −10  per over-cap project per day — charged at each day's close, this week only
 *   −10  per stuck project, ONCE per week — charged if it is stuck at any day's close
 *   −25  abandoned. Immediate.
 *   +20  done. Immediate.
 *   +10  decisive kill (reached Building or beyond). Immediate.
 *   +2   per Did-it tap, at most +10 per day across projects. Immediate.
 *
 * Daily charges (over cap, stuck) land when a day CLOSES, so Monday morning
 * always reads 100, and acting before midnight (a Did-it, a kill) avoids the
 * charge. What would land tonight is reported in `pending`, not in `score`.
 *
 * `now`: a Date / ISO timestamp = live at that instant (today still open);
 * a `YYYY-MM-DD` = as of the close of that day. Areas never count.
 */
export function computeFocusWeek(
  input: FocusWeekInput,
  weekStart: DateKey = weekStartSgt(new Date()),
  now: Date | string = new Date(),
  cfg: AppConfig = defaultConfig,
): FocusWeekBreakdown {
  const f = cfg.focus;
  const ws = weekStartSgt(weekStart, cfg);
  const we = addDays(ws, 6);
  const { today, instant } = resolveNow(now, cfg);

  const asOf = today < ws ? ws : today > we ? we : today;
  const live = instant !== null && today >= ws && today <= we;
  let chargedThrough: DateKey | null =
    today < ws ? null : instant === null ? asOf : today > we ? we : addDays(today, -1);
  if (chargedThrough !== null && chargedThrough < ws) chargedThrough = null;

  const areaIds = new Set(input.projects.filter(isArea).map((p) => p.id));
  const happened = (createdAt: string | null | undefined, day: DateKey): boolean =>
    day <= asOf && (instant === null || !createdAt || new Date(createdAt).getTime() <= instant);

  // Stage events for scored projects that have happened by `now`.
  const events = input.stageEvents.filter(
    (e) =>
      !areaIds.has(e.project_id) &&
      today >= ws &&
      happened(e.created_at, toDateKey(e.created_at, cfg.timezone)),
  );
  const eventDay = (e: FocusEventInput) => toDateKey(e.created_at, cfg.timezone);
  const inWeek = events.filter((e) => eventDay(e) >= ws);

  // --- activation over cap: replay the whole log in time order ------------
  let activationCount = 0;
  {
    const sorted = [...events].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    const stageNow = new Map<string, ProjectStage>();
    let activeCount = 0;
    const isActive = (s: ProjectStage | undefined) =>
      s !== undefined && cfg.projects.activeStages.includes(s);
    for (const e of sorted) {
      const before = stageNow.get(e.project_id);
      if (isActive(before)) activeCount -= 1;
      stageNow.set(e.project_id, e.to_stage);
      if (isActive(e.to_stage)) activeCount += 1;
      if (eventDay(e) >= ws && isActivationEvent(e, cfg) && activeCount > cfg.projects.wipLimit) {
        activationCount += 1;
      }
    }
  }

  // --- exits --------------------------------------------------------------
  const reached = reachedBonusStage(events, cfg);
  const doneCount = inWeek.filter((e) => e.to_stage === 'done').length;
  const abandonedCount = inWeek.filter((e) => e.to_stage === 'abandoned').length;
  const decisiveKillCount = inWeek.filter(
    (e) => e.to_stage === 'killed' && isDecisiveKill(e, reached, cfg),
  ).length;

  // --- over cap, charged at each closed day -------------------------------
  const chargedDays = chargedThrough ? daysFromTo(ws, chargedThrough) : [];
  const overCap = countOverCapProjectDays(events, chargedDays, cfg, areaIds);
  const timelines = buildTimelines(events, cfg);
  let pendingOverBy = 0;
  if (live && instant !== null) {
    let activeNow = 0;
    for (const list of timelines.values()) {
      const stage = stageAtInstant(list, instant);
      if (stage && cfg.projects.activeStages.includes(stage)) activeNow += 1;
    }
    pendingOverBy = Math.max(0, activeNow - cfg.projects.wipLimit);
  }

  // --- stuck, once per project per week -----------------------------------
  const keyDates = input.keyDates ?? [];
  const progress = input.progressEvents.filter((e) => happened(e.created_at ?? null, e.day));
  const stuckProjectIds: string[] = [];
  const pendingStuckIds: string[] = [];
  for (const project of input.projects) {
    if (areaIds.has(project.id)) continue;
    const list = timelines.get(project.id) ?? [];
    const createdDay = project.created_at ? toDateKey(project.created_at, cfg.timezone) : null;
    const stageOn = (day: DateKey): ProjectStage | null => {
      if (list.length > 0) return stageAtEndOf(list, day);
      // No stage history at all (should not happen): fall back to the row.
      return createdDay && createdDay > day ? null : project.stage;
    };
    const days = progressDaysFor(
      project,
      progress,
      list.map((t) => t.day),
      cfg,
    );
    const kds = keyDates.filter((k) => k.project_id === project.id).map((k) => k.date);

    const charged = chargedDays.some(
      (d) => stuckSinceOn('project', stageOn(d), days, kds, d, cfg) !== null,
    );
    if (charged) {
      stuckProjectIds.push(project.id);
      continue;
    }
    if (live && instant !== null) {
      const stageNowValue = list.length > 0 ? stageAtInstant(list, instant) : stageOn(today);
      if (stuckSinceOn('project', stageNowValue, days, kds, today, cfg) !== null) {
        pendingStuckIds.push(project.id);
      }
    }
  }

  // --- did it: +2 per tap, capped per day ---------------------------------
  const tapsByDay = new Map<DateKey, Set<string>>();
  for (const e of progress) {
    if ((e.kind ?? 'did_it') !== 'did_it') continue;
    if (areaIds.has(e.project_id)) continue;
    if (e.day < ws || e.day > asOf || today < ws) continue;
    const set = tapsByDay.get(e.day) ?? new Set<string>();
    set.add(e.project_id);
    tapsByDay.set(e.day, set);
  }
  let didItCount = 0;
  let didItPoints = 0;
  for (const set of tapsByDay.values()) {
    didItCount += set.size;
    didItPoints += Math.min(set.size * f.didItBonus, f.didItDailyCap);
  }

  const counts: Record<FocusDeltaType, number> = {
    activation: activationCount,
    overCap: overCap.total,
    stuck: stuckProjectIds.length,
    abandoned: abandonedCount,
    done: doneCount,
    decisiveKill: decisiveKillCount,
    didIt: didItCount,
  };
  const perUnit: Record<FocusDeltaType, number> = {
    activation: f.activationOverCapPenalty,
    overCap: f.overCapPenaltyPerProjectPerDay,
    stuck: f.stuckPenaltyPerWeek,
    abandoned: f.abandonedPenalty,
    done: f.doneBonus,
    decisiveKill: f.decisiveKillBonus,
    didIt: f.didItBonus,
  };
  const deltas = {} as Record<FocusDeltaType, number>;
  for (const type of LINE_ORDER) {
    deltas[type] = z(type === 'didIt' ? didItPoints : counts[type] * perUnit[type]);
  }
  const lines: FocusWeekLine[] = LINE_ORDER.map((type) => ({
    type,
    label: LINE_LABELS[type],
    count: counts[type],
    perUnit: perUnit[type],
    points: deltas[type],
  }));

  const raw = f.startingScore + LINE_ORDER.reduce((sum, t) => sum + deltas[t], 0);

  return {
    score: clamp(Math.round(raw), f.min, f.max),
    raw,
    base: f.startingScore,
    weekStart: ws,
    weekEnd: we,
    asOf,
    chargedThrough,
    lines,
    deltas,
    pending: {
      overCap: z(pendingOverBy * f.overCapPenaltyPerProjectPerDay),
      stuck: z(pendingStuckIds.length * f.stuckPenaltyPerWeek),
      stuckProjectIds: pendingStuckIds,
      overBy: pendingOverBy,
    },
    overCapDays: overCap.days,
    stuckProjectIds,
  };
}

/* ================================================================== */
/* Up-only counters (SPEC-V2 §3)                                      */
/* ================================================================== */

export interface CountersInput {
  /** The entire stage-event history. */
  stageEvents: readonly FocusEventInput[];
  /** Did-it progress events (any other kind is ignored), all time. */
  didItEvents: readonly ProgressEventInput[];
  /** kind='area' project ids — excluded from finished / kills / weeks under cap. */
  areaIds?: readonly string[];
}

function countersFor(
  stageEvents: readonly FocusEventInput[],
  allEvents: readonly FocusEventInput[],
  didItDays: readonly DateKey[],
  firstDay: DateKey | null,
  lastCompletedWeekStart: DateKey,
  areaIds: ReadonlySet<string>,
  cfg: AppConfig,
): Counters {
  const reached = reachedBonusStage(allEvents, cfg);
  const finished = stageEvents.filter((e) => e.to_stage === 'done').length;
  const decisiveKills = stageEvents.filter(
    (e) => e.to_stage === 'killed' && isDecisiveKill(e, reached, cfg),
  ).length;

  let weeksUnderCap = 0;
  if (firstDay) {
    for (let ws = weekStartSgt(firstDay, cfg); ws <= lastCompletedWeekStart; ws = addDays(ws, 7)) {
      const from = ws < firstDay ? firstDay : ws;
      const days = daysFromTo(from, addDays(ws, 6));
      if (countOverCapProjectDays(allEvents, days, cfg, areaIds).days === 0) weeksUnderCap += 1;
    }
  }

  return { finished, decisiveKills, didItDays: new Set(didItDays).size, weeksUnderCap };
}

/**
 * The up-only counters, for the current season and lifetime (SPEC-V2 §3, §7):
 * Finished · Killed on purpose · Did-it days · Weeks under cap.
 *
 * Only COMPLETED weeks count toward "weeks under cap", so a counter can never
 * go down as the current week unfolds. Did-it days include taps on areas (it
 * is a "showed up" record, not a score); everything else is projects only.
 *
 * `seasonStart`: the current season's `started_at` (or a date key). Null ⇒ the
 * season counters equal lifetime.
 */
export function computeCounters(
  events: CountersInput,
  seasonStart: Date | string | null,
  now: Date | string = new Date(),
  cfg: AppConfig = defaultConfig,
): CountersSummary {
  const { today } = resolveNow(now, cfg);
  const areaIds = new Set(events.areaIds ?? []);
  const lastCompletedWeekStart = addDays(weekStartSgt(today, cfg), -7);

  const stage = events.stageEvents.filter(
    (e) => !areaIds.has(e.project_id) && toDateKey(e.created_at, cfg.timezone) <= today,
  );
  const didIt = events.didItEvents
    .filter((e) => (e.kind ?? 'did_it') === 'did_it' && e.day <= today)
    .map((e) => e.day);

  const firstEventDay =
    stage.reduce<DateKey | null>(
      (min, e) => {
        const d = toDateKey(e.created_at, cfg.timezone);
        return min === null || d < min ? d : min;
      },
      null,
    );

  const lifetime = countersFor(stage, stage, didIt, firstEventDay, lastCompletedWeekStart, areaIds, cfg);

  if (seasonStart == null) return { season: lifetime, lifetime, seasonStart: null };

  const seasonDay = isDateKey(seasonStart)
    ? seasonStart
    : toDateKey(typeof seasonStart === 'string' ? new Date(seasonStart) : seasonStart, cfg.timezone);
  const seasonInstant = isDateKey(seasonStart)
    ? null
    : (typeof seasonStart === 'string' ? new Date(seasonStart) : seasonStart).getTime();

  const seasonStage = stage.filter((e) =>
    seasonInstant === null
      ? toDateKey(e.created_at, cfg.timezone) >= seasonDay
      : new Date(e.created_at).getTime() >= seasonInstant,
  );
  const seasonDidIt = didIt.filter((d) => d >= seasonDay);
  const seasonFirstDay = firstEventDay === null ? null : maxKey(firstEventDay, seasonDay);

  const season = countersFor(
    seasonStage,
    stage,
    seasonDidIt,
    seasonFirstDay,
    lastCompletedWeekStart,
    areaIds,
    cfg,
  );

  return { season, lifetime, seasonStart: seasonDay };
}

/* ================================================================== */
/* Today's move — SPEC-V2 §1                                          */
/* ================================================================== */

/** The minimum shape `pickTodaysMove` needs from a project row. */
export interface TodaysMoveProjectInput extends StuckProjectInput {
  name: string;
  next_action: string;
  stage_target_date: DateKey | null;
  stuck_since: DateKey | null;
}

/** The minimum shape `pickTodaysMove` needs from a daily_moves row. */
export interface DailyMoveInput {
  day: DateKey;
  project_id: string;
  outcome: MoveOutcome;
}

interface MoveCandidate {
  view: TodaysMoveProject;
  lastShown: DateKey | '';
}

const MOVE_COMPARATORS: Record<TodaysMoveCriterion, (a: MoveCandidate, b: MoveCandidate) => number> = {
  // Stuck first.
  stuck: (a, b) => Number(b.view.isStuck) - Number(a.view.isStuck),
  // Nearest target date first; no target date last.
  target: (a, b) => {
    const ta = a.view.stage_target_date;
    const tb = b.view.stage_target_date;
    if (ta === tb) return 0;
    if (!ta) return 1;
    if (!tb) return -1;
    return ta < tb ? -1 : 1;
  },
  // Longest since last progress first.
  idle: (a, b) =>
    a.view.lastProgressDay === b.view.lastProgressDay
      ? 0
      : a.view.lastProgressDay < b.view.lastProgressDay
        ? -1
        : 1,
  // Round-robin: least recently on the card first (never shown = first).
  rotation: (a, b) => (a.lastShown === b.lastShown ? 0 : a.lastShown < b.lastShown ? -1 : 1),
};

function sortCandidates(
  list: MoveCandidate[],
  order: readonly TodaysMoveCriterion[],
): MoveCandidate[] {
  return [...list].sort((a, b) => {
    for (const criterion of order) {
      const c = MOVE_COMPARATORS[criterion](a, b);
      if (c !== 0) return c;
    }
    return a.view.name.localeCompare(b.view.name) || a.view.id.localeCompare(b.view.id);
  });
}

function decorateMoveProject(
  project: TodaysMoveProjectInput,
  progressEvents: readonly ProgressEventInput[],
  today: DateKey,
  cfg: AppConfig,
): TodaysMoveProject {
  const days = progressDaysFor(project, progressEvents, [], cfg).filter((d) => d <= today);
  const fallback = project.created_at ? toDateKey(project.created_at, cfg.timezone) : today;
  const lastProgressDay = days.reduce<DateKey | null>((m, d) => maxKey(m, d), null) ?? fallback;
  const kind = projectKindOf(project);
  return {
    id: project.id,
    name: project.name,
    kind,
    stage: project.stage,
    next_action: project.next_action,
    stage_target_date: project.stage_target_date,
    stuck_since: project.stuck_since,
    isStuck: kind === 'project' && project.stuck_since != null,
    daysInStage: project.stage_changed_at
      ? Math.max(0, daysBetween(toDateKey(project.stage_changed_at, cfg.timezone), today))
      : 0,
    daysToTarget: project.stage_target_date ? daysBetween(today, project.stage_target_date) : null,
    lastProgressDay,
    daysSinceProgress: Math.max(0, daysBetween(lastProgressDay, today)),
  };
}

/**
 * Which project is today's move (SPEC-V2 §1).
 *
 * Rotation = active projects (Building/Commercialising, kind='project') plus
 * every non-terminal area. Anything with a `daily_moves` row for today (done
 * or "Not today") is out until tomorrow. The rest are ordered by
 * `config.todaysMove.order`: stuck first, then nearest `stage_target_date`,
 * then longest since last progress, then round-robin (least recently on the
 * card), then name.
 *
 * Nothing in rotation ⇒ the top Idea with "Start this?" and its price, or
 * "Nothing in flight. Good." Everything handled today ⇒ `all_done`.
 */
export function pickTodaysMove(
  projects: readonly TodaysMoveProjectInput[],
  progressEvents: readonly ProgressEventInput[],
  dailyMoves: readonly DailyMoveInput[],
  today: DateKey = todayKey(),
  cfg: AppConfig = defaultConfig,
): TodaysMove {
  const terminal = (p: TodaysMoveProjectInput) => cfg.projects.terminalStages.includes(p.stage);
  const inRotation = projects.filter(
    (p) =>
      !terminal(p) && (isArea(p) || cfg.projects.activeStages.includes(p.stage)),
  );

  const todays = dailyMoves.filter((m) => m.day === today);
  const handledToday = new Set(todays.map((m) => m.project_id));
  const doneToday = todays.filter((m) => m.outcome === 'did_it').length;
  const skippedToday = todays.filter((m) => m.outcome === 'skipped').length;

  const lastShown = new Map<string, DateKey>();
  for (const m of dailyMoves) {
    if (m.day >= today) continue;
    const prev = lastShown.get(m.project_id);
    if (!prev || m.day > prev) lastShown.set(m.project_id, m.day);
  }
  const candidate = (p: TodaysMoveProjectInput): MoveCandidate => ({
    view: decorateMoveProject(p, progressEvents, today, cfg),
    lastShown: lastShown.get(p.id) ?? '',
  });

  if (inRotation.length === 0) {
    const ideas = projects.filter(
      (p) => !isArea(p) && p.stage === 'idea' && !handledToday.has(p.id),
    );
    if (ideas.length === 0) return { status: 'empty', copy: 'Nothing in flight. Good.' };
    const [top] = sortCandidates(
      ideas.map(candidate),
      cfg.todaysMove.order.filter((c) => c !== 'stuck'),
    );
    return {
      status: 'start_idea',
      project: top.view,
      cost: describeActivationCost(countActiveProjects(projects, cfg) + 1, { isNewBuild: true }, cfg),
      copy: 'Start this?',
    };
  }

  const open = inRotation.filter((p) => !handledToday.has(p.id));
  if (open.length === 0) {
    return {
      status: 'all_done',
      doneToday,
      skippedToday,
      copy: doneToday > 0 ? 'That’s today’s moves. Good.' : 'Everything’s parked for today.',
    };
  }

  const ordered = sortCandidates(open.map(candidate), cfg.todaysMove.order);
  const [winner, ...rest] = ordered;

  let reason: TodaysMoveReason;
  if (rest.length === 0) {
    reason = winner.view.isStuck ? 'stuck' : winner.view.stage_target_date ? 'target' : 'idle';
  } else {
    reason =
      cfg.todaysMove.order.find((c) => MOVE_COMPARATORS[c](winner, rest[0]) !== 0) ?? 'rotation';
  }

  return {
    status: 'move',
    project: winner.view,
    reason,
    upNext: rest.map((c) => c.view),
    doneToday,
    skippedToday,
  };
}

/* ================================================================== */
/* Sunday review + seasons                                            */
/* ================================================================== */

/**
 * The week a review on `today` is about (SPEC-V2 §4): on the last day of the
 * week (Sunday) it is the week ending today; on any other day it is the week
 * that just ended.
 */
export function reviewWeekFor(today: DateKey = todayKey(), cfg: AppConfig = defaultConfig): DateKey {
  const ws = weekStartSgt(today, cfg);
  return today === addDays(ws, 6) ? ws : addDays(ws, -7);
}

/** Is the review banner due on `today`, given that week's completion time? */
export function reviewDueFor(
  today: DateKey,
  completedAt: Timestamp | null,
  cfg: AppConfig = defaultConfig,
): ReviewDue {
  const weekStart = reviewWeekFor(today, cfg);
  const bannerDay = cfg.review.bannerDays.includes(dayOfWeek(today));
  return { weekStart, due: bannerDay && !completedAt, completedAt };
}

/**
 * SPEC-V2 §7: once a season starts, terminal projects that ended before it are
 * hidden from the board by default. Active / idea projects always carry over.
 * Nothing is deleted — this is a view filter.
 */
export function isVisibleInSeason(
  project: { stage: ProjectStage; stage_changed_at: Timestamp },
  seasonStartedAt: Timestamp | null,
  cfg: AppConfig = defaultConfig,
): boolean {
  if (!seasonStartedAt) return true;
  if (!cfg.projects.terminalStages.includes(project.stage)) return true;
  return new Date(project.stage_changed_at).getTime() >= new Date(seasonStartedAt).getTime();
}

/* ================================================================== */
/* Cost preview copy                                                  */
/* ================================================================== */

/**
 * Pure. The "state the price up front" copy for any affordance that moves a
 * project into an Active stage. Nothing is ever disabled.
 *
 * v2: starting is FREE at or under the cap (empty copy). Over the cap:
 *   "This takes you to 4 of 3 active: -15 Focus now, -10/day while over cap,
 *    rewards locked."
 */
export function describeActivationCost(
  activeCountAfter: number,
  options: { isNewBuild?: boolean } = {},
  cfg: AppConfig = defaultConfig,
): WipCostPreview {
  const cap = cfg.projects.wipLimit;
  const overBy = Math.max(0, activeCountAfter - cap);
  const level = overBy > 0 ? 'over' : activeCountAfter >= cap ? 'at' : 'under';

  const parts: string[] = [];
  if (overBy > 0) {
    if (options.isNewBuild) parts.push(`${cfg.focus.activationOverCapPenalty} Focus now`);
    parts.push(`${cfg.focus.overCapPenaltyPerProjectPerDay * overBy}/day while over cap`);
    parts.push('rewards locked');
  }

  return {
    activeCountAfter,
    cap,
    overBy,
    level,
    copy: parts.length ? `This takes you to ${activeCountAfter} of ${cap} active: ${parts.join(', ')}.` : '',
  };
}

/**
 * Pure. The price of one specific stage move, for the confirmation copy.
 *
 * - An **activation** (creation, or a move from `focus.activationFromStages`
 *   into an active stage) is priced by `describeActivationCost` — free at or
 *   under the cap, "-15 Focus now, -10/day…" over it.
 * - Any other move is **never** an activation charge. It only carries copy
 *   when it adds an active project while landing over the cap (Shipped →
 *   Building/Commercialising re-enters the active set): that copy says there
 *   is no activation charge and names the bleed it adds.
 * - A move that keeps the active count the same (Building ↔ Commercialising)
 *   or lowers it does not change the over-cap state, so its copy is empty —
 *   even while over cap. The bleed is already running; this move is not it.
 *
 * Areas never reach here (callers short-circuit them: SPEC-V2 §5).
 */
export function describeStageMoveCost(
  fromStage: ProjectStage,
  toStage: ProjectStage,
  activeCountBefore: number,
  cfg: AppConfig = defaultConfig,
): WipCostPreview & { isActivation: boolean } {
  const active = cfg.projects.activeStages;
  const fromActive = active.includes(fromStage);
  const toActive = active.includes(toStage);
  const after = activeCountBefore + (toActive ? 1 : 0) - (fromActive ? 1 : 0);
  const isActivation =
    toActive && !fromActive && cfg.focus.activationFromStages.includes(fromStage);

  if (isActivation) {
    return { ...describeActivationCost(after, { isNewBuild: true }, cfg), isActivation };
  }

  const base = describeActivationCost(after, {}, cfg);
  const addsActive = after > activeCountBefore;
  if (!addsActive || base.overBy <= 0) return { ...base, copy: '', isActivation };

  const bleed = cfg.focus.overCapPenaltyPerProjectPerDay * base.overBy;
  return {
    ...base,
    copy: `No activation charge, but this takes you to ${after} of ${base.cap} active: ${bleed}/day while over cap, rewards locked.`,
    isActivation,
  };
}

/**
 * Pure. The "Import existing projects" price tag. Importing never carries the
 * activation charge; what it can do is push the portfolio over the soft cap,
 * and the over-cap bleed is charged at the close of every day that stays over.
 */
export function describeImportImpact(
  activeCountAfter: number,
  cfg: AppConfig = defaultConfig,
): WipCostPreview {
  const cap = cfg.projects.wipLimit;
  const overBy = Math.max(0, activeCountAfter - cap);
  const level = overBy > 0 ? 'over' : activeCountAfter >= cap ? 'at' : 'under';

  if (overBy <= 0) return { activeCountAfter, cap, overBy, level, copy: '' };

  const bleed = cfg.focus.overCapPenaltyPerProjectPerDay * overBy;
  return {
    activeCountAfter,
    cap,
    overBy,
    level,
    copy: `This puts you at ${activeCountAfter} of ${cap} active. No charge for importing, but the ${bleed}/day bleed starts tonight. Finish or kill something.`,
  };
}

/** Pure. The kill-confirmation feedback. Null when killing an Idea (neutral). */
export function describeKillBonus(
  stage: ProjectStage,
  cfg: AppConfig = defaultConfig,
): string | null {
  if (!cfg.focus.killBonusStages.includes(stage)) return null;
  return `Decisive kill: +${cfg.focus.decisiveKillBonus} Focus`;
}
