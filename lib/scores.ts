/**
 * Finish Line — score maths. PRD §6.
 *
 * Everything in here is PURE: no Supabase, no `fetch`, no `Date.now()` beyond
 * an optional `asOf` default. Pass data in, get a number out. That is what
 * makes `lib/scores.test.ts` possible and what lets the dashboard recompute
 * optimistically without a round-trip.
 *
 * Every tunable lives in `lib/config.ts`. Pass a modified config as the last
 * argument to experiment.
 */

import { config as defaultConfig, type AppConfig } from './config';
import { addDays, daysBetween, lastNDates, toDateKey, today } from './dates';
import type { DateKey, ProjectStage, RoutineCadence } from './types';

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

/* ================================================================== */
/* Flow score — PRD §6.1                                              */
/* ================================================================== */

/** The minimum shape `computeFlowScore` needs from a routine row. */
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

/** The minimum shape `computeFlowScore` needs from a routine_checks row. */
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
 * Flow score = routine adherence over a rolling 7 days (PRD §6.1).
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
 * Ticks that land ON a sabbath day still count towards the numerator — the
 * PRD excludes sabbath days from *denominators* only, so doing the work on a
 * rest day is a bonus, never a requirement.
 */
export function computeFlowScore(input: FlowScoreInput, cfg: AppConfig = defaultConfig): number {
  return explainFlowScore(input, cfg).score;
}

/** Same maths as `computeFlowScore`, but returns the per-routine working. */
export function explainFlowScore(
  input: FlowScoreInput,
  cfg: AppConfig = defaultConfig,
): FlowScoreBreakdown {
  const asOf = input.asOf ?? today(cfg.timezone);
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

    // Scale the weekly target to the window length (7-day window ⇒ ×1).
    const weeksInWindow = windowDays / 7;
    // Sabbath days come out of the denominator — but never for the sabbath
    // routine itself, which would otherwise be scored against its own success.
    const availability = routine.is_sabbath ? 1 : nonSabbathDays / windowDays;

    let target = weeklyTarget * weeksInWindow * availability;
    let actual: number;

    if (routine.cadence === 'daily') {
      actual = [...ticks.values()].filter((c) => c > 0).length;
      // You can never need more ticks than there are days.
      target = Math.min(target, routine.is_sabbath ? windowDays : nonSabbathDays);
    } else {
      actual = [...ticks.values()].reduce((sum, c) => sum + c, 0);
    }

    const rate = target <= 0 ? 1 : clamp(actual / target, 0, 1);
    return {
      id: routine.id,
      name: routine.name,
      cadence: routine.cadence,
      actual,
      target,
      rate,
    };
  });

  if (breakdowns.length === 0) {
    return {
      score: cfg.flow.scoreWhenNoRoutines,
      window,
      sabbathDays,
      routines: [],
    };
  }

  const mean = breakdowns.reduce((sum, r) => sum + r.rate, 0) / breakdowns.length;
  const score = clamp(Math.round(mean * 100), cfg.flow.min, cfg.flow.max);

  return { score, window, sabbathDays, routines: breakdowns };
}

/* ================================================================== */
/* Focus score — PRD §6.2                                             */
/* ================================================================== */

/**
 * The minimum shape `computeFocusScore` needs from a stage_events row.
 *
 * `project_id` is required: the over-cap bleed (SPEC-CHANGES §2) replays the
 * event history day by day to work out how many projects were Active on each
 * day of the window, and the decisive-kill bonus needs to know whether a
 * killed project had ever reached Building.
 */
export interface FocusEventInput {
  project_id: string;
  from_stage?: ProjectStage | null;
  to_stage: ProjectStage;
  /** ISO timestamp. Bucketed into an app-timezone day before comparison. */
  created_at: string;
  /**
   * Free-text note carried over from `stage_events.note`. Used only to detect
   * the import marker (`IMPORT_EVENT_MARKER`) — see `isNewBuildingEvent`.
   */
  note?: string | null;
}

/**
 * Marks a `stage_events` row written by `importProject` (lib/data/projects.ts)
 * rather than the normal create/move flow. Isaac's pre-existing, in-flight
 * projects need to land in Building/Shipped/Commercialising without being
 * treated as a brand-new shiny object.
 *
 * Chosen over a new DB column: `stage_events.note` already exists, is
 * free-text, and is never parsed elsewhere — a `[prefix]` marker is a
 * zero-migration way to tag an event as "entry charge already waived" that
 * still reads fine in the timeline UI.
 */
