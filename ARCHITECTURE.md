# Finish Line — architecture & agent contract

Foundation and screens are built (v1 + v2). This document is the contract
between the data/scoring foundation and the screens.

Authoritative specs, in precedence order:

1. `SPEC-V2.md` — Finish Line v2 (weekly Focus, Today's move, areas, review,
   seasons). Overrides everything below where they conflict. See §11.
2. `SPEC-CHANGES.md` — overrides PRD §3.2, §4.3.3, §6.2, §13.1
3. `PRD-focus-app.md`
4. This document

---

## 1. Stack

| Thing | Choice |
| --- | --- |
| Framework | Next.js 16.3 (App Router, Turbopack), React 19 |
| Language | TypeScript, `strict` |
| Styling | Tailwind v4 (`@theme` tokens in `app/globals.css`) |
| DB | Supabase Postgres, `@supabase/ssr` |
| Tests | Vitest (`npm test`) — pure domain logic only |
| Hosting | Vercel; nightly cron in `vercel.json` |
| Package manager | npm |

No `src/` directory. Import alias is `@/*` → repo root.

---

## 2. File map

```
app/
  layout.tsx                    root layout, metadata, viewport, SW registration
  globals.css                   ALL design tokens live here
  manifest.ts                   PWA manifest (icons: /icons/icon-{192,512}.png)
  service-worker-registrar.tsx  'use client', registers /sw.js in prod
  page.tsx                      Dashboard          (+ actions.ts)
  projects/page.tsx             Projects kanban    (+ projects/actions.ts)
  projects/[id]/page.tsx        Project detail
  review/page.tsx               Weekly review (v2)  (+ review/actions.ts)
  routines/page.tsx             Routines           (+ routines/actions.ts)
  settings/page.tsx             Settings           (+ settings/actions.ts)
  api/cron/route.ts             GET/POST nightly recompute
  api/v1/**/route.ts            REST API (bearer API_KEY) — see API.md

components/
  index.ts                      ← import everything from '@/components'
  app/AppShell.tsx              dark frame: sidebar (lg+) / bottom tabs (mobile)
  app/Nav.tsx                   Sidebar, BottomTabs, FinishLineMark
  app/nav-items.tsx             NAV_ITEMS, isNavItemActive
  ScoreHero.tsx  Sparkline.tsx  HeatCalendar.tsx
  StageBadge.tsx CountdownChip.tsx RewardCard.tsx WipCounter.tsx
  ui/Button.tsx  ui/Input.tsx (Input/Textarea/Select)  ui/Modal.tsx
  ui/Card.tsx    (Card, CardHeader, SectionTitle, EmptyState)

lib/
  config.ts                     EVERY tunable number. Single source of truth.
  types.ts                      whole data model + Supabase `Database` generic
  dates.ts                      DateKey helpers, all in Asia/Singapore
  cn.ts                         classname joiner
  scores.ts                     PURE v2 engine: Focus week, Flow, stuck, Today's move,
                                counters, review week, cost-preview copy
  scores.test.ts                v2 engine tests
  github.ts (+ .test.ts)        PURE GitHub helpers (repo normalising, commit days)
  supabase/env.ts               env reading, SupabaseConfigError, isSupabaseConfigured
  supabase/server.ts            getSupabaseServerClient()  (server only)
  supabase/client.ts            getSupabaseBrowserClient() ('use client')
  api/                          REST API helpers: auth, validation, schemas, errors, handler, revalidate
  data/                         server-side data access — see §5
    index.ts errors.ts projects.ts rewards.ts routines.ts
    key-dates.ts scores.ts dashboard.ts
    progress-events.ts moves.ts reviews.ts seasons.ts github.ts   (v2)

supabase/migrations/0001_init.sql   schema + seed
supabase/migrations/0002_v2.sql     v2: projects.kind/github_repo, progress_events,
                                    reviews, seasons, daily_moves (+ backfill)
public/sw.js  public/offline.html
public/icons/                       icon-192.png / icon-512.png / icon-32.png / icon.svg
app/favicon.ico                     App Router favicon convention → /favicon.ico
```

---

## 3. Setup

```bash
npm install
cp .env.example .env.local     # fill in from Supabase → Project Settings → API
npm run dev
```

Then run `supabase/migrations/0001_init.sql` against the project (Supabase SQL
editor, or `supabase db push`). It is idempotent and seeds:

