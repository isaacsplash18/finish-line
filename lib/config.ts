/**
 * Finish Line — single source of truth for every tunable number.
 *
 * PRD §6.3: "Tuning values live in a single config file so Isaac can rebalance
 * without code archaeology." If you are about to hard-code a threshold, a
 * penalty or a window length anywhere else in the codebase: put it here instead.
 *
 * v2 (SPEC-V2.md §3): Focus is a WEEKLY score that resets to 100 every Monday
 * 00:00 Asia/Singapore, computed live on read. The v1 rolling-30-day keys
 * (windowDays, newBuildingPenalty, stuck recurrence, over-cap charge cap) are
 * gone — nothing reads them any more.
 *
 * Nothing in this file may import from anywhere else in the app (types only) —
 * it must stay dependency-free so `lib/scores.ts` remains pure and trivially
 * unit-testable.
 */

import type { ProjectStage } from './types';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface FocusConfig {
  /** SPEC-V2 §3: Focus resets to this at the start of every week. */
  startingScore: number;
  /**
   * Day the Focus week starts on, 0 = Sunday … 6 = Saturday, in `timezone`.
   * SPEC-V2 §3: Monday 00:00 SGT (ISO week).
   */
  weekStartsOn: number;
  /**
   * SPEC-V2 §3: activation into an active stage that puts the portfolio OVER
   * the soft cap. At or under cap, starting is free. Negative.
   */
  activationOverCapPenalty: number;
  /**
   * Which `from_stage`s count as *starting* something (creation — from_stage
   * null — always counts). Coming back from Shipped to fix something, or
   * advancing Shipped → Commercialising (the last mile), is not a start.
   */
  activationFromStages: readonly ProjectStage[];
  /**
   * SPEC-V2 §3: −10 per Active project beyond the cap, per day over cap,
   * accrued at the close of each day within the current week only.
   */
  overCapPenaltyPerProjectPerDay: number;
  /** SPEC-V2 §3: −10 per stuck project, charged at most ONCE per week. */
  stuckPenaltyPerWeek: number;
  /** SPEC-V2 §3: the worst exit. The linked reward is also forfeited. */
  abandonedPenalty: number;
  /** SPEC-V2 §3: +20 per project moved to Done. */
  doneBonus: number;
  /** SPEC-V2 §3: +10 per kill of a project that reached Building or beyond. */
  decisiveKillBonus: number;
  /** Kills from (or after reaching) these stages are decisive. Idea kills are neutral. */
  killBonusStages: readonly ProjectStage[];
  /** SPEC-V2 §3: +2 per Did-it tap… */
  didItBonus: number;
  /** …capped at this many points per day across all projects. */
  didItDailyCap: number;
  /** Hard floor / ceiling. */
  min: number;
  max: number;
}

export interface FlowConfig {
  /** Rolling window for routine adherence, in days. Computed live (SPEC-V2 §3). */
  windowDays: number;
  /** Weekly target assumed for a `daily` routine with no explicit weekly_target. */
  defaultDailyTarget: number;
  /** What to report when there are no active routines at all. */
  scoreWhenNoRoutines: number;
  min: number;
  max: number;
}

export interface ProjectsConfig {
  /** SPEC-V2 §2: no progress signal for this many days ⇒ Stuck. */
  staleThresholdDays: number;
  /**
   * SOFT cap on Active projects (kind='project' only — areas never count).
   * Nothing ever blocks a move over this number; it is priced, not prevented.
   */
  wipLimit: number;
  /** "Active = Building or Commercialising". */
  activeStages: readonly ProjectStage[];
  /** Stages the idle-based stuck rule applies to (Ideas stay free). */
  staleStages: readonly ProjectStage[];
  /** Stages from which a project can never move again. */
  terminalStages: readonly ProjectStage[];
  /**
   * How far back the data layer reads `progress_events` for stuck detection
   * and Today's-move ordering. Older progress falls back to the
   * `stage_changed_at` / `next_action_updated_at` clocks on the row, which
   * only matters for the exact `stuck_since` date of long-dead projects.
   * Must be ≥ staleThresholdDays + 7 so a whole Focus week can be evaluated.
   */
  progressLookbackDays: number;
}

