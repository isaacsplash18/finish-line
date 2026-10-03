# Finish Line

A single-user app whose entire purpose is to make Isaac finish what he starts.

v2 ("the loop that answers back", `SPEC-V2.md`): v1 judged nightly with a meter he
couldn't move; v2 answers every tap today and judges once a week.

- **Today's move.** The home screen is one card: one project, its next action, and two
  buttons — **Did it** (+2 Focus, max +10/day, clears Stuck, optional "Next action?"
  prompt) and **Not today** (no penalty; back tomorrow). Stuck projects surface first,
  then nearest target date, then longest quiet, then round-robin. Nothing active ⇒ the
  top Idea with "Start this?" and its price.
- **Weekly Focus.** Resets to 100 every Monday 00:00 SGT and is computed live. Starting
  something is free at or under the soft cap of 3 active; landing over it costs −15
  plus −10/day per over-cap project. Stuck is −10 once per week. Done +20, decisive
  kill +10, abandon −25 (and the pinned reward is forfeited). Rewards lock only
  while over cap. Under it: up-only counters — Finished · Killed on purpose ·
  Did-it days · Weeks under cap — per season and lifetime.
- **Sunday review** (`/review`, banner on Sun/Mon until done). Every active and Shipped
  project with this week's progress days: Keep (with a next action), Kill (+10) or
  Done (+20). Then the week's Focus breakdown. A ritual, not a gate.
- **Areas.** Ongoing ventures (`kind = 'area'`) sit in Today's move rotation but never
  count toward the cap, stuck, or any score. They live in an "Ongoing" strip on
  Projects.
- **Seasons.** Settings → Start a new season: counters restart, last season's finished
  and killed projects drop off the board, history stays.
- **GitHub signal** (optional). Link a project to `owner/name`; commit days count as
  progress (nightly, or Settings → Check now).
- **Workout hook.** `POST /api/v1/hooks/workout` with its own token adds one to today's
  Workouts routine — nothing else — so another app can tick workouts without the
  main API key.
- Routines still roll up into **Flow** (rolling 7 days, live), below the fold.

Dark UI. Big numbers. Red means Stuck or Forfeited, and nothing else.

## Run it

```bash
npm install
cp .env.example .env.local
npm run dev
```

Then run, in order, in the Supabase SQL editor (both idempotent):

1. `supabase/migrations/0001_init.sql` — schema + seed.
2. `supabase/migrations/0002_v2.sql` — v2 tables/columns + backfill. Without it the
   app still renders (v2 sections empty), but Did it / Not today / review / seasons /
   areas / repo links cannot be saved.

## Environment

| Var | Required | What |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase project (RLS is off by design — single user). |
| `APP_PASSWORD` | yes | Password for the `/login` gate. Changing it signs every session out. |
| `API_KEY` | for the API | Bearer token for `/api/v1/*` (see `API.md`). Unset ⇒ the API rejects everything. |
| `WORKOUT_HOOK_TOKEN` | for the hook | Separate bearer token accepted **only** by `POST /api/v1/hooks/workout`. |
| `GITHUB_TOKEN` | no | Read-only token for the commit sync. Unset ⇒ unauthenticated (public repos, 60 req/h). |
| `CRON_SECRET` | prod | If set, `GET /api/cron` requires `Authorization: Bearer <it>`; Vercel Cron sends it. |

## Scripts

| Command | What |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build (type-checks) |
| `npm test` | Score maths unit tests |
| `npm run lint` | ESLint |

## Docs

- **`SPEC-V2.md`** — the v2 spec. Authoritative where it conflicts with the rest.
- **`ARCHITECTURE.md`** — the contract: file map, data-access signatures,
  component props, styling rules. §11 is the v2 model.
- **`API.md`** — the REST API.
- **`SPEC-CHANGES.md`**, **`PRD-focus-app.md`** — the v1 specs.

The nightly job (`GET /api/cron`, Vercel Cron at 16:00 UTC = midnight SGT) syncs
GitHub commits, sets Stuck flags, applies the reward gate and writes the day's
snapshot. It also runs lazily on dashboard load (without the GitHub sync) if the
cron missed a night. Scores themselves are always computed live.
