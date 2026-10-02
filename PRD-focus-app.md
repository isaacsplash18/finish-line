# PRD: Focus (working name: "Finish Line")

## 1. What this is

A single-user app for Isaac whose entire purpose is to make him finish what he starts. It does 3 jobs:

1. Track every project through defined stages to a resolution, with hard limits on how many can be active.
2. Enforce a reward/punish economy where finishing earns a real-world purchase and stalling or starting shiny new projects costs something the app can actually enforce.
3. Track weekly and daily routines (workouts, bible/quiet time, dog walks, sabbath) and key dates, rolled up into a daily Flow score and Focus score.

Reference points: take the low-friction daily check-off and streak calendar from Beaver Habits (github.com/daya0576/beaverhabits). Take the earn/lose economy from Habitica (github.com/HabitRPG/habitica) but none of the RPG skin. Keep the tone adult and slightly brutal, not cute.

Decision already made: this is a separate app from the strength trainer app. Workouts appear here only as a weekly counter Isaac ticks manually (v1). A later version may read counts from a shared Supabase.

## 2. The core problem being designed against

Isaac starts projects, ships v1, then abandons the boring last mile (commercialise, relaunch, follow through). Examples: AI Command Centre built but never commercialised; Lazy AI Course launched but round 2 never scheduled. The app must make the last mile the path of least resistance and make starting something new visibly expensive.

## 3. Projects module

### 3.1 Project object

1. Name, one-line definition of done ("resolution"), created date.
2. Stage: Idea → Building → Shipped → Commercialising → Done. Also terminal states: Killed (deliberate, no penalty if done through the kill flow) and Abandoned (penalty).
3. Next action: 1 required free-text field, always present. A project with no next action cannot be saved.
4. Target date for the current stage.
5. Stale detection: no stage change and no next-action update for 14 days flags the project Stuck (visual red state + Focus score penalty, see 6).

### 3.2 Hard rules the app enforces

1. WIP limit: maximum 3 Active projects (Active = Building or Commercialising). This is a hard cap in the UI.
2. Starting a new project when at the cap requires either finishing one or explicitly killing one first. The new-project button is disabled at cap, with copy that says exactly that.
3. Kill flow: killing a project requires typing a 1-line reason. Deliberate kills are respectable and cost nothing. This keeps the punishment aimed at drift, not at good decisions.
4. Every project must end in Done or Killed. There is no archive-and-forget.

### 3.3 Backlog

Unlimited Idea-stage projects allowed. Ideas cost nothing. The cap only bites when something moves to Building. This gives the shiny-object impulse a harmless outlet: write it down, don't build it.

## 4. Reward / punish economy

1. Reward list: Isaac pre-defines rewards with a price tag (e.g. "new gloves - $150", "watch strap - $300") and assigns each to a specific project's Done state.
2. Finish a project → its reward unlocks. The app shows it as claimable and logs when claimed.
3. Punishments the app can enforce itself:
   1. Project goes Stuck (14 days idle) → all unclaimed rewards lock until the stuck project moves stage or is killed.
   2. Project marked Abandoned → its reward is permanently forfeited (deleted, with a tombstone shown on the dashboard: "Forfeited: $300 watch strap").
   3. Starting a 4th active project is simply impossible (see 3.2), which is the strongest anti-shiny mechanic available.
4. Optional stake (v1.1): attach a dollar stake to a project; abandonment generates a "pay Rachell / give away" IOU entry. Not enforceable by software, so it is secondary.

## 5. Routines module

### 5.1 Daily

1. Bible / quiet time - daily checkbox.
2. Dog walk - checkbox, weekly target 5 of 7.

### 5.2 Weekly

1. Workouts - manual counter with a weekly target (target editable, e.g. 3). v1 is manual tick; v1.1 may read from the strength app's Supabase.
2. Sabbath - exactly 1 of Sat/Sun marked as rest. Marking sabbath greys out routine requirements for that day (sabbath is never penalised).

### 5.3 Mechanics

