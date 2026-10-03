/**
 * Finish Line — the whole data model, in one file.
 *
 * Mirrors `supabase/migrations/0001_init.sql` + `0002_v2.sql` exactly. If you
 * change one, change the other. PRD §9, SPEC-V2 §9.
 *
 * Naming convention: DB rows use snake_case (they come straight out of
 * Postgres); everything derived / computed in TypeScript uses camelCase.
 */

/* ================================================================== */
/* Enums                                                              */
/* ================================================================== */

/**
 * PRD §3.1.2. Idea → Building → Shipped → Commercialising → Done,
 * plus two terminal states: Killed (deliberate, no penalty) and
 * Abandoned (penalty + reward forfeit).
 */
export type ProjectStage =
  | 'idea'
  | 'building'
  | 'shipped'
  | 'commercialising'
  | 'done'
  | 'killed'
  | 'abandoned';

export const PROJECT_STAGES: readonly ProjectStage[] = [
  'idea',
  'building',
  'shipped',
  'commercialising',
  'done',
  'killed',
  'abandoned',
];

/** The stages that appear as kanban columns on the Projects screen (PRD §8.2). */
export const PIPELINE_STAGES: readonly ProjectStage[] = [
  'idea',
  'building',
  'shipped',
  'commercialising',
];

export const STAGE_LABELS: Record<ProjectStage, string> = {
  idea: 'Idea',
  building: 'Building',
  shipped: 'Shipped',
  commercialising: 'Commercialising',
  done: 'Done',
  killed: 'Killed',
  abandoned: 'Abandoned',
};

/** PRD §9.3. */
export type RewardStatus = 'locked_pending' | 'claimable' | 'claimed' | 'forfeited';

export const REWARD_STATUSES: readonly RewardStatus[] = [
  'locked_pending',
  'claimable',
  'claimed',
  'forfeited',
];

/** PRD §9.4. */
export type RoutineCadence = 'daily' | 'weekly';

export const ROUTINE_CADENCES: readonly RoutineCadence[] = ['daily', 'weekly'];

/**
 * SPEC-V2 §5. A `project` is finishable and scored. An `area` is an ongoing
 * venture (Splash Advisory, Soycraft, Life Church): it holds a next action and
 * sits in Today's-move rotation, but is exempt from the WIP cap, stuck,
 * activation charges, the kanban and every score.
 */
export type ProjectKind = 'project' | 'area';

export const PROJECT_KINDS: readonly ProjectKind[] = ['project', 'area'];

/** SPEC-V2 §2 — the four progress signals. */
export type ProgressKind = 'did_it' | 'commit' | 'next_action' | 'stage';

export const PROGRESS_KINDS: readonly ProgressKind[] = ['did_it', 'commit', 'next_action', 'stage'];

/** SPEC-V2 §1 — what happened to a project on the Today's-move card. */
export type MoveOutcome = 'did_it' | 'skipped';

/**
 * An ISO date with no time component, `YYYY-MM-DD`.
 * Everything day-shaped in this app (routine checks, key dates, score
 * snapshots) uses this, resolved in the app timezone (`config.timezone`).
 */
export type DateKey = string;

/** An ISO-8601 timestamp string, e.g. `2026-08-28T04:00:00.000Z`. */
export type Timestamp = string;

export type UUID = string;

/* ================================================================== */
/* Table rows                                                         */
/* ================================================================== */

/**
 * PRD §9.1 `projects`.
 *
 * Deviation from the PRD's column list (documented in ARCHITECTURE.md):
 * `stage_changed_at` and `next_action_updated_at` are stored explicitly so
 * stale detection (PRD §3.1.5 — "no stage change AND no next-action update
 * for 14 days") is a cheap query rather than a scan of `stage_events`.
 */
