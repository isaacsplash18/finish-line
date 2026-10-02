# Finish Line — architecture & agent contract

Foundation is built. Screens are not. This document is the contract between the
foundation and the five screen agents.

Authoritative specs, in precedence order:

1. `SPEC-CHANGES.md` — overrides PRD §3.2, §4.3.3, §6.2, §13.1
2. `PRD-focus-app.md`
3. This document

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
  scores.ts                     PURE score maths + cost-preview copy
  scores.test.ts                32 tests
  supabase/env.ts               env reading, SupabaseConfigError, isSupabaseConfigured
  supabase/server.ts            getSupabaseServerClient()  (server only)
  supabase/client.ts            getSupabaseBrowserClient() ('use client')
  api/                          REST API helpers: auth, validation, schemas, errors, handler, revalidate
  data/                         server-side data access — see §5
    index.ts errors.ts projects.ts rewards.ts routines.ts
    key-dates.ts scores.ts dashboard.ts

supabase/migrations/0001_init.sql   schema + seed
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
`killBonusCopy`.

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

### 4.6 Stuck

A project is Stuck when either:

- no stage change AND no next-action edit for 14 days (Building / Shipped /
  Commercialising only — parked Ideas are free, PRD §3.3), or
- a linked key date has passed and the project is not Done (any non-terminal
  stage).

Written by `recomputeStuckFlags()`, which back-dates `stuck_since` to the day it
actually went stale.

### 4.7 Reward gate

Unclaimed rewards are locked while **any project is Stuck OR the portfolio is
over cap** (SPEC-CHANGES §3). `applyRewardLockingRule()` runs after every stage
change and in the nightly recompute. `claimReward` throws unless status is
`claimable`.

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
previewStageMove(id: UUID, toStage: ProjectStage):
  Promise<WipCostPreview & { killBonusCopy: string | null }>
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

recomputeStuckFlags(asOf?: DateKey): Promise<StuckRecomputeResult>
```

`ProjectWithMeta` = the row plus `isStuck`, `isActive`, `isTerminal`,
`daysInStage`, `daysIdle`, `daysToTarget`, `reward`.

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
getScoreSnapshots(days?: number, asOf?: DateKey): Promise<ScoreSnapshot[]>  // oldest first, 30
getTodaySnapshot(asOf?: DateKey): Promise<ScoreSnapshot | null>
computeAndSnapshotToday(asOf?: DateKey): Promise<RecomputeResult>
ensureTodaySnapshot(asOf?: DateKey): Promise<ScoreSnapshot>   // lazy fallback
```

`computeAndSnapshotToday()` does, in order: recompute stuck flags → apply the
reward gate → compute Flow → compute Focus → upsert today's snapshot. Idempotent.
Called by `GET /api/cron` (Vercel cron, 16:00 UTC = midnight SGT) and lazily by
`getDashboardData()`.

### Dashboard — `lib/data/dashboard.ts`

```ts
getDashboardData(asOf?: DateKey): Promise<DashboardPayload>
```

One call for the whole dashboard: `flow`, `focus`, `snapshots`, `routines`,
`activeProjects`, `stuckProjects`, `keyDates`, `rewards`, `rewardsLocked`,
`activeCount`, `wipLimit`, `wip`, `isOverCap`.

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

Never re-implement this maths in a screen. If you need the working, use the
`explain*` variants.

```ts
computeFlowScore(input: FlowScoreInput, cfg?: AppConfig): number
explainFlowScore(input, cfg?): FlowScoreBreakdown       // per-routine rate/target/actual
computeFocusScore(input: FocusScoreInput, cfg?): number
explainFocusScore(input, cfg?): FocusScoreBreakdown     // deltas, counts, over-cap days
countOverCapProjectDays(events, window, cfg?)           // per-day Active count + overBy
describeActivationCost(activeCountAfter, { isNewBuild }, cfg?): WipCostPreview
describeKillBonus(stage: ProjectStage, cfg?): string | null
```

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

Nav is four tabs — Dashboard, Projects, Routines, Settings. Project detail is
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
- [x] App icon + favicon — `public/icons/*`, `app/favicon.ico`
- [x] Scaffolding marker `components/app/AgentTodo.tsx` deleted

Quality gate: `npm run lint`, `npm test` and `npm run build` must all pass.
