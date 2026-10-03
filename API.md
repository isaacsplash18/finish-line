# Finish Line — REST API (v1)

A small JSON API over the same data layer the app uses (`lib/data/*`). Every
endpoint calls the same functions as the screens' server actions, so API calls
follow the same rules as taps in the UI: the soft WIP cap, the v2 weekly
Focus deltas (SPEC-V2 §3), reward locking and forfeits, the penalty-free
import marker, areas, and stuck detection. The API can't get around any of
them.

- **Base URL:** `https://finish-line-xi.vercel.app/api/v1` (local: `http://localhost:3000/api/v1`)
- **Format:** JSON in, JSON out. Dates are `YYYY-MM-DD` in **Asia/Singapore**;
  "today" means today in SGT.
- **Code:** thin handlers in `app/api/v1/**`, shared helpers in `lib/api/`
  (`auth.ts`, `validation.ts`, `schemas.ts`, `errors.ts`, `handler.ts`,
  `revalidate.ts`).

---

## Auth

Send the API key as a bearer token on every request:

```
Authorization: Bearer <API_KEY>
```

- The key is `API_KEY` in `.env.local`. It's also set on Vercel for
  Production, Preview and Development. Never commit it.
- If the header is missing or wrong, you get `401 {"ok":false,"code":"UNAUTHORIZED",…}`.
  If the server has no `API_KEY` set, every request is rejected.