export type Project = {
  id: UUID;
  /** PRD §3.1.1 */
  name: string;
  /** One-line definition of done. PRD §3.1.1 */
  resolution: string | null;
  stage: ProjectStage;
  /** PRD §3.1.3 — required, always present. A project without one cannot be saved. */
  next_action: string;
  /** PRD §3.1.4 — target date for the *current* stage. */
  stage_target_date: DateKey | null;
  /** Non-null ⇒ the project is currently Stuck. PRD §3.1.5 */
  stuck_since: DateKey | null;
  /** Set when the project entered its current stage. Drives "days in stage". */
  stage_changed_at: Timestamp;
  /** Set whenever `next_action` is edited. Half of the staleness clock. */
  next_action_updated_at: Timestamp;
  /** Required reason when killing (PRD §3.2.3); optional note when abandoning. */
  terminal_reason: string | null;
  /**
   * v2 (0002_v2.sql). Defaults to 'project'. Read it through `projectKindOf()`
   * (lib/scores.ts), which also treats a pre-migration row without the column
   * as a project.
   */
  kind: ProjectKind;
  /** v2: GitHub "owner/name"; commits on it count as progress (SPEC-V2 §6). */
  github_repo: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/** PRD §9.2 `stage_events` — the immutable audit trail behind every score. */
export type StageEvent = {
  id: UUID;
  project_id: UUID;
  /** Null for the very first event (project creation). */
  from_stage: ProjectStage | null;
  to_stage: ProjectStage;
  /** Optional note, e.g. the kill reason. */
  note: string | null;
  created_at: Timestamp;
};

/** PRD §9.3 `rewards`. */
export type Reward = {
  id: UUID;
  /** Nullable so a reward can sit unassigned in Settings until pinned to a project. */
  project_id: UUID | null;
  name: string;
  /** Whole currency units (dollars). PRD examples: 150, 300. */
  price: number;
  status: RewardStatus;
  /** Set when status became `claimed`. PRD §4.2: "logs when claimed". */
  claimed_at: Timestamp | null;
  /** Set when status became `forfeited`. Drives the dashboard tombstone (PRD §4.3.2). */
  forfeited_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/** PRD §9.4 `routines`. */
export type Routine = {
  id: UUID;
  name: string;
  cadence: RoutineCadence;
  /**
   * Times per week this routine should happen.
   * - daily routines: how many of the 7 days must be ticked (Bible = 7, Dog walk = 5)
   * - weekly routines: how many total ticks per week (Workouts = 3, Sabbath = 1)
   */
  weekly_target: number;
  /** Inactive routines keep their history but drop out of Flow maths and the UI. */
  active: boolean;
  /**
   * Marks the one routine that means "this day is a rest day" (PRD §5.2.2).
   * Ticking it on a date makes that date a sabbath day, which is excluded from
   * every *other* routine's Flow denominator. Exactly one routine should have
   * this set; the DB enforces at-most-one via a partial unique index.
   */
  is_sabbath: boolean;
  /** Column ordering in the UI. */
  sort_order: number;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/** PRD §9.5 `routine_checks` — one row per routine per date (unique constraint). */
export type RoutineCheck = {
  id: UUID;
  routine_id: UUID;
  date: DateKey;
  /** 0 = explicitly not done. >0 = done (counters can exceed 1, e.g. two walks). */
  count: number;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/** PRD §9.6 `key_dates`. */
export type KeyDate = {
  id: UUID;
  name: string;
  date: DateKey;
  /** PRD §7.3: if linked and the date passes with the project not Done ⇒ Stuck. */
  project_id: UUID | null;
  created_at: Timestamp;
};

/** PRD §9.7 `score_snapshots` — one row per day, written by the nightly recompute. */
export type ScoreSnapshot = {
  id: UUID;
  date: DateKey;
  /** 0–100 */
  flow: number;
  /** 0–100 */
  focus: number;
  created_at: Timestamp;
};

/** v2 `progress_events` — one row per project per kind per SGT day (unique). */
export type ProgressEvent = {
  id: UUID;
  project_id: UUID;
  kind: ProgressKind;
  day: DateKey;
  created_at: Timestamp;
};

/** v2 `reviews` — the Sunday review, one row per ISO week (Monday `week_start`). */
export type Review = {
  id: UUID;
  week_start: DateKey;
  /** Null ⇒ started but not completed (the banner still shows). */
  completed_at: Timestamp | null;
  created_at: Timestamp;
};

/** v2 `seasons` — the latest row is the current season. */
export type Season = {
  id: UUID;
  started_at: Timestamp;
  name: string | null;
};

/** v2 `daily_moves` — Today's-move outcomes, unique per (day, project). */
export type DailyMove = {
  id: UUID;
  day: DateKey;
  project_id: UUID;
  outcome: MoveOutcome;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/* ================================================================== */
/* Write payloads                                                     */
/* ================================================================== */

export interface CreateProjectInput {
  name: string;
  /** Required — enforced in `lib/data/projects.ts` and by a CHECK constraint. */
  next_action: string;
  resolution?: string | null;
  /** Defaults to `idea`. Creating straight into an active stage respects the WIP limit. */
  stage?: ProjectStage;
  stage_target_date?: DateKey | null;
  /** v2. Defaults to 'project' (DB default). */
  kind?: ProjectKind;
  /** v2. "owner/name" or a github.com URL; normalised by `setProjectRepo`. */
  github_repo?: string | null;
}

export interface UpdateProjectInput {
  name?: string;
  resolution?: string | null;
  /** Editing this resets the staleness clock. Empty strings are rejected. */
  next_action?: string;
  stage_target_date?: DateKey | null;
}

/**
 * `importProject` (lib/data/projects.ts) — bring a project that predates the
 * app into it without the usual -15 Focus entry charge into Building.
 *
 * Idea-stage work doesn't need this: ideas are free, so just `createProject`
 * them normally. This is only for something already running.
 */
export interface ImportProjectInput {
  name: string;
  resolution?: string | null;
  stage: 'building' | 'shipped' | 'commercialising';
  /** The real historical start date. Backdates the display clock only —
   * never the stage_events row that scoring reads. */
  startedAt: DateKey;
  nextAction: string;
  stageTargetDate?: DateKey | null;
}

export interface CreateRewardInput {
  name: string;
  price: number;
  project_id?: UUID | null;
  status?: RewardStatus;
}

export interface UpdateRewardInput {
  name?: string;
  price?: number;
  project_id?: UUID | null;
  status?: RewardStatus;
}

export interface CreateRoutineInput {
  name: string;
  cadence: RoutineCadence;
  weekly_target: number;
  active?: boolean;
  is_sabbath?: boolean;
  sort_order?: number;
}

export interface UpdateRoutineInput {
  name?: string;
  cadence?: RoutineCadence;
  weekly_target?: number;
  active?: boolean;
  is_sabbath?: boolean;
  sort_order?: number;
}

export interface CreateKeyDateInput {
  name: string;
  date: DateKey;
  project_id?: UUID | null;
}

export interface UpdateKeyDateInput {
  name?: string;
  date?: DateKey;
  project_id?: UUID | null;
}

/* ================================================================== */
/* Derived / view models (what screens actually render)               */
/* ================================================================== */

/** A project plus everything a card or detail page needs, computed server-side. */
export interface ProjectWithMeta extends Project {
  /** `stuck_since !== null` */
  isStuck: boolean;
  /** `stage` is building or commercialising AND kind is 'project' (areas never count). */
  isActive: boolean;
  /** `stage` is done / killed / abandoned. */
  isTerminal: boolean;
  /** Whole days since `stage_changed_at`. PRD §8.1 "days-in-stage". */
  daysInStage: number;
  /** Whole days since the later of stage change / next-action edit. */
  daysIdle: number;
  /** Whole days until `stage_target_date`; negative = overdue; null if unset. */
  daysToTarget: number | null;
  /** The reward pinned to this project's Done state, if any. */
  reward: Reward | null;
}

export interface ProjectDetail extends ProjectWithMeta {
  /** Newest first. PRD §8.3 "stage history timeline". */
  events: StageEvent[];
  keyDates: KeyDate[];
}

/** A key date with its countdown pre-computed. PRD §7.2 */
export interface KeyDateWithCountdown extends KeyDate {
  /** Whole days from today; 0 = today; negative = passed. */
  daysAway: number;
  project: Pick<Project, 'id' | 'name' | 'stage'> | null;
}

/** One routine plus its recent check history, for the heat calendar. */
export interface RoutineWithChecks extends Routine {
  /** Keyed by DateKey, value is the count for that date. */
  checksByDate: Record<DateKey, number>;
  /** Whether it is ticked today. */
  doneToday: boolean;
  /** Ticks so far in the current rolling window. */
  windowCount: number;
}

/* ------------------------------------------------------------------ */
/* v2 derived types                                                    */
/* ------------------------------------------------------------------ */

/** The "state the price up front" copy for any move into an active stage. */
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

/** One kind of Focus delta. `computeFocusWeek` always returns all seven. */
export type FocusDeltaType =
  | 'activation'
  | 'overCap'
  | 'stuck'
  | 'abandoned'
  | 'done'
  | 'decisiveKill'
  | 'didIt';

export interface FocusWeekLine {
  type: FocusDeltaType;
  /** Human label, e.g. "Started over cap". */
  label: string;
  /** How many times it applied this week (project-days for overCap, taps for didIt). */
  count: number;
  /** Points per unit from config (didIt is also capped per day). */
  perUnit: number;
  /** Signed points this line contributed. */
  points: number;
}

/** SPEC-V2 §3 — this week's Focus, with the working. */
export interface FocusWeekBreakdown {
  /** 0–100, clamped. */
  score: number;
  /** Unclamped total, for a "why is it 0?" panel. */
  raw: number;
  /** Where the week started (100). */
  base: number;
  /** Monday (SGT) of the week. */
  weekStart: DateKey;
  /** Sunday (SGT) of the week. */
  weekEnd: DateKey;
  /** The day the score is "as of" (today, or weekEnd for a past week). */
  asOf: DateKey;
  /**
   * Daily charges (over cap, stuck) land at the close of each day. This is the
   * last day that has closed and been charged; null on Monday morning.
   */
  chargedThrough: DateKey | null;
  /** One line per delta type, in a fixed order. */
  lines: FocusWeekLine[];
  /** Same numbers keyed by type. */
  deltas: Record<FocusDeltaType, number>;
  /**
   * What will land at tonight's close if nothing changes (still over cap,
   * still stuck). Not part of `score`. Zero for a past week.
   */
  pending: { overCap: number; stuck: number; stuckProjectIds: UUID[]; overBy: number };
  /** Distinct charged days on which the portfolio was over cap. */
  overCapDays: number;
  /** Projects charged the weekly stuck penalty this week. */
  stuckProjectIds: UUID[];
}

/** Up-only counters (SPEC-V2 §3). */
export interface Counters {
  /** Projects moved to Done. */
  finished: number;
  /** Decisive kills — killed after reaching Building or beyond. */
  decisiveKills: number;
  /** Distinct days with at least one Did-it tap. */
  didItDays: number;
  /** Completed weeks in which the portfolio was never over cap at a day's close. */
  weeksUnderCap: number;
}

export interface CountersSummary {
  season: Counters;
  lifetime: Counters;
  /** Day the current season started (SGT), or null if there is no season row. */
  seasonStart: DateKey | null;
}

/** A project as the Today's-move card needs it. */
export interface TodaysMoveProject {
  id: UUID;
  name: string;
  kind: ProjectKind;
  stage: ProjectStage;
  next_action: string;
  stage_target_date: DateKey | null;
  stuck_since: DateKey | null;
  isStuck: boolean;
  daysInStage: number;
  /** Whole days until the target date; negative = overdue; null if unset. */
  daysToTarget: number | null;
  /** Last day with any progress signal (SGT). */
  lastProgressDay: DateKey;
  daysSinceProgress: number;
}

/** Why this project won the card: the first ordering criterion that decided it. */
export type TodaysMoveReason = 'stuck' | 'target' | 'idle' | 'rotation';

/** SPEC-V2 §1 — the one card on the home screen. */
export type TodaysMove =
  | {
      status: 'move';
      project: TodaysMoveProject;
      reason: TodaysMoveReason;
      /** The rest of today's rotation, in order — the client can advance optimistically. */
      upNext: TodaysMoveProject[];
      doneToday: number;
      skippedToday: number;
    }
  | {
      /** Every active project/area has been done or skipped today. */
      status: 'all_done';
      doneToday: number;
      skippedToday: number;
      copy: string;
    }
  | {
      /** Nothing active: offer the top Idea, with the price of starting it. */
      status: 'start_idea';
      project: TodaysMoveProject;
      cost: WipCostPreview;
      copy: string;
    }
  | { status: 'empty'; copy: string };

/** Review banner state for the home screen (SPEC-V2 §4). */
export interface ReviewDue {
  /** The Monday of the week under review. */
  weekStart: DateKey;
  /** True on banner days (Sun/Mon) until that week's review is completed. */
  due: boolean;
  completedAt: Timestamp | null;
}

/** Everything the dashboard needs, in one object. */
export interface DashboardData {
  /** Live Flow over the rolling 7 days (v2: not the snapshot). */
  flow: number;
  /** Live Focus for this week (v2: `focusWeek.score`). */
  focus: number;
  /** 30 days of nightly snapshots, oldest first — sparklines only. */
  snapshots: ScoreSnapshot[];
  routines: RoutineWithChecks[];
  /** Building + Commercialising, kind='project' only. */
  activeProjects: ProjectWithMeta[];
  stuckProjects: ProjectWithMeta[];
  keyDates: KeyDateWithCountdown[];
  rewards: Reward[];
  /** v2: true only while the portfolio is over the soft cap (stuck no longer locks). */
  rewardsLocked: boolean;
  activeCount: number;
  wipLimit: number;

  /* ---- v2 ---- */
  todaysMove: TodaysMove;
  focusWeek: FocusWeekBreakdown;
  counters: CountersSummary;
  reviewDue: ReviewDue;
  season: Season | null;
  /** Non-terminal areas ("Ongoing" strip). */
  areas: ProjectWithMeta[];
}

/* ================================================================== */
/* Supabase `Database` generic                                        */
/* ================================================================== */

type Insertable<Row, Required extends keyof Row, Generated extends keyof Row> = Pick<
  Row,
  Required
> &
  Partial<Omit<Row, Required | Generated>> &
  Partial<Pick<Row, Generated>>;

export interface Database {
  public: {
    Tables: {
      projects: {
        Row: Project;
        Insert: Insertable<Project, 'name' | 'next_action', 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Project>;
        Relationships: [];
      };
      stage_events: {
        Row: StageEvent;
        Insert: Insertable<StageEvent, 'project_id' | 'to_stage', 'id' | 'created_at'>;
        Update: Partial<StageEvent>;
        Relationships: [];
      };
      rewards: {
        Row: Reward;
        Insert: Insertable<Reward, 'name' | 'price', 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Reward>;
        Relationships: [];
      };
      routines: {
        Row: Routine;
        Insert: Insertable<Routine, 'name' | 'cadence', 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Routine>;
        Relationships: [];
      };
      routine_checks: {
        Row: RoutineCheck;
        Insert: Insertable<RoutineCheck, 'routine_id' | 'date', 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<RoutineCheck>;
        Relationships: [];
      };
      key_dates: {
        Row: KeyDate;
        Insert: Insertable<KeyDate, 'name' | 'date', 'id' | 'created_at'>;
        Update: Partial<KeyDate>;
        Relationships: [];
      };
      score_snapshots: {
        Row: ScoreSnapshot;
        Insert: Insertable<ScoreSnapshot, 'date' | 'flow' | 'focus', 'id' | 'created_at'>;
        Update: Partial<ScoreSnapshot>;
        Relationships: [];
      };
      progress_events: {
        Row: ProgressEvent;
        Insert: Insertable<ProgressEvent, 'project_id' | 'kind' | 'day', 'id' | 'created_at'>;
        Update: Partial<ProgressEvent>;
        Relationships: [];
      };
      reviews: {
        Row: Review;
        Insert: Insertable<Review, 'week_start', 'id' | 'created_at'>;
        Update: Partial<Review>;
        Relationships: [];
      };
      seasons: {
        Row: Season;
        Insert: Insertable<Season, never, 'id' | 'started_at'>;
        Update: Partial<Season>;
        Relationships: [];
      };
      daily_moves: {
        Row: DailyMove;
        Insert: Insertable<DailyMove, 'day' | 'project_id' | 'outcome', 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<DailyMove>;
        Relationships: [];
      };
    };
    // Must use the `{ [_ in never]: never }` idiom (what `supabase gen types`
    // emits): `Record<never, never>` does not satisfy postgrest-js's
    // `GenericSchema` constraint and silently degrades every query to `never`.
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: {
      project_stage: ProjectStage;
      reward_status: RewardStatus;
      routine_cadence: RoutineCadence;
    };
    CompositeTypes: { [_ in never]: never };
  };
}