export const IMPORT_EVENT_MARKER = '[import]';

function isImportMarked(event: FocusEventInput): boolean {
  return typeof event.note === 'string' && event.note.startsWith(IMPORT_EVENT_MARKER);
}

/** The minimum shape `computeFocusScore` needs from a currently-stuck project. */
export interface FocusStuckInput {
  id: string;
  /** Date the project became stuck. Null ⇒ not stuck, and it is ignored. */
  stuck_since: DateKey | null;
}

export interface FocusScoreInput {
  /**
   * The project's ENTIRE stage-event history, not just the window. Events
   * outside the window are ignored for the one-off deltas, but are needed to
   * reconstruct which projects were Active on each day of the window.
   */
  events: FocusEventInput[];
  /** Projects that are Stuck *right now*. */
  stuckProjects: FocusStuckInput[];
  /** Last day of the rolling window, inclusive. Defaults to today (SGT). */
  asOf?: DateKey;
}

export interface FocusScoreBreakdown {
  score: number;
  /** Where the score started before deltas. */
  base: number;
  windowStart: DateKey;
  windowEnd: DateKey;
  /** Count of projects that entered Building for the first time in the window. */
  newBuildingCount: number;
  /** Count of projects abandoned in the window. */
  abandonedCount: number;
  /** Count of projects moved to Done in the window. */
  doneCount: number;
  /** Count of kills in the window that earned the decisive-kill bonus. */
  decisiveKillCount: number;
  /** Count of kills in the window from Idea stage — Focus-neutral. */
  neutralKillCount: number;
  /** Number of currently-stuck projects. */
  stuckCount: number;
  /**
   * Total stuck charges applied — one per project, plus one extra per full
   * `focus.stuckPenaltyRecurrenceDays` the project has stayed stuck.
   */
  stuckCharges: number;
  /**
   * Total over-cap *project-days* charged in the window: for each day, the
   * number of Active projects beyond `projects.wipLimit`, summed.
   * Capped by `focus.maxOverCapProjectDaysCharged`.
   */
  overCapProjectDays: number;
  /** Number of distinct days in the window on which the portfolio was over cap. */
  overCapDays: number;
  /** Signed point contributions, for a "why is my score 62?" panel. */
  deltas: {
    newBuilding: number;
    stuck: number;
    abandoned: number;
    done: number;
    overCap: number;
    decisiveKill: number;
  };
}

/**
 * Which transitions count as "a new project moved into Building" (PRD §6.2.1).
 * Coming back from Shipped/Commercialising to fix something is not a new start
 * and is deliberately not penalised. Nor is an *imported* project — it was
 * already running before Finish Line existed; see `IMPORT_EVENT_MARKER`.
 */
function isNewBuildingEvent(event: FocusEventInput): boolean {
  return (
    event.to_stage === 'building' &&
    (event.from_stage == null || event.from_stage === 'idea') &&
    !isImportMarked(event)
  );
}

/**
 * Reconstruct, for each day of the window, how many projects were Active
 * (Building or Commercialising) and therefore how far over the soft WIP cap
 * the portfolio was. SPEC-CHANGES §2 + §4.
 *
 * We derive this from `stage_events` rather than persisting a daily condition
 * snapshot: the event log is already the source of truth for every other
 * delta, it back-fills correctly if the cron misses a night, and it means a
 * historical correction to the log corrects the score too.
 *
 * A project counts as Active on day D if its most recent event on or before D
 * moved it into an active stage. Projects whose first event is after D did not
 * exist yet and are not counted.
 *
 * Exported so the Projects screen can chart the bleed.
 */