- **Exception:** `POST /hooks/workout` uses its own `WORKOUT_HOOK_TOKEN`
  instead (see [Workout hook](#post-hooksworkout)). `API_KEY` is not accepted
  there, and the hook token is accepted nowhere else.
- The comparison is constant-time (`timingSafeEqual` in `lib/session.ts`).
- `/api/v1/*` skips the password-gate redirect in `middleware.ts`. The route
  handlers check the bearer token themselves.
- To rotate the key, generate a new one
  (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`),
  update `.env.local`, run `npx vercel@latest env rm API_KEY` and then
  `npx vercel@latest env add API_KEY` for each environment, and redeploy.

The examples below assume:

```bash
export FL=https://finish-line-xi.vercel.app/api/v1
export FL_KEY=$(grep '^API_KEY=' .env.local | cut -d= -f2-)
alias flc='curl -s -H "Authorization: Bearer $FL_KEY" -H "Content-Type: application/json"'
```

---

## Responses and errors

Success:

```json
{ "ok": true, "data": … }
```

Error:

```json
{ "ok": false, "error": "Human-readable message", "code": "VALIDATION", "field": "next_action" }
```

`field` only appears when the error is about one input. Business-rule messages
come straight from `lib/data` and are written in the app's voice.

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `VALIDATION` | Bad JSON, wrong shape, unknown key, invalid UUID/date, or a business rule such as "next action required", "kill needs a reason", or "reward not claimable" |
| 401 | `UNAUTHORIZED` | Bearer token missing or wrong |
| 404 | `NOT_FOUND` | No project, routine, reward or key date with that id |
| 409 | `INVALID_TRANSITION` | Moving, killing or abandoning a Done/Killed/Abandoned project, or erasing a project that has real history |
| 500 | `DATABASE` | Supabase error (the message is passed through) |
| 500 | `INTERNAL` | Any other error. The message is generic and the details are logged on the server |

Request bodies are **strict**. An unknown key, such as a typo or a field the
API doesn't expose like a reward's `status`, returns a 400 instead of being
silently ignored. An empty body counts as `{}`.

**Scores are live (v2).** Focus is this week's score and Flow the rolling 7
days, both computed on read: `GET /focus/week` and `GET /dashboard` reflect a
mutation immediately — no recompute needed. Focus resets to 100 every Monday
00:00 SGT. Event deltas (start over cap −15, done +20, decisive kill +10,
abandon −25, Did it +2 up to +10/day) land at once; daily charges (−10 per
over-cap project per day, −10 once a week per stuck project) land when a day
closes, and `pending` in the Focus breakdown shows what would land tonight.
Areas (`kind: "area"`) never count. Mutation responses still include
`focus.immediateDelta`; `appliesOnNextRecompute` is now always `false`. The
nightly snapshot (`GET /scores`) only feeds the sparklines.

After every mutation the API revalidates the affected screens, the same way
the server actions do, so the PWA shows the change on its next render.

---

## Endpoints

| Method | Path | Data layer |
| --- | --- | --- |
| GET | `/dashboard` | `getDashboardData()` |
| GET | `/wip` | `getWipStatus()` |
| GET | `/projects` | `getProjects()` |
| POST | `/projects` | `createProject()` |
| POST | `/projects/import` | `importProject()` |
| GET | `/projects/:id` | `getProjectOrThrow()` |
| PATCH | `/projects/:id` | `updateProject()` |
| DELETE | `/projects/:id` | `eraseProject()` |
| POST | `/projects/:id/move` | `previewStageMove()` + `moveProjectStage()` |
| POST | `/projects/:id/kill` | `getKillPreview()` + `killProject()` |
| POST | `/projects/:id/abandon` | `abandonProject()` |
| GET | `/routines` | `getRoutinesWithChecks()` |
| POST | `/routines/:id/toggle` | `toggleRoutine()` |
| POST | `/routines/:id/check` | `checkRoutine()` |
| POST | `/routines/:id/increment` | `incrementRoutine()` |
| POST / DELETE | `/sabbath` | `setSabbath()` / `clearSabbath()` |
| GET / POST | `/rewards` | `getRewards()` / `createReward()` |
| PATCH / DELETE | `/rewards/:id` | `updateReward()` / `deleteReward()` |
| POST | `/rewards/:id/claim` | `claimReward()` |
| GET / POST | `/key-dates` | `getKeyDates()` / `createKeyDate()` |
| PATCH / DELETE | `/key-dates/:id` | `updateKeyDate()` / `deleteKeyDate()` |
| GET | `/scores` | `getScoreSnapshots()` |
| POST | `/scores/recompute` | `computeAndSnapshotToday()` |
| GET | `/moves/today` | `getTodaysMove()` |
| POST | `/moves/did-it` | `logProgress(…, 'did_it')` |
| POST | `/moves/skip` | `skipTodaysMove()` |
| GET | `/focus/week` | `getFocusWeek()` |
| GET | `/counters` | `getCounters()` |
| GET | `/review` | `getReviewState()` |
| POST | `/review/complete` | `completeReview()` |
| GET / POST | `/seasons` | `getCurrentSeason()` / `startSeason()` |
| POST | `/github/sync` | `syncGithubProgress()` |
| POST | `/hooks/workout` | `logWorkoutFromHook()` — **own token** |

### Dashboard and WIP

#### `GET /dashboard`

Returns everything the home screen renders, from one parallel batch of
queries:

- v2: `todaysMove`, `focusWeek` (live, with breakdown), `counters`,
  `didItDaysThisWeek` (distinct days Mon → today with a Did-it),
  `reviewDue` (`{ weekStart, due, completedAt }`), `season`, `areas`
- `flow` (live) and `focus` (= `focusWeek.score`), `snapshots` (sparklines)
- `routines`, `keyDates`, `rewards`, `rewardsLocked` (true only while over
  cap), `activeProjects`, `stuckProjects`, `activeCount`, `wipLimit`, `wip`,
  `isOverCap`

If today's score snapshot doesn't exist yet, this call creates it (without
the GitHub sync).

```bash
flc $FL/dashboard | jq '.data | {focus, flow, move: .todaysMove.project.name, label: .wip.label}'
# { "focus": 100, "flow": 71, "move": "AI Command Centre", "label": "3 of 3 active" }
```

#### `GET /wip`

```bash
flc $FL/wip
```
```json
{ "ok": true, "data": {
  "activeCount": 4, "cap": 3, "overBy": 1, "isAtCap": false, "isOverCap": true,
  "dailyBleed": -10, "activeProjectNames": ["AI Command Centre", "…"],
  "label": "4 of 3 active",
  "nextActivation": { "activeCountAfter": 5, "cap": 3, "overBy": 2, "level": "over",
    "copy": "This takes you to 5 of 3 active: -15 Focus now, -20/day while over cap, rewards locked." }
} }
```

### Projects

Stages: `idea`, `building`, `shipped`, `commercialising`, `done`, `killed`,
`abandoned`. Active means Building + Commercialising, and the cap of 3 is
**soft**: you can always go over it, and going over it costs Focus.

`kind` is `project` (default) or `area`. An area is an ongoing venture: it
holds a next action and appears in Today's-move rotation, but never counts
toward WIP, is never stuck, never pays an activation charge and never moves
Focus. `github_repo` (`owner/name`) links a repo whose commits count as
progress.

Project objects are `ProjectWithMeta`: the row (including `kind` and
`github_repo`) plus `isStuck`, `isActive` (false for areas), `isTerminal`,
`daysInStage`, `daysIdle`, `daysToTarget` and `reward`.

#### `GET /projects`

Query parameters:

- `includeTerminal=true` adds Done/Killed/Abandoned, which are excluded by default.
- `stuck=true` returns only Stuck projects.

Results are sorted with Stuck projects first, then by how long they've been idle.

```bash
flc "$FL/projects?includeTerminal=true" | jq '.data[] | {id, name, stage, isStuck}'
```

#### `POST /projects`

Body: `{ name, next_action, resolution?, stage?, stage_target_date?, kind?, github_repo? }`.

- `next_action` is required.
- `stage` defaults to `idea`. It can be `idea`, `building`, `shipped` or
  `commercialising`.
- Creating straight into `building`/`commercialising` is a start: it costs
  −15 **only if it takes you over the cap** (free at or under). The cap never
  blocks it. Areas are always free.
- `costPreview` is the price tag the UI would have shown. It is `null` for
  Idea/Shipped and for areas; for an active stage it is always present, with
  an empty `copy` when the start is free (at or under the cap).

```bash
flc -X POST $FL/projects -d '{"name":"Podcast","next_action":"Record pilot episode"}'
```
```json
{ "ok": true, "data": { "project": { "id": "…", "name": "Podcast", "stage": "idea", "…": "…" }, "costPreview": null } }
```
Returns status 201.

#### `POST /projects/import`

Imports a project that was already running before you started using the app.
**No −15 entry charge.** The stage event is marked `[import]`.

Body: `{ name, nextAction, stage, startedAt, resolution?, stageTargetDate? }`.

- `stage` must be `building`, `shipped` or `commercialising`.
- `startedAt` sets the display clock only. Scoring always uses today's real
  timestamp.
- `impact.copy` describes the over-cap bleed, which starts tomorrow. It is
  `null` when the import keeps you under the cap.

```bash
flc -X POST $FL/projects/import -d '{"name":"Client portal","nextAction":"Ship invoices page","stage":"building","startedAt":"2026-07-01"}'
```
Returns status 201 with `{ project, impact }`.

#### `GET /projects/:id`

Returns the project plus `events` (stage history, newest first), `keyDates`
and `reward`.

```bash
flc $FL/projects/$ID | jq '.data | {stage, events: [.events[] | {from_stage, to_stage, note}]}'
```

#### `PATCH /projects/:id`

Body: `{ name?, resolution?, next_action?, stage_target_date?, kind?, github_repo? }`.

- Editing `next_action` is a progress signal: it resets the 14-day clock and
  clears Stuck.
- An empty `next_action` returns 400.
- `kind`: `"project"` or `"area"`. Converting to an area clears Stuck and
  re-runs the reward gate (the WIP count may change). Done/Killed/Abandoned
  projects can't be converted (409).
- `github_repo`: `"owner/name"` or any github.com URL form (stored normalised);
  `null` or `""` unlinks. Anything else is 400.

```bash
flc -X PATCH $FL/projects/$ID -d '{"next_action":"Email Karen the draft"}'
flc -X PATCH $FL/projects/$ID -d '{"kind":"area"}'
flc -X PATCH $FL/projects/$ID -d '{"github_repo":"https://github.com/isaacsplash18/tally"}'
```

#### `POST /projects/:id/move`

Body: `{ toStage, note?, stageTargetDate? }`. `toStage` can be `idea`,
`building`, `shipped`, `commercialising` or `done`. To end a project, use
`/kill` or `/abandon` so a reason is recorded.

The cap never blocks the move. The response includes the cost preview that
applied, computed by `previewStageMove` just before the move, plus a summary
of what the move does to Focus:

```bash
flc -X POST $FL/projects/$ID/move -d '{"toStage":"building","note":"Starting for real"}'
```
```json
{ "ok": true, "data": {
  "project": { "stage": "building", "…": "…" },
  "fromStage": "idea", "toStage": "building", "changed": true,
  "costPreview": { "activeCountAfter": 5, "cap": 3, "overBy": 2, "level": "over",
    "copy": "This takes you to 5 of 3 active: -15 Focus now, -20/day while over cap, rewards locked.",
    "isActivation": true, "killBonusCopy": null },
  "focus": { "immediateDelta": -15, "dailyBleedWhileOverCap": -20, "overCap": true, "appliesOnNextRecompute": false }
} }
```

`costPreview.isActivation` is true only for a start (Idea → Building /
Commercialising). Every other move is never an activation charge: Shipped →
Building/Commercialising (re-entering the active set) carries copy only if it
lands over the cap — `"No activation charge, but this takes you to 4 of 3
active: -10/day while over cap, rewards locked."` — and a move that keeps the
active count the same or lowers it (Building ↔ Commercialising, → Shipped)
has empty `copy`, even while over cap.

`immediateDelta` is:

- −15 for a start (Idea → Building/Commercialising) that lands **over** the
  cap; 0 at or under the cap
- +20 for Done (the linked reward becomes claimable if the reward gate is open)
- 0 otherwise, and always 0 for an area

Moving a terminal project returns 409.

#### `POST /projects/:id/kill`

Body: `{ reason }`. The reason is required; a missing or blank one returns 400.

Killing a project that reached Building or beyond is a **decisive kill (+10 Focus)**.
Killing an Idea doesn't change Focus.

```bash
flc -X POST $FL/projects/$ID/kill -d '{"reason":"Market is not there"}'
```
```json
{ "ok": true, "data": { "project": { "stage": "killed", "terminal_reason": "Market is not there", "…": "…" },
  "fromStage": "building", "killBonus": "Decisive kill: +10 Focus",
  "focus": { "immediateDelta": 10, "appliesOnNextRecompute": false } } }
```

#### `POST /projects/:id/abandon`

Body: `{ reason? }`. This is the worst way to end a project: **−25 Focus**,
and the linked reward is **permanently forfeited** and shown as a tombstone.
Use `/kill` instead where you can.

```bash
flc -X POST $FL/projects/$ID/abandon -d '{"reason":"Lost interest"}'
# data: { project, fromStage, forfeitedReward, focus: { immediateDelta: -25, … } }
```

#### `DELETE /projects/:id` — erase a data-entry mistake

This **hard-deletes** the row. Its stage events go with it (cascade), and any
reward or key date linked to it is unlinked (`project_id` set to null). Because
the events are gone, any Focus effect they had disappears on the next recompute.

**This doesn't end a project.** Done, Killed and Abandoned are how a project
ends. Erase is only for duplicates, typos and test rows, so it's guarded and
returns **409** if:

- the project has a **claimed** reward, or
- any of its stage events was created **before today (SGT)**, unless it was
  written by an import.

That means only fresh or accidental entries can be erased.

```bash
flc -X DELETE $FL/projects/$ID
# { "ok": true, "data": { "id": "…", "name": "ZZ duplicate", "erasedEvents": 1 } }

flc -X DELETE $FL/projects/$SEED_ID
# 409 { "ok": false, "code": "INVALID_TRANSITION",
#       "error": "\"AI Command Centre\" has stage history from before today. Erase is only for fresh mistakes — finish it, kill it, or abandon it instead." }
```

### Routines

There is one check row per routine per date. `date` defaults to today (SGT).
Daily routines count the days ticked; weekly routines (such as Workouts) add
up the counts.

#### `GET /routines`

Query parameters:

- `days` defaults to 28.
- `includeInactive=true` includes inactive routines.

Each routine comes back with `checksByDate`, `doneToday` and `windowCount`.

```bash
flc "$FL/routines?days=7" | jq '.data[] | {id, name, cadence, weekly_target, doneToday}'
```

#### `POST /routines/:id/toggle`

Body: `{ date? }`. Toggles the routine on or off for that date, the same as
the one-tap checklist.

```bash
flc -X POST $FL/routines/$ROUTINE_ID/toggle -d '{}'
# { "ok": true, "data": { "routine_id": "…", "date": "2026-10-02", "count": 1, … } }
```

#### `POST /routines/:id/check`

Body: `{ date?, count }`. Sets the exact count for that date, so it's
idempotent. A count of 0 unticks it. Use this when another app pushes totals,
for example a strength app syncing workouts.

```bash
flc -X POST $FL/routines/$WORKOUTS_ID/check -d '{"date":"2026-10-02","count":1}'
```

#### `POST /routines/:id/increment`

Body: `{ date?, by? }`. `by` defaults to 1 and can be negative. The count
never drops below 0.

```bash
flc -X POST $FL/routines/$WORKOUTS_ID/increment -d '{"by":1}'
```

#### `POST /sabbath` and `DELETE /sabbath`

Body: `{ date }` (required).

- `POST` marks the date as a rest day and clears any other sabbath in the same
  Sun–Sat week.
- `DELETE` unmarks it.

Sabbath days are left out of every other routine's Flow denominator.

```bash
flc -X POST   $FL/sabbath -d '{"date":"2026-10-04"}'
flc -X DELETE $FL/sabbath -d '{"date":"2026-10-04"}'
```

### Rewards

The status cycle is `locked_pending` → `claimable` → `claimed`, or →
`forfeited` if the project is abandoned. You can't set `status` through the
API:

- To claim a reward, use `/claim`.
- A reward is only forfeited when its project is abandoned.
- The reward gate locks every unclaimed reward **only while the portfolio is
  over the cap** (v2). Stuck projects no longer lock rewards.

#### `GET /rewards`

Returns every reward, newest first, including forfeited tombstones.

```bash
flc $FL/rewards | jq '.data[] | {id, name, price, status, project_id}'
```

#### `POST /rewards`

Body: `{ name, price, project_id? }`. Returns 201. The reward gate runs right
after the reward is created.

```bash
flc -X POST $FL/rewards -d '{"name":"New headphones","price":250,"project_id":"'$ID'"}'
```

#### `PATCH /rewards/:id`

Body: `{ name?, price?, project_id? }`. Set `project_id` to `null` to unassign
the reward.

```bash
flc -X PATCH $FL/rewards/$REWARD_ID -d '{"price":200}'
```

#### `DELETE /rewards/:id`

Only works on **unassigned** rewards, the same rule as Settings. An assigned
reward returns 400, so unassign it first.

```bash
flc -X DELETE $FL/rewards/$REWARD_ID
```

#### `POST /rewards/:id/claim`

Only a `claimable` reward can be claimed. Anything else returns 400 with the
reason (locked or forfeited).

```bash
flc -X POST $FL/rewards/$REWARD_ID/claim
```

### Key dates

When a linked key date passes and its project isn't Done, that project becomes
Stuck.

#### `GET /key-dates`

Query parameters: `limit` and `upcomingOnly=true`. Results are sorted soonest
first and include `daysAway` and the linked `project`.

```bash
flc "$FL/key-dates?limit=5&upcomingOnly=true"
```

#### `POST /key-dates`

Body: `{ name, date, project_id? }`. Returns 201.

```bash
flc -X POST $FL/key-dates -d '{"name":"Demo day","date":"2026-11-15","project_id":"'$ID'"}'
```

#### `PATCH /key-dates/:id` and `DELETE /key-dates/:id`

PATCH takes `{ name?, date?, project_id? }`.

```bash
flc -X PATCH  $FL/key-dates/$KD_ID -d '{"date":"2026-11-20"}'
flc -X DELETE $FL/key-dates/$KD_ID
```

### Scores

#### `GET /scores`

Query parameter: `days` (default 30). Returns the daily `{date, flow, focus}`
snapshots, oldest first.

```bash
flc "$FL/scores?days=7" | jq '.data[] | [.date, .flow, .focus]'
```

#### `POST /scores/recompute`

Runs the same job as the nightly cron and the Settings button, in this order:

1. GitHub commit sync
2. stuck flags
3. reward gate
4. Flow and this week's Focus
5. upsert today's snapshot

It's idempotent. In v2 it first syncs GitHub commits. It returns
`{ snapshot, flow, focus, stuck, rewards, github }`, where `focus` is this
week's breakdown (same shape as `GET /focus/week`) and `github` the sync
result.

```bash
flc -X POST $FL/scores/recompute | jq '.data | {snapshot, focus: .focus.score, flow: .flow.score}'
```

### Today's move (v2)

The home screen's one card (SPEC-V2 §1). Rotation = active projects plus
non-terminal areas, minus anything already done or skipped today. Order:
stuck → nearest `stage_target_date` → longest since last progress →
round-robin (least recently on the card).

#### `GET /moves/today`

Returns a `TodaysMove`, one of:

- `{ status: "move", project, reason, upNext, doneToday, skippedToday }` —
  `reason` is `stuck | target | idle | rotation`; `project`/`upNext` items
  carry `next_action`, `daysInStage`, `daysToTarget`, `lastProgressDay`,
  `daysSinceProgress`, `isStuck`, `kind`
- `{ status: "all_done", doneToday, skippedToday, copy }`
- `{ status: "start_idea", project, cost, copy: "Start this?" }` — nothing
  active; `cost` is the activation price tag
- `{ status: "empty", copy: "Nothing in flight. Good." }`

```bash
flc $FL/moves/today | jq '.data | {status, name: .project.name, next: .project.next_action, reason}'
```

#### `POST /moves/did-it`

Body: `{ projectId, nextAction? }`. Records a Did-it for today (idempotent per
project per day), removes the project from today's rotation, clears Stuck, and
replaces the next action if `nextAction` is non-blank and different (omitted,
`null`, blank or unchanged keeps the current one). Works for areas (no Focus
for them). Terminal projects return 409.

Returns `{ project, kind, day, unstuck, nextActionUpdated, focusWeek, todaysMove }`
— the live Focus and the next card in one response.

```bash
flc -X POST $FL/moves/did-it -d '{"projectId":"'$ID'","nextAction":"Send the invoice"}' \
  | jq '.data | {unstuck, focus: .focusWeek.score, next: .todaysMove.project.name}'
```

#### `POST /moves/skip`

Body: `{ projectId }`. "Not today": no penalty, the project won't reappear
until tomorrow. A skip never overwrites an earlier Did-it. Returns
`{ skipped: { projectId, day, outcome }, todaysMove }`.

### Focus, counters (v2)

#### `GET /focus/week`

This week's live Focus (`FocusWeekBreakdown`):

```json
{ "score": 85, "raw": 85, "base": 100, "weekStart": "2026-10-05", "weekEnd": "2026-10-11",
  "asOf": "2026-10-06", "chargedThrough": "2026-10-05",
  "lines": [
    { "type": "activation",   "label": "Started over cap",        "count": 1, "perUnit": -15, "points": -15 },
    { "type": "overCap",      "label": "Over cap (project-days)", "count": 0, "perUnit": -10, "points": 0 },
    { "type": "stuck",        "label": "Stuck this week",         "count": 0, "perUnit": -10, "points": 0 },
    { "type": "abandoned",    "label": "Abandoned",               "count": 0, "perUnit": -25, "points": 0 },
    { "type": "done",         "label": "Finished",                "count": 0, "perUnit": 20,  "points": 0 },
    { "type": "decisiveKill", "label": "Killed on purpose",       "count": 0, "perUnit": 10,  "points": 0 },
    { "type": "didIt",        "label": "Did it",                  "count": 0, "perUnit": 2,   "points": 0 } ],
  "deltas": { "activation": -15, "…": 0 },
  "pending": { "overCap": -10, "stuck": 0, "stuckProjectIds": [], "overBy": 1 },
  "overCapDays": 0, "stuckProjectIds": [] }
```

`chargedThrough` is the last closed day (null on Monday morning). `pending` is
what lands at tonight's close if nothing changes; it is not in `score`.

#### `GET /counters`

Up-only counters: `{ season, lifetime, seasonStart }`, each counter set being
`{ finished, decisiveKills, didItDays, weeksUnderCap }`. Weeks under cap only
counts completed weeks. Did-it days include areas; everything else is
projects only.

### Sunday review (v2)

#### `GET /review`

Query: `weekStart?` (a Monday, `YYYY-MM-DD`; default = the week under review
today: on Sunday the week ending today, otherwise the week just ended).
Returns `{ weekStart, weekEnd, review, completedAt, due, projects, areas,
focusWeek, counters, nextWeekStart, nextWeekStartsAt }`. Each `projects[]` row
is `{ project, progressDays, progressDayKeys, daysInStage, targetDate,
isStuck }` for every active (Building/Commercialising) **and Shipped**
project (`kind = 'project'`), stuck first. Keep / Kill / Done use the existing
`PATCH /projects/:id`, `/kill` and `/move` endpoints.

#### `POST /review/complete`

Body: `{ weekStart? }` (same default; must be a Monday, else 400). Upserts
`reviews(week_start, completed_at = now)`, which hides the Sun/Mon banner.

### Seasons (v2)

#### `GET /seasons`

The current season (`{ id, started_at, name }`) or `null`.

#### `POST /seasons`

Body: `{ name? }` (default "Season N"). Starts a new season now: season
counters restart and last season's Done/Killed/Abandoned projects drop off
the board by default. Nothing is deleted. Returns 201.

### GitHub (v2)

#### `POST /github/sync`

"Check now": for each non-terminal project/area with a `github_repo`, fetch
the last 7 days of commits and record one `progress_events(kind='commit')`
per commit day (SGT). Uses the server's `GITHUB_TOKEN` if set, otherwise
unauthenticated (public repos, 60 requests/hour). Never fails because of
GitHub: each repo reports `status` (`ok | not_found | rate_limited |
unauthorized | error`). Runs nightly too.

```bash
flc -X POST $FL/github/sync | jq '.data | {authenticated, inserted, repos: [.repos[] | {repo, status, commitDays}]}'
```

### Workout hook (v2)

#### `POST /hooks/workout`

Adds one to **today's** Workouts routine (the active routine named
"Workouts", `config.hooks.workoutRoutineName`) — and can do nothing else.

- **Auth:** `Authorization: Bearer <WORKOUT_HOOK_TOKEN>` — a separate token
  from `.env.local` / Vercel env, compared in constant time. `API_KEY` is
  **not** accepted; a missing/wrong token (or no `WORKOUT_HOOK_TOKEN` on the
  server) is 401.
- **Body:** ignored. The caller can't choose the routine, date or count.
- **CORS:** `OPTIONS` preflight answered; `Access-Control-Allow-Origin: *`
  (the token rides in the header, never in cookies), so the static daily-app
  page can call it from the browser.
- Returns `{ routine: { id, name }, date, count }`. 404 if there is no active
  Workouts routine.

This is the only credential the public daily-app should ever hold. The worst
case if it leaks is an inflated workout count; rotate it like `API_KEY`.

```bash
curl -s -X POST -H "Authorization: Bearer $WORKOUT_HOOK_TOKEN" $FL/hooks/workout
```

---

## Common recipes

### Mark today's workout from an iOS Shortcut

Prefer the narrow hook (`POST /hooks/workout` with `WORKOUT_HOOK_TOKEN`) for
anything that only ticks workouts. The general route below needs `API_KEY`.
Use Shortcuts → **Get Contents of URL** with these settings:

- **URL:** `https://finish-line-xi.vercel.app/api/v1/routines/<WORKOUTS_ID>/increment`
- **Method:** POST
- **Headers:** `Authorization: Bearer <API_KEY>` and `Content-Type: application/json`
- **Request body (JSON):** `{}`

Look up `<WORKOUTS_ID>` once with `flc $FL/routines | jq '.data[] | {id,name}'`.
Equivalent curl:

```bash
flc -X POST $FL/routines/$WORKOUTS_ID/increment -d '{}'
```

If a strength app pushes the day's total instead, use the idempotent setter so
retries can't double-count:

```bash
flc -X POST $FL/routines/$WORKOUTS_ID/check -d "{\"date\":\"$(TZ=Asia/Singapore date +%F)\",\"count\":1}"
```

### Erase an accidental duplicate

```bash
flc "$FL/projects?includeTerminal=true" | jq '.data[] | select(.name=="Podcast") | {id, stage, created_at}'
flc -X DELETE $FL/projects/$DUPLICATE_ID          # ok if it was created today
flc -X POST $FL/scores/recompute | jq '.data.snapshot'
```

If the response is 409, the project has history from before today, so it's
not an accident. End it with `/kill` and a reason. That's the real exit, and
from Building or beyond it earns +10.

### Nightly recompute from elsewhere

Vercel Cron already runs `/api/cron` at 16:00 UTC (00:00 SGT). To trigger the
same job from another scheduler, or to make sure the numbers are up to date
after a batch of API writes:

```bash
curl -s -X POST -H "Authorization: Bearer $FL_KEY" https://finish-line-xi.vercel.app/api/v1/scores/recompute \
  | jq '.data.snapshot'
```

---

## Tests

`lib/api/auth.test.ts` covers a missing, wrong and correct token, plus the
fail-closed case when `API_KEY` is unset, and the workout hook token (its own
token only, the main key rejected, fail-closed when unset). `lib/api/errors.test.ts` covers the
DomainError → HTTP mapping and checks that unknown errors don't leak details.
Run them with `npm test`.
