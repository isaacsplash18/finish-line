-- =====================================================================
-- Finish Line v2 — "the loop that answers back" (SPEC-V2.md §9)
--
-- ADDITIVE ONLY. Nothing here drops, renames or rewrites an existing
-- column, and every statement is guarded so the file is safe to re-run.
-- The v1 app keeps working against this schema: the new columns have
-- defaults and the new tables are only read by v2 code.
--
--   projects.kind          'project' | 'area' (areas are exempt from WIP,
--                          stuck, activation charges and every score)
--   projects.github_repo   "owner/name" — commits count as progress
--   progress_events        one row per (project, kind, day) progress signal
--   reviews                Sunday review completion, one row per ISO week
--   seasons                "start a new season" instead of a wipe
--   daily_moves            Today's-move outcomes (did it / not today)
--
-- Backfill:
--   * one 'Season 1' row (started at the earliest project/stage event, so
--     nothing is hidden and no counter restarts) if no season exists yet
--   * progress_events(kind='stage') for every existing stage_events row,
--     bucketed to its Asia/Singapore day, so stuck detection has history
--
-- RLS stays DISABLED, exactly like 0001 (single user, see its header).
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- projects.kind / projects.github_repo
-- ---------------------------------------------------------------------

alter table projects add column if not exists kind text not null default 'project';

do $$ begin
  alter table projects
    add constraint projects_kind_check check (kind in ('project', 'area'));
exception when duplicate_object then null; end $$;

alter table projects add column if not exists github_repo text;

do $$ begin
  -- "owner/name", nothing else (lib/github.ts normalises URLs before writing).
  alter table projects
    add constraint projects_github_repo_format
    check (github_repo is null or github_repo ~ '^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9._-]+$');
exception when duplicate_object then null; end $$;

create index if not exists projects_kind_idx on projects (kind);
create index if not exists projects_github_repo_idx on projects (github_repo) where github_repo is not null;

comment on column projects.kind is
  'v2: ''project'' (default, finishable, scored) or ''area'' (ongoing venture: in Today''s-move rotation, but exempt from the WIP cap, stuck, activation charges and every score).';
comment on column projects.github_repo is
  'v2: optional GitHub "owner/name". The nightly sync writes progress_events(kind=''commit'') for each commit day.';

-- ---------------------------------------------------------------------
-- progress_events — every progress signal, one per project/kind/day
-- ---------------------------------------------------------------------

create table if not exists progress_events (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  kind       text not null check (kind in ('did_it', 'commit', 'next_action', 'stage')),
  -- The Asia/Singapore calendar day the progress happened on.
  day        date not null,
  created_at timestamptz not null default now(),

  constraint progress_events_one_per_kind_per_day unique (project_id, kind, day)
);

create index if not exists progress_events_day_idx on progress_events (day desc);
create index if not exists progress_events_project_day_idx on progress_events (project_id, day desc);
create index if not exists progress_events_did_it_idx on progress_events (day) where kind = 'did_it';

comment on table progress_events is
  'v2 §2: a project has progressed on a day if it has any row here for that day. Stuck = no progress for 14 days (Building/Shipped/Commercialising). Unique per (project, kind, day), so writes are idempotent.';
comment on column progress_events.kind is
  'did_it = Today''s-move tap; commit = GitHub commit on the linked repo; next_action = next action edited; stage = stage change.';
comment on column progress_events.day is
  'Calendar day in Asia/Singapore (config.timezone).';

-- ---------------------------------------------------------------------
-- reviews — Sunday review completion, one row per ISO week
-- ---------------------------------------------------------------------

create table if not exists reviews (
  id           uuid primary key default gen_random_uuid(),
  -- Monday (ISO week start, SGT) of the week being reviewed.
  week_start   date not null unique check (extract(isodow from week_start) = 1),
  completed_at timestamptz,
  created_at   timestamptz not null default now()
);

comment on table reviews is
  'v2 §4: the weekly review ritual. The home banner shows on Sunday and Monday until the row for that week has completed_at set. Not a gate.';

-- ---------------------------------------------------------------------
-- seasons — "start a new season" instead of a wipe
-- ---------------------------------------------------------------------

create table if not exists seasons (
  id         uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  name       text
);

create index if not exists seasons_started_idx on seasons (started_at desc);

comment on table seasons is
  'v2 §7: the latest row is the current season. Season counters count from started_at; terminal projects from before it are hidden from the board. History is never deleted.';

-- ---------------------------------------------------------------------
-- daily_moves — Today's-move outcomes
-- ---------------------------------------------------------------------

create table if not exists daily_moves (
  id         uuid primary key default gen_random_uuid(),
  day        date not null,
  project_id uuid not null references projects (id) on delete cascade,
  outcome    text not null check (outcome in ('did_it', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint daily_moves_one_per_project_per_day unique (day, project_id)
);

create index if not exists daily_moves_day_idx on daily_moves (day desc);
create index if not exists daily_moves_project_idx on daily_moves (project_id, day desc);

drop trigger if exists daily_moves_set_updated_at on daily_moves;
create trigger daily_moves_set_updated_at
  before update on daily_moves
  for each row execute function set_updated_at();

comment on table daily_moves is
  'v2 §1: what happened to each project on the Today''s-move card that day. Any row for (today, project) removes it from today''s rotation; history drives the round-robin tiebreak.';

-- ---------------------------------------------------------------------
-- Row Level Security: OFF, deliberately (same reasoning as 0001).
-- ---------------------------------------------------------------------

alter table progress_events disable row level security;
alter table reviews         disable row level security;
alter table seasons         disable row level security;
alter table daily_moves     disable row level security;

-- Supabase normally grants these through default privileges; be explicit so
-- the anon-key server client can always reach the new tables.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant select, insert, update, delete on progress_events, reviews, seasons, daily_moves to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete on progress_events, reviews, seasons, daily_moves to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on progress_events, reviews, seasons, daily_moves to service_role;
  end if;
end $$;

-- =====================================================================
-- Backfill
-- =====================================================================

-- One season if there is none yet. It starts at the beginning of the app's
-- history (earliest project / stage event), NOT now(): a season start hides
-- terminal projects that ended before it and restarts the season counters,
-- and merely applying this migration must do neither. "Start a new season"
-- in Settings is what does that, deliberately.
insert into seasons (name, started_at)
select 'Season 1',
       coalesce(
         least((select min(created_at) from projects), (select min(created_at) from stage_events)),
         now()
       )
where not exists (select 1 from seasons);

-- Every historical stage change is a progress signal on its SGT day.
insert into progress_events (project_id, kind, day, created_at)
select distinct on (e.project_id, (e.created_at at time zone 'Asia/Singapore')::date)
  e.project_id,
  'stage',
  (e.created_at at time zone 'Asia/Singapore')::date,
  e.created_at
from stage_events e
order by e.project_id, (e.created_at at time zone 'Asia/Singapore')::date, e.created_at desc
on conflict (project_id, kind, day) do nothing;

-- Ask PostgREST to pick up the new tables/columns straight away.
notify pgrst, 'reload schema';