export function countOverCapProjectDays(
  events: FocusEventInput[],
  window: DateKey[],
  cfg: AppConfig = defaultConfig,
): { perDay: { date: DateKey; activeCount: number; overBy: number }[]; total: number; days: number } {
  const cap = cfg.projects.wipLimit;
  const activeStages = new Set<ProjectStage>(cfg.projects.activeStages);

  // project_id -> [{ day, at, stage }], oldest first.
  const timelines = new Map<string, { day: DateKey; at: number; stage: ProjectStage }[]>();
  for (const event of events) {
    const day = toDateKey(event.created_at, cfg.timezone);
    const list = timelines.get(event.project_id) ?? [];
    list.push({ day, at: new Date(event.created_at).getTime(), stage: event.to_stage });
    timelines.set(event.project_id, list);
  }
  for (const list of timelines.values()) {
    // Order by the full timestamp, not just the day key. A project is routinely
    // created and moved into Building on the same day, and it is the LAST event
    // of that day that decides whether it was Active — sorting by day alone
    // leaves same-day events in caller order (`getStageEvents` hands them over
    // newest-first), which would read the day's *first* stage instead.
    list.sort((a, b) => a.at - b.at);
  }

  const perDay = window.map((date) => {
    let activeCount = 0;
    for (const list of timelines.values()) {
      let stage: ProjectStage | null = null;
      for (const entry of list) {
        if (entry.day > date) break;
        stage = entry.stage;
      }
      if (stage && activeStages.has(stage)) activeCount += 1;
    }
    return { date, activeCount, overBy: Math.max(0, activeCount - cap) };
  });

  const rawTotal = perDay.reduce((sum, d) => sum + d.overBy, 0);
  return {
    perDay,
    total: Math.min(rawTotal, cfg.focus.maxOverCapProjectDaysCharged),
    days: perDay.filter((d) => d.overBy > 0).length,
  };
}

/**
 * Focus score (PRD §6.2, as amended by SPEC-CHANGES §2).
 * Starts at `config.focus.startingScore` for each rolling 30-day window, then:
 *   −15 per new project moved into Building during the window
 *   −10 per currently-Stuck project, *recurring* while it stays stuck
 *   −25 per Abandoned project in the window
 *   +20 per project moved to Done
 *   −10 per Active project beyond the soft WIP cap, per day over cap
 *   +10 per project killed from Building or beyond (Idea kills are neutral)
 * Result is clamped to 0–100.
 *
 * "Recurring while stuck" is implemented as: charge once as soon as the project
 * is stuck, then again for every full `focus.stuckPenaltyRecurrenceDays`
 * (default 7) it remains stuck, up to `focus.maxStuckRecurrences` charges.
 *
 * The over-cap bleed accrues per day: being one project over cap for six days
 * costs 6 × 10 = 60 Focus. See `countOverCapProjectDays()`.
 */
export function computeFocusScore(input: FocusScoreInput, cfg: AppConfig = defaultConfig): number {
  return explainFocusScore(input, cfg).score;
}

/** Same maths as `computeFocusScore`, but returns the working. */
export function explainFocusScore(
  input: FocusScoreInput,
  cfg: AppConfig = defaultConfig,
): FocusScoreBreakdown {
  const f = cfg.focus;
  const windowEnd = input.asOf ?? today(cfg.timezone);
  const windowStart = addDays(windowEnd, -(f.windowDays - 1));

  const inWindow = input.events.filter((event) => {
    const day = toDateKey(event.created_at, cfg.timezone);
    return day >= windowStart && day <= windowEnd;
  });

  const newBuildingCount = inWindow.filter(isNewBuildingEvent).length;
  const abandonedCount = inWindow.filter((e) => e.to_stage === 'abandoned').length;
  const doneCount = inWindow.filter((e) => e.to_stage === 'done').length;

  // --- decisive-kill bonus (SPEC-CHANGES §2) ---------------------------
  // A kill earns the bonus if the project had ever reached Building or beyond.
  // We check the kill event's from_stage first, then fall back to scanning the
  // project's whole history (covers odd paths like building → idea → killed).
  const bonusStages = new Set<ProjectStage>(f.killBonusStages);
  const reachedBuilding = new Set<string>();
  for (const event of input.events) {
    if (bonusStages.has(event.to_stage)) reachedBuilding.add(event.project_id);
  }
  const kills = inWindow.filter((e) => e.to_stage === 'killed');
  const decisiveKills = kills.filter(
    (e) =>
      (e.from_stage != null && bonusStages.has(e.from_stage)) ||
      reachedBuilding.has(e.project_id),
  );
  const decisiveKillCount = decisiveKills.length;
  const neutralKillCount = kills.length - decisiveKillCount;

  // --- over-cap bleed (SPEC-CHANGES §2) --------------------------------
  const overCap = countOverCapProjectDays(input.events, lastNDates(f.windowDays, windowEnd), cfg);

  const stuck = input.stuckProjects.filter((p) => p.stuck_since != null);
  let stuckCharges = 0;
  for (const project of stuck) {
    const daysStuck = Math.max(0, daysBetween(project.stuck_since as DateKey, windowEnd));
    const recurrences =
      f.stuckPenaltyRecurrenceDays > 0 ? Math.floor(daysStuck / f.stuckPenaltyRecurrenceDays) : 0;
    stuckCharges += Math.min(1 + recurrences, Math.max(1, f.maxStuckRecurrences));
  }

  const deltas = {
    newBuilding: z(newBuildingCount * f.newBuildingPenalty),
    stuck: z(stuckCharges * f.stuckPenalty),
    abandoned: z(abandonedCount * f.abandonedPenalty),
    done: z(doneCount * f.doneBonus),
    overCap: z(overCap.total * f.overCapPenaltyPerProjectPerDay),
    decisiveKill: z(decisiveKillCount * f.decisiveKillBonus),
  };

  const raw =
    f.startingScore +
    deltas.newBuilding +
    deltas.stuck +
    deltas.abandoned +
    deltas.done +
    deltas.overCap +
    deltas.decisiveKill;

  return {
    score: clamp(Math.round(raw), f.min, f.max),
    base: f.startingScore,
    windowStart,
    windowEnd,
    newBuildingCount,
    abandonedCount,
    doneCount,
    decisiveKillCount,
    neutralKillCount,
    stuckCount: stuck.length,
    stuckCharges,
    overCapProjectDays: overCap.total,
    overCapDays: overCap.days,
    deltas,
  };
}

