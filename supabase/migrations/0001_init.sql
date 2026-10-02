-- =====================================================================
-- Finish Line — initial schema (PRD §9)
--
-- Single-user app. Isaac is the only human who will ever touch this data,
-- and the app talks to Postgres with the anon key from a Next.js server
-- component / server action. There is no multi-tenant boundary to defend,
-- so RLS is intentionally DISABLED on every table rather than shipping a
-- pile of permissive policies that only pretend to be security.
--
-- >>> If this ever becomes multi-user: enable RLS, add a user_id column to
-- >>> every table, and scope policies to auth.uid(). See ARCHITECTURE.md.
--
-- Idempotent: safe to re-run.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------

do $$ begin
  create type project_stage as enum (
    'idea', 'building', 'shipped', 'commercialising', 'done', 'killed', 'abandoned'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type reward_status as enum ('locked_pending', 'claimable', 'claimed', 'forfeited');
exception when duplicate_object then null; end $$;

do $$ begin
  create type routine_cadence as enum ('daily', 'weekly');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- projects — PRD §9.1
-- ---------------------------------------------------------------------

create table if not exists projects (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null check (length(btrim(name)) > 0),
  -- One-line definition of done (PRD §3.1.1).
  resolution             text,
  stage                  project_stage not null default 'idea',
  -- PRD §3.1.3: a project with no next action cannot be saved. Enforced here
  -- as well as in lib/data/projects.ts so no code path can sneak past it.
  next_action            text not null check (length(btrim(next_action)) > 0),
  -- Target date for the CURRENT stage (PRD §3.1.4).
  stage_target_date      date,
  -- Non-null ⇒ currently Stuck (PRD §3.1.5). Written by the nightly recompute.
  stuck_since            date,
  -- Half of the staleness clock: when the project entered its current stage.
  stage_changed_at       timestamptz not null default now(),
  -- Other half: when next_action was last edited.
  next_action_updated_at timestamptz not null default now(),
  -- Required reason when killed (PRD §3.2.3); optional note when abandoned.
  terminal_reason        text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- PRD §3.2.3: a kill must carry a reason.
  constraint killed_needs_reason
    check (stage <> 'killed' or length(btrim(coalesce(terminal_reason, ''))) > 0),
  -- Terminal projects are never stuck.
  constraint terminal_is_not_stuck
    check (stage not in ('done', 'killed', 'abandoned') or stuck_since is null)
);

create index if not exists projects_stage_idx on projects (stage);
create index if not exists projects_stuck_idx on projects (stuck_since) where stuck_since is not null;

drop trigger if exists projects_set_updated_at on projects;
create trigger projects_set_updated_at
  before update on projects
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- stage_events — PRD §9.2 (immutable audit trail; every score reads this)
-- ---------------------------------------------------------------------

create table if not exists stage_events (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  from_stage project_stage,           -- null for the creation event
  to_stage   project_stage not null,
  note       text,                    -- e.g. the kill reason
  created_at timestamptz not null default now()
);

create index if not exists stage_events_project_idx on stage_events (project_id, created_at desc);
create index if not exists stage_events_created_idx on stage_events (created_at desc);

-- ---------------------------------------------------------------------
-- rewards — PRD §9.3 / §4
-- ---------------------------------------------------------------------

create table if not exists rewards (
  id           uuid primary key default gen_random_uuid(),
  -- Nullable so a reward can exist unassigned in Settings until it is pinned
  -- to a project's Done state. on delete set null keeps forfeited tombstones
  -- around even if the project row is ever removed.
  project_id   uuid references projects (id) on delete set null,
  name         text not null check (length(btrim(name)) > 0),
  price        numeric(10, 2) not null check (price >= 0),
  status       reward_status not null default 'locked_pending',
  claimed_at   timestamptz,
  forfeited_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint claimed_has_timestamp
    check (status <> 'claimed' or claimed_at is not null),
  constraint forfeited_has_timestamp
    check (status <> 'forfeited' or forfeited_at is not null)
);

create index if not exists rewards_project_idx on rewards (project_id);
create index if not exists rewards_status_idx on rewards (status);
-- PRD §4.1: each reward is assigned to a specific project's Done state.
create unique index if not exists rewards_one_per_project_idx
  on rewards (project_id) where project_id is not null;

drop trigger if exists rewards_set_updated_at on rewards;
create trigger rewards_set_updated_at
  before update on rewards
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- routines — PRD §9.4 / §5
-- ---------------------------------------------------------------------

create table if not exists routines (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) > 0),
  cadence       routine_cadence not null,
  -- Times per week. Daily routines: how many of the 7 days must be ticked
  -- (Bible = 7, Dog walk = 5). Weekly routines: total ticks per week.
  weekly_target integer not null default 7 check (weekly_target > 0 and weekly_target <= 70),
  active        boolean not null default true,
  -- The one routine that means "this is a rest day" (PRD §5.2.2). Ticking it
  -- on a date makes that date a sabbath day, which drops out of every other
  -- routine's Flow denominator.
  is_sabbath    boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- At most one sabbath routine.
create unique index if not exists routines_single_sabbath_idx
  on routines ((is_sabbath)) where is_sabbath;
create index if not exists routines_active_idx on routines (active, sort_order);

drop trigger if exists routines_set_updated_at on routines;
create trigger routines_set_updated_at
  before update on routines
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- routine_checks — PRD §9.5 (one row per routine per date)
-- ---------------------------------------------------------------------