- projects **AI Command Centre** (commercialising) and **Lazy AI Course round 2**
  (building), each with a next action and a `stage_events` row
- routines **Bible / quiet time** (daily, 7), **Dog walk** (daily, 5),
  **Workouts** (weekly, 3), **Sabbath** (weekly, 1, `is_sabbath`)
- rewards **$300 Watch strap**, **$150 New gloves**
- key dates **Half-marathon** (+23d), **LAC round 2 launch** (+30d, linked)

**RLS is disabled on every table.** Single user, anon key, no tenancy boundary.
Permissive policies would be security theatre. If this ever goes multi-user:
add `user_id` everywhere, enable RLS, scope to `auth.uid()`.

The build works without env vars — Supabase clients throw lazily
(`SupabaseConfigError`), never at import time. Call `isSupabaseConfigured()` if
you want to render a "connect Supabase" empty state.

---

## 4. The rules the app enforces

Read these before writing a single screen.

### 4.1 The WIP cap is SOFT (SPEC-CHANGES §1)

3 Active = Building + Commercialising. Going over is **always allowed**.
`createProject` and `moveProjectStage` never throw on the cap. There is no
`WipLimitError` — it was removed.

**Never disable a control because of the cap.** Show the price instead:

```ts
const wip = await getWipStatus();
// wip.label            "3 of 3 active"
// wip.isAtCap          → accent orange
// wip.isOverCap        → AMBER (not red)
// wip.dailyBleed       -10
// wip.nextActivation.copy
//   "This takes you to 4 of 3 active: -15 Focus now, -10/day while over cap, rewards locked."
```

Per-move: `await previewStageMove(id, 'building')` returns the same shape plus
`isActivation` and `killBonusCopy`. Only a start (Idea → active) can carry the
−15; Shipped → Commercialising says "No activation charge" and names the
bleed only if it lands over cap; moves that don't add an active project have
empty copy.

### 4.2 Next action is required

`createProject` and `updateProject` reject an empty `next_action`
(`ValidationError`), and so does a CHECK constraint. Editing `next_action`
resets the 14-day staleness clock and clears `stuck_since`.

### 4.3 Kill needs a reason; killing pays

`killProject(id, reason)` — reason required. Killing from Building or beyond is
a **decisive kill: +10 Focus**. Killing an Idea is Focus-neutral. Show
`getKillPreview(id).bonusCopy` in the confirmation.

### 4.4 Abandon is the worst outcome

`abandonProject(id, reason?)` — −25 Focus and the linked reward is
**permanently forfeited** with a dashboard tombstone.

### 4.5 Terminal is terminal

Done / Killed / Abandoned cannot move again — `InvalidTransitionError`.

### 4.6 Stuck (v2 — SPEC-V2 §2)

A project is Stuck when either:

- no **progress signal** for 14 days (Building / Shipped / Commercialising
  only — parked Ideas are free). A progress signal is any `progress_events`
  row (Did-it tap, commit on the linked repo, next-action edit, stage change)
  or the `stage_changed_at` / `next_action_updated_at` clocks on the row; or
- a linked key date has passed, the project is not terminal, and there has
  been no progress signal since that date (any non-terminal stage).

Areas are never stuck. Any progress signal clears Stuck **instantly**
(`logProgress`, `updateProject`, `moveProjectStage` clear the flag
themselves); `recomputeStuckFlags()` (nightly) sets it, back-dated to the day
it actually went stale, using the pure `stuckSince()`.

### 4.7 Reward gate (v2)

Unclaimed rewards are locked **only while the portfolio is over cap**
(SPEC-V2 §3; areas never count). Stuck no longer locks rewards.
`applyRewardLockingRule()` runs after every stage change / kind change and in
the nightly recompute. `claimReward` throws unless status is `claimable`.

---

## 5. Data layer — `@/lib/data`

All server-only. Import in server components, server actions and route handlers.
**Do not fetch from client components.** Mutations go through server actions you
define in your own route folder, e.g. `app/projects/actions.ts` with
`'use server'`, calling these and then `revalidatePath(...)`.

### Projects — `lib/data/projects.ts`

