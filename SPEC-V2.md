# Finish Line v2 — "the loop that answers back"

Date: 2026-10-03. Authoritative over PRD-focus-app.md and SPEC-CHANGES.md where they
conflict. Rationale: docs/HABIT-ANALYSIS.md. In one line: v1 judged Isaac nightly with a
meter he couldn't move; v2 answers every tap today and judges once a week.

Keep from v1: soft cap of 3, kill-is-respectable (+10), penalty-free import, rewards pinned
to a project's Done, dark UI, red only for stuck/forfeit, API through lib/data.

## 1. Home screen = Today's move

The dashboard's first screen is ONE card:

- Project name, its `next_action` in large type, days in stage, target date if any.
- Two buttons: **Did it** and **Not today**.
- Under the card, small: this week's Focus (live), the up-only counters, and the WIP line
  ("2 of 3 active"). Routines, key dates and rewards move to a second scroll section or
  their own tabs — nothing competes above the fold.

Which project is "today's move": among active (Building/Commercialising) projects, pick in
this order — stuck first, then nearest `stage_target_date`, then longest since last progress,
then round-robin so every active project surfaces. **Not today** advances to the next project
(and the skipped one won't reappear until tomorrow). When nothing is active, the card shows the
top Idea with "Start this?" and the cost copy, or "Nothing in flight. Good." if there are none.

**Did it** = a progress event. It immediately: (a) records `progress_events(project_id,
kind='did_it')`, (b) clears `stuck_since` if set, (c) opens a one-line inline prompt
"Next action?" prefilled with the current one (Enter to keep, type to replace — optional,
never blocks), (d) advances to the next project's move if any, (e) bumps the live Focus.

## 2. Progress signals (replaces "edited the next-action text")

A project has *progressed* on a day if any of: stage change; next_action update; a Did-it
tap; a commit on its linked GitHub repo (see §6). `stuck` = no progress signal for 14 days
AND stage is Building/Shipped/Commercialising. Key-date-passed-not-done still flags stuck.
Stuck is cleared by any progress signal, instantly (not nightly).

## 3. Scores

### Focus — weekly, live, recoverable
- Resets to 100 at the start of every ISO week (Monday 00:00 SGT). Clamp 0–100.
- Computed on read from events since the week start (cheap; no snapshot needed to display).
  Nightly snapshot still written for sparklines.
- Deltas (lib/config.ts, all tunable):
  - Activation into Building/Commercialising **that puts the portfolio over cap**: -15.
    At or under cap, starting is free. (v1 charged every start; that punished his strength.)
  - Over cap: -10 per over-cap project per day, accrued daily within the week only.
  - Stuck: -10 per stuck project **per week** (charged once when it becomes/is stuck in the
    week), not per day.
  - Abandoned: -25 (still the worst exit; reward forfeits).
  - Done: +20. Decisive kill (Building+): +10. Did it: +2 (max +10/day across projects) — the
    meter must visibly answer a tap.
- Rewards lock only while over cap. Stuck no longer locks rewards (Sunday review handles it).

### Flow — unchanged formula, but live
Flow is computed on read over the rolling 7 days so a routine tick moves it on the same tap.

### Up-only counters (never decrease, per season and lifetime)
Finished · Killed on purpose · Did-it days · Weeks under cap.

## 4. Sunday review (replaces nightly punishment as the judgment moment)

`/review`, surfaced as a banner on the home card on Sunday and Monday until completed for
that week (`reviews(week_start, completed_at)`). For each active project show: progress days
this week, days in stage, target date, stuck flag, and three buttons — **Keep** (requires a
next action; prefilled), **Kill** (reason, +10), **Done** (+20, reward unlocks). Then a
summary: this week's Focus with its breakdown, counters, and next week starts at 100.
Projects not reviewed stay as they are; the review is a ritual, not a gate.

## 5. Areas vs projects

`projects.kind` = `'project'` (default) | `'area'`. An **area** is an ongoing venture
(Splash Advisory, Soycraft, Life Church) — it can hold a next action and appear in Today's
move rotation, but it is exempt from the cap, from stuck, from activation charges and from
the kanban stages (it shows in its own "Ongoing" strip on the Projects screen). Only
`kind='project'` rows count anywhere in scoring. Convert via Settings or the detail page.

## 6. GitHub as a progress signal (optional)

`projects.github_repo` (text, "owner/name"). The nightly cron (and a "Check now" button)
fetches recent commits for linked repos (GitHub REST; uses `GITHUB_TOKEN` env if set,
otherwise unauthenticated — works for public repos) and writes `progress_events(kind='commit')`
for commit days not already recorded. Degrade silently if the token is missing or rate-limited.

## 7. New season instead of wipe

Settings → "Start a new season": inserts a `seasons(started_at)` row. Counters and the
"season" views start from that date; history stays. Terminal projects (Done/Killed/Abandoned)
are hidden from the board by default once a new season starts; active ones carry over.

## 8. Routines — stop double entry

Routines stay, but: the home card never shows them (they live in a "Routines" section below
the fold and on their tab). Add `POST /api/v1/hooks/workout` guarded by a separate
`WORKOUT_HOOK_TOKEN` that only increments the Workouts routine for today — so daily-app can
tick workouts without ever holding the main API key. Document in API.md.

## 9. Data model additions (migration 0002)

- `projects.kind` text not null default 'project' check in ('project','area')
- `projects.github_repo` text null
- `progress_events(id, project_id fk cascade, kind check in ('did_it','commit','next_action',
  'stage'), day date not null, created_at)` with unique (project_id, kind, day)
- `reviews(id, week_start date unique, completed_at)`
- `seasons(id, started_at timestamptz not null default now(), name text)`
- `daily_moves(day date, project_id, outcome check in ('did_it','skipped'))` unique(day, project_id)
  — powers rotation and "won't reappear until tomorrow".

## 10. Acceptance

1. Open app → one card with a next action and two buttons; tapping Did it changes the Focus
   number on screen before any reload.
2. A stuck project is cleared by a Did-it tap immediately.
3. Starting a project at 2-of-3 active costs 0; at 3-of-3 shows and charges -15.
4. Monday morning Focus reads 100 regardless of last week.
5. Sunday review lists every active project with Keep/Kill/Done and records completion.
6. Areas never affect WIP count or Focus.
7. New season hides last season's terminal projects; counters restart; history intact.
8. Workout hook ticks today's Workouts routine with its own token and nothing else.