/** The criteria `pickTodaysMove` sorts by, in priority order. */
export type TodaysMoveCriterion = 'stuck' | 'target' | 'idle' | 'rotation';

export interface TodaysMoveConfig {
  /** SPEC-V2 §1: stuck first, then nearest target date, then longest since progress, then round-robin. */
  order: readonly TodaysMoveCriterion[];
  /** How many days of `daily_moves` history feed the round-robin tiebreak. */
  rotationLookbackDays: number;
}

export interface GithubConfig {
  /** SPEC-V2 §6: commits from the last N days are recorded on each sync. */
  lookbackDays: number;
  /** Per-request timeout. A slow GitHub must never hold up the nightly job. */
  timeoutMs: number;
  apiBase: string;
}

export interface AppConfig {
  /** Display name, used in the manifest, shell and metadata. */
  appName: string;
  /** Every day boundary in the app (weeks, streaks, snapshots) is in this zone. */
  timezone: string;
  focus: FocusConfig;
  flow: FlowConfig;
  projects: ProjectsConfig;
  todaysMove: TodaysMoveConfig;
  github: GithubConfig;
  review: {
    /** SPEC-V2 §4: days (0 = Sunday) the review banner shows until completed. */
    bannerDays: readonly number[];
  };
  hooks: {
    /** SPEC-V2 §8: the routine `POST /api/v1/hooks/workout` increments (case-insensitive name). */
    workoutRoutineName: string;
  };
  keyDates: {
    /** Dashboard shows the next N key dates as countdown chips. */
    dashboardCount: number;
  };
  ui: {
    /** 30-day sparklines (fed by the nightly snapshot). */
    sparklinePoints: number;
    /** Rolling 4-week calendar heat view per routine. */
    heatCalendarWeeks: number;
  };
}

/* ------------------------------------------------------------------ */
/* The config                                                          */
/* ------------------------------------------------------------------ */

export const config: AppConfig = {
  appName: 'Finish Line',
  timezone: 'Asia/Singapore',

  focus: {
    startingScore: 100,
    weekStartsOn: 1, // Monday
    activationOverCapPenalty: -15,
    activationFromStages: ['idea'],
    overCapPenaltyPerProjectPerDay: -10,
    stuckPenaltyPerWeek: -10,
    abandonedPenalty: -25,
    doneBonus: 20,
    decisiveKillBonus: 10,
    killBonusStages: ['building', 'shipped', 'commercialising'],
    didItBonus: 2,
    didItDailyCap: 10,
    min: 0,
    max: 100,
  },

  flow: {
    windowDays: 7,
    defaultDailyTarget: 7,
    scoreWhenNoRoutines: 100,
    min: 0,
    max: 100,
  },

  projects: {
    staleThresholdDays: 14,
    wipLimit: 3,
    activeStages: ['building', 'commercialising'],
    staleStages: ['building', 'shipped', 'commercialising'],
    terminalStages: ['done', 'killed', 'abandoned'],
    progressLookbackDays: 35,
  },

  todaysMove: {
    order: ['stuck', 'target', 'idle', 'rotation'],
    rotationLookbackDays: 28,
  },

  github: {
    lookbackDays: 7,
    timeoutMs: 8000,
    apiBase: 'https://api.github.com',
  },

  review: {
    bannerDays: [0, 1], // Sunday, Monday
  },

  hooks: {
    workoutRoutineName: 'Workouts',
  },

  keyDates: {
    dashboardCount: 5,
  },

  ui: {
    sparklinePoints: 30,
    heatCalendarWeeks: 4,
  },
};

/* ------------------------------------------------------------------ */
/* Convenience re-exports (import these instead of drilling into config) */
/* ------------------------------------------------------------------ */

export const WIP_LIMIT = config.projects.wipLimit;
export const ACTIVE_STAGES = config.projects.activeStages;
export const TERMINAL_STAGES = config.projects.terminalStages;
export const STALE_THRESHOLD_DAYS = config.projects.staleThresholdDays;
export const SPARKLINE_POINTS = config.ui.sparklinePoints;
export const HEAT_CALENDAR_WEEKS = config.ui.heatCalendarWeeks;

export default config;