```ts
isActiveStage(stage: ProjectStage): boolean
isTerminalStage(stage: ProjectStage): boolean
toProjectWithMeta(project: Project, reward?: Reward | null, asOf?: DateKey): ProjectWithMeta

getProjects(options?: {
  stages?: readonly ProjectStage[];
  includeTerminal?: boolean;   // default true
  onlyStuck?: boolean;
}): Promise<ProjectWithMeta[]>                 // sorted stuck-first, then most idle
getActiveProjects(): Promise<ProjectWithMeta[]>
getActiveProjectCount(): Promise<number>
getProject(id: UUID): Promise<ProjectDetail | null>   // + events[] + keyDates[] + reward
getProjectOrThrow(id: UUID): Promise<ProjectDetail>
getStageEvents(sinceDate?: DateKey): Promise<StageEvent[]>

getWipStatus(): Promise<WipStatus>
previewStageMove(id: UUID, toStage: ProjectStage): Promise<StageMovePreview>
  // = WipCostPreview & { isActivation, killBonusCopy } — via describeStageMoveCost
getKillPreview(id: UUID): Promise<{ project: Project; bonusCopy: string | null }>

createProject(input: CreateProjectInput): Promise<ProjectWithMeta>
updateProject(id: UUID, input: UpdateProjectInput): Promise<ProjectWithMeta>
moveProjectStage(id: UUID, toStage: ProjectStage, options?: {
  note?: string;
  stageTargetDate?: DateKey | null;
  terminalReason?: string;
}): Promise<ProjectWithMeta>
killProject(id: UUID, reason: string): Promise<ProjectWithMeta>
abandonProject(id: UUID, reason?: string): Promise<ProjectWithMeta>
eraseProject(id: UUID): Promise<EraseProjectResult>   // hard delete of a FRESH mistake only;
                                                      // 409-style InvalidTransitionError if it has
                                                      // a claimed reward or pre-today history

recomputeStuckFlags(asOf?: DateKey): Promise<StuckRecomputeResult>   // v2 rule, §4.6

// v2
isActiveProject(project): boolean                     // active stage AND kind='project'
setProjectKind(id: UUID, kind: ProjectKind): Promise<ProjectWithMeta>        // 'project' | 'area'
setProjectRepo(id: UUID, repo: string | null): Promise<ProjectWithMeta>      // "owner/name" or URL
getStageEvents(sinceDate?: DateKey): Promise<StageEvent[]>                   // paged past 1000 rows
getAllStageEvents(): Promise<StageEvent[]>                                   // React.cache'd
```

`ProjectWithMeta` = the row plus `isStuck`, `isActive`, `isTerminal`,
`daysInStage`, `daysIdle`, `daysToTarget`, `reward`. In v2 `isActive` and
`isStuck` are always false for areas, and `kind` / `github_repo` are filled
in (`'project'` / `null`) for rows read before migration 0002.
`GetProjectsOptions` gained `kinds?: ProjectKind[]` and
`seasonStartedAt?: Timestamp` (hide terminal projects that ended before the
season — the board default once a new season starts).

### Rewards — `lib/data/rewards.ts`

```ts
getRewards(): Promise<Reward[]>                        // includes forfeited tombstones
getReward(id: UUID): Promise<Reward | null>
createReward(input: CreateRewardInput): Promise<Reward>
updateReward(id: UUID, input: UpdateRewardInput): Promise<Reward>
deleteReward(id: UUID): Promise<void>
claimReward(id: UUID): Promise<Reward>                 // throws unless claimable
forfeitReward(id: UUID): Promise<Reward>
applyRewardLockingRule(): Promise<RewardLockResult>    // { locked, hasStuckProject, isOverCap, … }
computeRewardGate(projects): { locked, … }             // pure; v2: locked === isOverCap
```

### Routines — `lib/data/routines.ts`