1. Check-off UI is 1 tap per item from the home screen, Beaver-Habits style, with a rolling 4-week calendar heat view per routine.
2. Routines are user-editable (add/remove/retarget) in settings.

## 6. Scores

Both scores are 0 to 100, recomputed daily at midnight SGT and shown as the 2 hero numbers on the dashboard with 30-day sparklines.

1. Flow score = routine adherence over a rolling 7 days. Each routine contributes its completion rate against target, equally weighted. Sabbath days excluded from denominators.
2. Focus score = starts at 100 each rolling 30-day window, then:
   1. minus 15 per new project moved into Building during the window
   2. minus 10 per currently Stuck project (recurring while stuck)
   3. minus 25 per Abandoned project in the window
   4. plus 20 per project moved to Done (capped at 100)
3. Tuning values live in a single config file so Isaac can rebalance without code archaeology.

## 7. Key dates

1. Simple list: name + date (e.g. "Half-marathon", "LAC round 2 launch", client due dates).
2. Dashboard shows the next 5 as countdown chips ("Half-marathon in 23 days").
3. A key date can optionally link to a project; if linked and the date passes with the project not Done, the project is auto-flagged Stuck.

## 8. Screens (5 total)

1. Dashboard: Flow and Focus scores with sparklines, today's routine checklist (tappable), active projects with stage + next action + days-in-stage, next 5 key dates, reward status strip (claimable / locked / forfeited).
2. Projects: kanban by stage (Idea | Building | Shipped | Commercialising | Done/Killed), WIP counter "2 of 3 active" always visible, stuck projects pulse red.
3. Project detail: stage history timeline, next action edit, target date, linked reward, kill button.
4. Routines: 4-week heat calendars per routine, edit targets.
5. Settings: rewards CRUD, score tuning link, key dates CRUD, routine CRUD.

## 9. Data model (Supabase Postgres, single user)

1. `projects` (id, name, resolution, stage, next_action, stage_target_date, stuck_since, created_at, terminal_reason).
2. `stage_events` (id, project_id, from_stage, to_stage, created_at).
3. `rewards` (id, project_id, name, price, status: locked_pending/claimable/claimed/forfeited).
4. `routines` (id, name, cadence: daily/weekly, weekly_target, active).
5. `routine_checks` (id, routine_id, date, count).
6. `key_dates` (id, name, date, project_id nullable).
7. `score_snapshots` (id, date, flow, focus) - written by the nightly recompute (Supabase cron / edge function, or compute-on-read with a stored daily snapshot for the sparkline).

## 10. Stack and deployment

1. Next.js 14 (App Router) + Tailwind. Mobile-first, must also be pleasant on desktop since project reviews happen at a desk.
2. Supabase (DB, auth via magic link, cron for nightly score snapshot and stuck detection). Vercel hosting.
3. PWA with manifest and service worker for home-screen install.

## 11. Branding

1. App name shown as "Finish Line" (or builder proposes 1 better name about finishing, not starting).
2. Generate a real app icon and favicon: flat geometric mark, a bold chequered-flag or an arrow crossing a line, on a solid near-black background with 1 accent colour (orange). Provide 512, 192 and 32 px PNGs plus favicon.ico wired into the manifest and HTML head. No default favicon.
3. Visual style: dark UI, big numbers, red used only for Stuck and forfeits so it retains meaning.

## 12. Non-goals

1. No time tracking, no pomodoro.
2. No task manager beneath the single next-action field. 1 next action per project is the whole point.
3. No team features, single user.
4. No calendar sync in v1.

## 13. Acceptance checklist

1. Cannot create a 4th Active project through any UI path.
2. A project idle 14 days shows Stuck the next morning and locks unclaimed rewards.
3. Abandoning a project permanently forfeits its reward and the tombstone shows on the dashboard.
4. Daily routine check-off is 1 tap; sabbath day removes that day from Flow maths.
5. Flow and Focus recompute nightly and sparklines render 30 days.
6. Seed data on first run: projects "AI Command Centre" (stage Commercialising) and "Lazy AI Course round 2" (stage Building) so the app is useful on day 1.
7. Installs to home screen with the custom icon.
