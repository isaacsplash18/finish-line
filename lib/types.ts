/**
 * Finish Line — the whole data model, in one file.
 *
 * Mirrors `supabase/migrations/0001_init.sql` exactly. If you change one,
 * change the other. PRD §9.
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
  /** `stage` is building or commercialising. */
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

/** Everything the dashboard needs, in one object. */
export interface DashboardData {
  flow: number;
  focus: number;
  snapshots: ScoreSnapshot[];
  routines: RoutineWithChecks[];
  activeProjects: ProjectWithMeta[];
  stuckProjects: ProjectWithMeta[];
  keyDates: KeyDateWithCountdown[];
  rewards: Reward[];
  /** True when any project is Stuck ⇒ unclaimed rewards are locked (PRD §4.3.1). */
  rewardsLocked: boolean;
  activeCount: number;
  wipLimit: number;
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