```ts
getRoutines(includeInactive?: boolean): Promise<Routine[]>
getRoutine(id: UUID): Promise<Routine | null>
getSabbathRoutine(): Promise<Routine | null>
getRoutineChecks(from: DateKey, to: DateKey): Promise<RoutineCheck[]>
getRoutinesWithChecks(options?: { days?: number; asOf?: DateKey; includeInactive?: boolean }):
  Promise<RoutineWithChecks[]>                          // → HeatCalendar.checksByDate
getSabbathDays(from: DateKey, to: DateKey): Promise<DateKey[]>

createRoutine(input: CreateRoutineInput): Promise<Routine>
updateRoutine(id: UUID, input: UpdateRoutineInput): Promise<Routine>
deleteRoutine(id: UUID, options?: { hard?: boolean }): Promise<void>   // default = deactivate

checkRoutine(routineId: UUID, date?: DateKey, count?: number): Promise<RoutineCheck>
toggleRoutine(routineId: UUID, date?: DateKey): Promise<RoutineCheck>  // the 1-tap affordance
incrementRoutine(routineId: UUID, date?: DateKey, by?: number): Promise<RoutineCheck>
setSabbath(date?: DateKey): Promise<RoutineCheck>
clearSabbath(date?: DateKey): Promise<RoutineCheck | null>

// v2 — POST /api/v1/hooks/workout
getWorkoutRoutine(): Promise<Routine | null>           // active routine named config.hooks.workoutRoutineName
logWorkoutFromHook(): Promise<{ routine, check }>      // +1 on TODAY only
```

One row per routine per date (DB unique constraint). `setSabbath` clears any
other sabbath mark in the same Sun–Sat week ("exactly 1 of Sat/Sun").

### Key dates — `lib/data/key-dates.ts`

```ts
getKeyDates(options?: { upcomingOnly?: boolean; limit?: number }): Promise<KeyDateWithCountdown[]>
getUpcomingKeyDates(limit?: number): Promise<KeyDateWithCountdown[]>   // default 5
getKeyDate(id: UUID): Promise<KeyDate | null>
createKeyDate(input: CreateKeyDateInput): Promise<KeyDate>
updateKeyDate(id: UUID, input: UpdateKeyDateInput): Promise<KeyDate>
deleteKeyDate(id: UUID): Promise<void>
```

### Scores — `lib/data/scores.ts`

```ts
getFocusWeek(now?: Date): Promise<FocusWeekBreakdown>          // v2: live, this week
getCounters(now?: Date): Promise<CountersSummary>              // v2: up-only, season + lifetime
getFlow(asOf?: DateKey): Promise<FlowScoreBreakdown>           // v2: live, rolling 7 days
focusWeekFromRows(rows, weekStart, now?): FocusWeekBreakdown   // pure assembly (dashboard reuses)
countersFromRows(rows, now?): CountersSummary                  // pure assembly
getScoreSnapshots(days?: number, asOf?: DateKey): Promise<ScoreSnapshot[]>  // oldest first, 30
getTodaySnapshot(asOf?: DateKey): Promise<ScoreSnapshot | null>
computeAndSnapshotToday(asOf?: DateKey, options?: { syncGithub?: boolean }): Promise<RecomputeResult>
ensureTodaySnapshot(asOf?: DateKey): Promise<ScoreSnapshot>   // lazy fallback (no GitHub)
```

`computeAndSnapshotToday()` does, in order: sync GitHub commits → recompute
stuck flags → apply the reward gate → compute live Flow + this week's Focus →
upsert today's snapshot (which now only feeds the sparklines). Idempotent.
Called by `GET /api/cron` (Vercel cron, 16:00 UTC = midnight SGT) and lazily
by `getDashboardData()` (with `syncGithub: false`). `RecomputeResult.focus` is
now a `FocusWeekBreakdown`, plus `github: GithubSyncResult | null`.

### Today's move — `lib/data/moves.ts` (v2)

```ts
getTodaysMove(asOf?: DateKey): Promise<TodaysMove>
logProgress(projectId: UUID, kind?: ProgressKind /* 'did_it' */, options?: {
  nextAction?: string | null;   // blank/unchanged ⇒ keep
  day?: DateKey;
}): Promise<LogProgressResult>  // { project, kind, day, unstuck, nextActionUpdated }
skipTodaysMove(projectId: UUID, day?: DateKey): Promise<SkipResult>  // never downgrades a Did-it
```

`logProgress` writes `progress_events`, upserts `daily_moves(outcome='did_it')`
(for `did_it`), clears `stuck_since`, and optionally replaces `next_action` —
all in one parallel batch after the load.

### Progress events — `lib/data/progress-events.ts` (v2, leaf module)

```ts
recordProgress(projectId, kind, day?, { bestEffort? }): Promise<boolean>   // idempotent per day
fetchProgressEventsSince(from) / getProgressEventsSince(from)              // uncached / cached
fetchDidItEvents() / getDidItEvents()
fetchDailyMovesSince(from) / getDailyMovesSince(from)
progressLookbackStart(asOf?) / rotationLookbackStart(asOf?)
```