/* ================================================================== */
/* Cost preview copy (SPEC-CHANGES §1 / §4)                           */
/* ================================================================== */

export interface WipCostPreview {
  /** How many Active projects there would be after the move. */
  activeCountAfter: number;
  cap: number;
  /** How far over the cap the move leaves you. 0 when at or under. */
  overBy: number;
  /** 'under' | 'at' | 'over' — drives the WIP counter colour. */
  level: 'under' | 'at' | 'over';
  /** One-line price tag to show at the moment of action. Empty when free. */
  copy: string;
}

/**
 * Pure. Builds the "state the price up front" copy for any affordance that
 * moves a project into an Active stage.
 *
 * SPEC-CHANGES §1: nothing is ever disabled. The button works; the copy tells
 * Isaac exactly what it costs.
 *
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
  if (options.isNewBuild) parts.push(`${cfg.focus.newBuildingPenalty} Focus now`);
  if (overBy > 0) {
    parts.push(`${cfg.focus.overCapPenaltyPerProjectPerDay * overBy}/day while over cap`);
    parts.push('rewards locked');
  }

  const prefix =
    overBy > 0
      ? `This takes you to ${activeCountAfter} of ${cap} active`
      : `${activeCountAfter} of ${cap} active`;

  return {
    activeCountAfter,
    cap,
    overBy,
    level,
    copy: parts.length ? `${prefix}: ${parts.join(', ')}.` : '',
  };
}

/**
 * Pure. The "Import existing projects" price tag (Settings). Unlike
 * `describeActivationCost`, importing never carries the -15 entry charge —
 * `importProject` marks its opening event so `isNewBuildingEvent` skips it.
 * What it can still do is push the portfolio over the soft WIP cap, and the
 * over-cap bleed starts accruing from the next day onward (the import event
 * is written with today's real timestamp, never backdated).
 *
 * Returns `copy: null` when the import would not take the portfolio over cap.
 */
export function describeImportImpact(
  activeCountAfter: number,
  cfg: AppConfig = defaultConfig,
): WipCostPreview {
  const cap = cfg.projects.wipLimit;
  const overBy = Math.max(0, activeCountAfter - cap);
  const level = overBy > 0 ? 'over' : activeCountAfter >= cap ? 'at' : 'under';

  if (overBy <= 0) {
    return { activeCountAfter, cap, overBy, level, copy: '' };
  }

  const bleed = cfg.focus.overCapPenaltyPerProjectPerDay * overBy;
  return {
    activeCountAfter,
    cap,
    overBy,
    level,
    copy: `This puts you at ${activeCountAfter} of ${cap} active. No charge for importing, but the ${bleed}/day bleed starts tomorrow. Finish or kill something.`,
  };
}

/**
 * Pure. The kill-confirmation feedback (SPEC-CHANGES §4).
 * Returns null when killing from Idea, which is Focus-neutral.
 */
export function describeKillBonus(
  stage: ProjectStage,
  cfg: AppConfig = defaultConfig,
): string | null {
  if (!cfg.focus.killBonusStages.includes(stage)) return null;
  return `Decisive kill: +${cfg.focus.decisiveKillBonus} Focus`;
}