create table if not exists routine_checks (
  id         uuid primary key default gen_random_uuid(),
  routine_id uuid not null references routines (id) on delete cascade,
  date       date not null,
  -- 0 = explicitly not done; >0 = done (counters may exceed 1, e.g. two walks).
  count      integer not null default 1 check (count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint routine_checks_one_per_day unique (routine_id, date)
);

create index if not exists routine_checks_date_idx on routine_checks (date desc);

drop trigger if exists routine_checks_set_updated_at on routine_checks;
create trigger routine_checks_set_updated_at
  before update on routine_checks
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- key_dates — PRD §9.6 / §7
-- ---------------------------------------------------------------------

create table if not exists key_dates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  date       date not null,
  -- PRD §7.3: if linked and the date passes with the project not Done,
  -- the project is auto-flagged Stuck by the nightly recompute.
  project_id uuid references projects (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists key_dates_date_idx on key_dates (date);
create index if not exists key_dates_project_idx on key_dates (project_id);

-- ---------------------------------------------------------------------
-- score_snapshots — PRD §9.7 (one row per day, drives the 30-day sparklines)
-- ---------------------------------------------------------------------

create table if not exists score_snapshots (
  id         uuid primary key default gen_random_uuid(),
  date       date not null unique,
  flow       integer not null check (flow between 0 and 100),
  focus      integer not null check (focus between 0 and 100),
  created_at timestamptz not null default now()
);

create index if not exists score_snapshots_date_idx on score_snapshots (date desc);

-- ---------------------------------------------------------------------
-- Row Level Security: OFF, deliberately. See the header comment.
-- ---------------------------------------------------------------------

alter table projects        disable row level security;
alter table stage_events    disable row level security;
alter table rewards         disable row level security;
alter table routines        disable row level security;
alter table routine_checks  disable row level security;
alter table key_dates       disable row level security;
alter table score_snapshots disable row level security;

-- =====================================================================
-- Seed data — acceptance checklist §13.6: the app must be useful on day 1.
-- Guarded so re-running the migration does not duplicate rows.
-- =====================================================================

-- --- Projects (+ their creation stage_event) ---------------------------

insert into projects (name, resolution, stage, next_action, stage_target_date, stage_changed_at, next_action_updated_at)
select
  'AI Command Centre',
  'Paying customers using it, or a public paid offer live.',
  'commercialising',
  'Write the pricing page and pick a launch date.',
  (current_date + 21),
  now() - interval '9 days',
  now() - interval '3 days'
where not exists (select 1 from projects where name = 'AI Command Centre');

insert into stage_events (project_id, from_stage, to_stage, note, created_at)
select p.id, 'shipped'::project_stage, 'commercialising'::project_stage,
       'Built and shipped. Now the last mile.', now() - interval '9 days'
from projects p
where p.name = 'AI Command Centre'
  and not exists (select 1 from stage_events e where e.project_id = p.id);

insert into projects (name, resolution, stage, next_action, stage_target_date, stage_changed_at, next_action_updated_at)
select
  'Lazy AI Course round 2',
  'Round 2 sold and delivered.',
  'building',
  'Lock the round 2 dates and open the waitlist.',
  (current_date + 30),
  now() - interval '5 days',
  now() - interval '2 days'
where not exists (select 1 from projects where name = 'Lazy AI Course round 2');

insert into stage_events (project_id, from_stage, to_stage, note, created_at)
select p.id, 'idea'::project_stage, 'building'::project_stage,
       'Round 1 landed. Round 2 committed.', now() - interval '5 days'
from projects p
where p.name = 'Lazy AI Course round 2'
  and not exists (select 1 from stage_events e where e.project_id = p.id);

-- --- Routines (PRD §5.1 / §5.2) ---------------------------------------

insert into routines (name, cadence, weekly_target, is_sabbath, sort_order)
select v.name, v.cadence::routine_cadence, v.weekly_target, v.is_sabbath, v.sort_order
from (values
  ('Bible / quiet time', 'daily',  7, false, 1),
  ('Dog walk',           'daily',  5, false, 2),
  ('Workouts',           'weekly', 3, false, 3),
  ('Sabbath',            'weekly', 1, true,  4)
) as v(name, cadence, weekly_target, is_sabbath, sort_order)
where not exists (select 1 from routines r where r.name = v.name);

-- --- Rewards (PRD §4.1) -----------------------------------------------

insert into rewards (project_id, name, price, status)
select p.id, 'Watch strap', 300, 'locked_pending'::reward_status
from projects p
where p.name = 'AI Command Centre'
  and not exists (select 1 from rewards r where r.name = 'Watch strap');

insert into rewards (project_id, name, price, status)
select p.id, 'New gloves', 150, 'locked_pending'::reward_status
from projects p
where p.name = 'Lazy AI Course round 2'
  and not exists (select 1 from rewards r where r.name = 'New gloves');

-- --- Key dates (PRD §7) -----------------------------------------------

insert into key_dates (name, date, project_id)
select 'Half-marathon', current_date + 23, null
where not exists (select 1 from key_dates where name = 'Half-marathon');

insert into key_dates (name, date, project_id)
select 'LAC round 2 launch', current_date + 30, p.id
from projects p
where p.name = 'Lazy AI Course round 2'
  and not exists (select 1 from key_dates where name = 'LAC round 2 launch');