`moveProjectStage`, `createProject`, `importProject` and `updateProject`
(next action) write progress with `bestEffort: true` — a failure is logged,
never thrown, because the row's clocks already carry the same signal.

### Review — `lib/data/reviews.ts` (v2)

```ts
getReviewState(weekStart?: DateKey): Promise<ReviewState>   // default: reviewWeekFor(today);
                                                             // projects = active + Shipped (kind='project')
getReviewDue(asOf?: DateKey): Promise<ReviewDue>
completeReview(weekStart?: DateKey): Promise<Review>         // weekStart must be a Monday
fetchReview(weekStart: DateKey): Promise<Review | null>
```

### Seasons — `lib/data/seasons.ts` (v2)

```ts
getCurrentSeason(): Promise<Season | null>    // cached; fetchCurrentSeason() uncached
startSeason(name?: string | null): Promise<Season>   // default "Season N"
```

### GitHub — `lib/data/github.ts` (v2)

```ts
syncGithubProgress(options?: { recomputeStuck?: boolean; now?: Date }): Promise<GithubSyncResult>
```

Never throws. Fetches 7 days of commits per linked repo (`GITHUB_TOKEN`
optional), writes one `progress_events(kind='commit')` per SGT commit day, and
recomputes stuck flags if anything new landed.

### Dashboard — `lib/data/dashboard.ts`

```ts
getDashboardData(asOf?: DateKey): Promise<DashboardPayload>
```

One call, **one parallel batch of queries**, for the whole home screen. v2
fields: `todaysMove`, `focusWeek` (with breakdown), `counters`,
`didItDaysThisWeek`, `reviewDue`, `season`, `areas`. Kept: `flow` (now live), `focus` (= `focusWeek.score`),
`snapshots`, `routines`, `activeProjects`, `stuckProjects`, `keyDates`,
`rewards`, `rewardsLocked` (over cap only), `activeCount`, `wipLimit`, `wip`,
`isOverCap`. v2 tables are read with `unwrapOptional`, so a database without
migration 0002 still renders (empty v2 sections) instead of 500ing.

### Query helpers — `lib/data/errors.ts`

`fetchAllRows(page, context, { optional })` pages past PostgREST's 1000-row
cap; `unwrapOptional(result, context, fallback)` and `isMissingSchemaError`
degrade reads of not-yet-migrated tables.

### Errors — `lib/data/errors.ts`

`DomainError` with `code`: `VALIDATION` | `NOT_FOUND` | `INVALID_TRANSITION` |
`DATABASE`. Subclasses: `ValidationError` (has `.field`), `NotFoundError`,
`InvalidTransitionError`, `DatabaseError`. Use `isDomainError(e)` and render
`e.message` verbatim — the copy is already in the app's voice. Anything else is
a bug; let it bubble.

Server-action pattern:

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { killProject, isDomainError } from '@/lib/data';

export async function killProjectAction(id: string, reason: string) {
  try {
    await killProject(id, reason);
    revalidatePath('/projects');
    revalidatePath(`/projects/${id}`);
    revalidatePath('/');
    return { ok: true as const };
  } catch (error) {
    if (isDomainError(error)) return { ok: false as const, error: error.message };
    throw error;
  }
}
```

---

## 6. Scores — `lib/scores.ts` (pure) + `lib/config.ts` (tunables)

Never re-implement this maths in a screen. v2 signatures (see §11 for the
model):

```ts
weekStartSgt(date?: Date | string, cfg?): DateKey
computeFocusWeek(input: FocusWeekInput, weekStart?: DateKey, now?: Date | string, cfg?): FocusWeekBreakdown
computeFlow(input: FlowScoreInput, cfg?): FlowScoreBreakdown        // = v1 explainFlowScore
isStuck(project, progressEvents, keyDates, now?, cfg?): boolean
stuckSince(project, progressEvents, keyDates, now?, cfg?): DateKey | null
pickTodaysMove(projects, progressEvents, dailyMoves, today?, cfg?): TodaysMove
computeCounters(events: CountersInput, seasonStart, now?, cfg?): CountersSummary
reviewWeekFor(today?, cfg?): DateKey
reviewDueFor(today, completedAt, cfg?): ReviewDue
isVisibleInSeason(project, seasonStartedAt, cfg?): boolean
countActiveProjects(projects, cfg?): number          // areas excluded
rewardGate(projects, cfg?): RewardGate               // locked === over cap
projectKindOf(project) / isArea(project)             // missing kind ⇒ 'project'
countOverCapProjectDays(events, window, cfg?, areaIds?)
describeActivationCost(activeCountAfter, { isNewBuild }, cfg?): WipCostPreview
describeStageMoveCost(fromStage, toStage, activeCountBefore, cfg?): WipCostPreview & { isActivation }
  // non-activation moves: "No activation charge, but…" only if they add an
  // active project over the cap; otherwise empty copy
