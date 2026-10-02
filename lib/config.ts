/**
 * Finish Line — single source of truth for every tunable number.
 *
 * PRD §6.3: "Tuning values live in a single config file so Isaac can rebalance
 * without code archaeology." If you are about to hard-code a threshold, a
 * penalty or a window length anywhere else in the codebase: put it here instead.
 *
 * Nothing in this file may import from anywhere else in the app — it must stay
 * dependency-free so `lib/scores.ts` remains pure and trivially unit-testable.
 */

import type { ProjectStage } from './types';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface FocusConfig {
  /** PRD §6.2: score resets to this at the start of each rolling window. */
  startingScore: number;
  /** PRD §6.2: rolling window, in days, that stage events are counted over. */
  windowDays: number;
  /** PRD §6.2.1: penalty per project moved *into* Building during the window. */
  newBuildingPenalty: number;
  /** PRD §6.2.2: penalty per currently-Stuck project. Negative. */
  stuckPenalty: number;
  /**
   * PRD §6.2.2 says the stuck penalty is "recurring while stuck".
   * We implement that as: the penalty is charged once immediately, then again
   * for every full `stuckPenaltyRecurrenceDays` the project stays stuck.
   * e.g. with 7: 0–6 days stuck = -10, 7–13 = -20, 14–20 = -30 …
   * Set to a very large number to make the penalty a flat one-off.
   */
  stuckPenaltyRecurrenceDays: number;
  /** Safety valve so one forgotten project cannot dominate the score forever. */
  maxStuckRecurrences: number;
  /** PRD §6.2.3: penalty per project Abandoned during the window. */
  abandonedPenalty: number;
  /** PRD §6.2.4: bonus per project moved to Done during the window. */
  doneBonus: number;
  /**
   * SPEC-CHANGES §2 — over-cap bleed. The WIP cap is a SOFT cap: going over is
   * always allowed, but it bleeds. Charged per Active project beyond
   * `projects.wipLimit`, per day, for every day of the rolling window on which
   * the portfolio was over cap. Negative.
   *
   * Days are reconstructed from `stage_events` history — see
   * `countOverCapProjectDays()` in lib/scores.ts.
   */
  overCapPenaltyPerProjectPerDay: number;
  /**
   * Safety valve on the bleed: the maximum number of over-cap *project-days*
   * that can be charged in one window. Defaults to the window length, i.e. one
   * project one-over for the whole window is the worst single-project case.
   */
  maxOverCapProjectDaysCharged: number;
  /**
   * SPEC-CHANGES §2 — decisive-kill bonus. Killing early is meant to be the
   * cheapest exit: start a shiny object (−15) then kill it (+10) nets −5, far
   * better than bleeding −10/day or abandoning at −25 plus a forfeited reward.
   */
  decisiveKillBonus: number;
  /**
   * Kills from these stages earn `decisiveKillBonus` ("Building or beyond").
   * Killing an Idea is Focus-neutral — ideas are free both ways (PRD §3.3).
   */
  killBonusStages: readonly ProjectStage[];
  /** Hard floor / ceiling. PRD: "Both scores are 0 to 100". */
  min: number;
  max: number;
}

export interface FlowConfig {
  /** PRD §6.1: rolling window for routine adherence, in days. */
  windowDays: number;
  /**
   * Weekly target assumed for a `daily` routine that has no explicit
   * weekly_target (i.e. "every day").
   */
  defaultDailyTarget: number;
  /** What to report when there are no active routines at all. */
  scoreWhenNoRoutines: number;
  min: number;
  max: number;
}

export interface ProjectsConfig {
  /** PRD §3.1.5: days of no stage change AND no next-action edit ⇒ Stuck. */
  staleThresholdDays: number;
  /**
   * SOFT cap on Active projects (SPEC-CHANGES §1, overriding PRD §3.2.1).
   * Nothing in `lib/data/` ever blocks a move over this number. Going over is
   * priced, not prevented: −15 on the way in, then `overCapPenaltyPerProjectPerDay`
   * every day, plus rewards locked while over cap.
   */
  wipLimit: number;
  /** PRD §3.2.1: "Active = Building or Commercialising". */
  activeStages: readonly ProjectStage[];
  /**
   * Stages that idle-based stale detection applies to.
   * Idea is deliberately excluded — PRD §3.3 says ideas cost nothing and exist
   * as a harmless outlet for the shiny-object impulse. (Key-date-triggered
   * stuck, PRD §7.3, still applies to Idea projects.)
   */
  staleStages: readonly ProjectStage[];
  /** Stages from which a project can never move again. */
  terminalStages: readonly ProjectStage[];
}

export interface AppConfig {
  /** Display name, used in the manifest, shell and metadata. */
  appName: string;
  /** PRD §6: "recomputed daily at midnight SGT". */
  timezone: string;
  focus: FocusConfig;
  flow: FlowConfig;
  projects: ProjectsConfig;
  keyDates: {
    /** PRD §7.2: dashboard shows the next N key dates as countdown chips. */
    dashboardCount: number;
  };
  ui: {
    /** PRD §6: 30-day sparklines. */
    sparklinePoints: number;
    /** PRD §5.3.1: rolling 4-week calendar heat view per routine. */
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
    windowDays: 30,
    newBuildingPenalty: -15,
    stuckPenalty: -10,
    stuckPenaltyRecurrenceDays: 7,
    maxStuckRecurrences: 4,
    abandonedPenalty: -25,
    doneBonus: 20,
    overCapPenaltyPerProjectPerDay: -10,
    maxOverCapProjectDaysCharged: 30,
    decisiveKillBonus: 10,
    killBonusStages: ['building', 'shipped', 'commercialising'],
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