describeImportImpact(activeCountAfter, cfg?): WipCostPreview
describeKillBonus(stage: ProjectStage, cfg?): string | null
```

`computeFlowScore` / `explainFlowScore` are kept as aliases. The v1
`computeFocusScore` / `explainFocusScore` (rolling 30 days) are gone.

> The v1 description below (rolling 30-day Focus, recurring stuck charges, −15
> per new build) is **historical**. §11 is the live model.

**Flow** (rolling 7 days). Each active routine contributes
`clamp(actual / target, 0, 1)`, all weighted equally, mean × 100.
Targets are pro-rated by non-sabbath days: one rest day scales every target by
6/7. Daily routines count *days ticked*; weekly routines sum *counts*. Ticks on
a sabbath day still count towards the numerator — sabbath only comes out of
denominators. The sabbath routine is never pro-rated against itself.

**Focus** (rolling 30 days), starting at 100:

| Delta | Config key |
| --- | --- |
| −15 per new project into Building (from Idea / creation only) | `focus.newBuildingPenalty` |
| −10 per currently-Stuck project, recurring every 7 days stuck, max 4 charges | `focus.stuckPenalty`, `stuckPenaltyRecurrenceDays`, `maxStuckRecurrences` |
| −25 per Abandoned | `focus.abandonedPenalty` |
| +20 per Done | `focus.doneBonus` |
| **−10 per Active project beyond cap, per day over cap** | `focus.overCapPenaltyPerProjectPerDay`, `maxOverCapProjectDaysCharged` |
| **+10 per kill from Building or beyond** | `focus.decisiveKillBonus`, `killBonusStages` |

Clamped 0–100.

**Over-cap days are derived, not stored.** `countOverCapProjectDays()` replays
`stage_events` day by day to reconstruct how many projects were Active on each
day of the window. Chosen over a persisted daily condition snapshot because the
event log is already the source of truth for every other delta, it back-fills
correctly when the cron misses a night, and correcting the log corrects history.
The cost is O(window × events), which is nothing at this scale.

Economy sanity check (tested): start a shiny object then kill it early =
−15 + 10 = **−5**. Let it bleed over cap = **−10/day**. Abandon it = **−25 plus a
forfeited reward**. Killing early is always the cheapest exit.

Rebalancing is a `lib/config.ts` edit. Do not hard-code numbers in screens —
read them from `config` so Settings can display them.

---

## 7. Components — `@/components`

All presentational: props in, markup out. No fetching, no Supabase.

| Component | Key props |
| --- | --- |
| `AppShell` | `title?`, `subtitle?`, `action?`, `bleed?`, `children` — wrap every page |
| `ScoreHero` | `label`, `value`, `history?: (number\|null)[]`, `delta?`, `caption?`, `tone: 'accent' \| 'positive'` |
| `Sparkline` | `values: (number\|null)[]` (oldest→newest, nulls are gaps), `min/max` (0–100), `stroke`, `fill` |
| `HeatCalendar` | `checksByDate`, `weeks?` (4), `asOf?`, `sabbathDays?`, `onToggleDate?`, `tone?` — `'use client'` |
| `StageBadge` | `stage`, `stuck?`, `size?` — `stuck` overrides to the red "Stuck" pill |
| `CountdownChip` | `name`, `daysAway`, `projectName?`, `overdue?` |
| `RewardCard` | `reward`, `projectName?`, `lockReason?`, `action?` — handles all 4 statuses incl. the forfeit tombstone |
| `WipCounter` | `activeCount`, `cap`, `dailyBleed?` — under/at/over states |
| `Button` | `variant: primary \| secondary \| ghost \| warn \| danger`, `size`, `block`, `loading`, `icon` |
| `Input` / `Textarea` / `Select` | `label?`, `hint?`, `error?` + native props |
| `Modal` | `open`, `onClose`, `title?`, `description?`, `footer?`, `tone?` — bottom sheet on mobile |
| `Card` / `CardHeader` / `SectionTitle` / `EmptyState` | `tone: default \| accent \| overCap \| stuck` |

Nav is five tabs — Today, Projects, Review, Routines, Settings. Project detail is
nested under `/projects/[id]` and gets no tab. Edit `components/app/nav-items.tsx`
if that changes.

---

## 8. Styling

Tokens are defined once, in `app/globals.css` under `@theme`. Use the semantic
utility names (`bg-surface`, `text-muted`, `border-line`, `text-accent`), never
raw `zinc-800` etc.

```
bg / surface / surface-2 / surface-3   near-black surfaces
line / line-strong                     borders
text / muted / faint                   type
accent / accent-hover / accent-dim / accent-wash / accent-ink   #f97316 orange
warn / warn-wash                       #f5b301 amber
danger / danger-dim / danger-wash      #ef4444 red
positive / positive-wash               #10b981 emerald
```

### Colour discipline — the one rule that matters

> **Red means Stuck or Forfeited. Nothing else may be red.**

Not delete buttons, not validation errors, not destructive confirmations. If red
is everywhere it stops meaning anything, and the whole punishment economy is
built on it meaning something.

- **Amber** = over the soft WIP cap ("you are paying for this"). Also used for
  form validation, deliberately.
- **Orange** = brand, primary actions, active nav, at-cap.
- **Emerald** = Done, claimable, streaks.
- **Zinc** = everything else.

The only `Button variant="danger"` in the app should be Abandon.

Other conventions: mobile-first (`AppShell` handles the tab-bar offset), big
numbers get `.tabular` for tabular figures, stuck cards get `.pulse-stuck`
(honours `prefers-reduced-motion`).

---

## 9. Deviations from the PRD

| # | Deviation | Why |
| --- | --- | --- |
| 1 | `projects.stage_changed_at` + `next_action_updated_at` columns added | PRD §9.1 lists neither, but §3.1.5 needs both halves of the staleness clock. Deriving from `stage_events` every night would be a full scan. |
| 2 | `routines.is_sabbath` + `sort_order` columns added | PRD §5.2.2 needs a way to say which routine means "rest day" without matching on the name string. |
| 3 | `stage_events.note` column added | Carries the kill reason into the timeline (PRD §8.3). |
| 4 | `rewards.claimed_at` / `forfeited_at` added | PRD §4.2 "logs when claimed"; the tombstone wants a date. |
| 5 | Idea-stage projects are exempt from *idle* stuck detection | PRD §3.3 makes ideas explicitly free. Key-date-triggered stuck (§7.3) still applies to them. Configurable via `config.projects.staleStages`. |
| 6 | "−15 per new project moved into Building" counts only transitions from Idea / creation | Coming back from Shipped to fix something is not starting a shiny object. |
| 7 | "−10 per stuck project (recurring)" implemented as 1 charge + 1 per full 7 days stuck, capped at 4 | PRD says "recurring" without a period. Both period and cap are config keys. |
| 8 | Killing a project leaves its reward `locked_pending` rather than forfeiting it | PRD only forfeits on Abandon. Settings should let Isaac re-pin the orphaned reward. |
| 9 | Rewards are one-per-project (unique index), `project_id` nullable | PRD §4.1 assigns each reward to a specific project; nullable lets one exist unassigned in Settings first. |
| 10 | Auth not implemented | PRD §10.2 mentions magic link, but §12.3 is single-user and RLS is off. Adding auth would be ceremony over a door with no lock behind it. Add it only if the app is ever exposed publicly. |

---

## 10. Build status

- [x] Dashboard (PRD §8.1) — `app/page.tsx`
- [x] Projects kanban (PRD §8.2 + SPEC-CHANGES §4) — `app/projects/page.tsx`
- [x] Project detail (PRD §8.3) — `app/projects/[id]/page.tsx`
- [x] Routines (PRD §8.4) — `app/routines/page.tsx`
- [x] Settings (PRD §8.5) — `app/settings/page.tsx`
- [x] v2 home (Today's move), `/review`, areas strip, seasons, GitHub link,
      workout hook — migration `0002_v2.sql` must be applied before the
      v2 writes work (see `docs/V2-LIVE-CHECKLIST.md`)
- [x] App icon + favicon — `public/icons/*`, `app/favicon.ico`
- [x] Scaffolding marker `components/app/AgentTodo.tsx` deleted

Quality gate: `npm run lint`, `npm test` and `npm run build` must all pass.

---

## 11. v2 — "the loop that answers back" (SPEC-V2.md)

Rationale: `docs/HABIT-ANALYSIS.md`. v1 judged nightly with a meter Isaac
couldn't move; v2 answers every tap today and judges once a week.

### Data model (migration `0002_v2.sql`, additive)

| Addition | Purpose |
| --- | --- |
| `projects.kind` `'project'\|'area'` | Areas (ongoing ventures) sit in Today's-move rotation but are exempt from WIP, stuck, activation charges, the kanban and every score. |
| `projects.github_repo` | `owner/name`; commits become progress. |
| `progress_events(project_id, kind, day)` unique | `did_it` / `commit` / `next_action` / `stage`. Backfilled with `stage` rows from `stage_events`. |
| `daily_moves(day, project_id, outcome)` unique | `did_it` / `skipped` — drives "won't reappear until tomorrow" and round-robin. |
| `reviews(week_start, completed_at)` | Sunday review completion. |
| `seasons(started_at, name)` | Latest row = current season. Backfilled with "Season 1" starting at the earliest project/stage event (so applying the migration hides nothing and restarts no counter). |

Until the migration is applied, reads of the new tables degrade to empty
(`unwrapOptional`), `kind` defaults to `'project'`, and progress writes from
stage moves are best-effort — v1 behaviour is preserved. Did-it / skip /
review / season *writes* need the migration.

### Scores

**Focus — weekly, live, recoverable.** `computeFocusWeek` starts at 100 every
Monday 00:00 SGT and replays this week's events on read:

| Delta | When it lands | Config key |
| --- | --- | --- |
| −15 activation (from Idea/creation into Building/Commercialising) **only if it puts the portfolio over cap** | immediately | `focus.activationOverCapPenalty`, `activationFromStages` |
| −10 per over-cap project per day | at each day's close, this week only | `focus.overCapPenaltyPerProjectPerDay` |
| −10 per stuck project, **once per week** | at the first day's close it is stuck | `focus.stuckPenaltyPerWeek` |
| −25 abandoned | immediately | `focus.abandonedPenalty` |
| +20 done · +10 decisive kill | immediately | `focus.doneBonus`, `decisiveKillBonus` |
| +2 per Did-it, max +10/day | immediately | `focus.didItBonus`, `didItDailyCap` |

Daily charges land at a day's close, so Monday morning always reads 100 and
acting before midnight avoids the charge; `pending` reports what would land
tonight. The breakdown has one line per delta type with counts. Clamped 0–100
(`raw` keeps the unclamped total). Only `kind='project'` rows count.

**Flow** — v1 formula, computed live over the rolling 7 days.

**Up-only counters** (`computeCounters`) — Finished · Killed on purpose
(decisive kills) · Did-it days · Weeks under cap (completed weeks only, so the
number never drops), per season and lifetime.

**Snapshots** are still written nightly (focus = current week score, flow) but
only feed sparklines.

### Today's move

`pickTodaysMove`: rotation = active projects + non-terminal areas, minus
anything with a `daily_moves` row today. Ordered by `config.todaysMove.order`:
stuck → nearest target date → longest since last progress → round-robin
(least recently on the card) → name. Nothing in rotation ⇒ top Idea with
"Start this?" and its price, or "Nothing in flight. Good.". Did it =
`POST /moves/did-it` → `logProgress`; Not today = `POST /moves/skip`.

### Review, seasons, GitHub, workout hook

- Review week: on Sunday the week ending today, otherwise the week just ended
  (`reviewWeekFor`). Banner due on Sun/Mon until `completeReview`.
- `startSeason()` restarts season counters and (via `isVisibleInSeason`) hides
  last season's terminal projects from the board; history stays.
- `syncGithubProgress()` runs in the nightly job and on `POST /github/sync`.
- `POST /api/v1/hooks/workout` takes only `WORKOUT_HOOK_TOKEN` and only adds
  one to today's Workouts routine.
