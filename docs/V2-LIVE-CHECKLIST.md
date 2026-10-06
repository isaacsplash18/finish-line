# Finish Line v2 — post-migration live checklist

For the agent that verifies v2 against the live Supabase project
(ref `<project-ref>`) once migration `0002_v2.sql` can be applied.

**Ground rules**

- Isaac's REAL projects, routines, rewards and reviews are in this database.
  Do not tap, move, kill, skip, edit or link any row whose name does not start
  with `ZZ`. Create only `ZZ`-prefixed rows and erase every one of them at the end.
- Do everything (create → test → erase) inside **one SGT calendar day**:
  `DELETE /projects/:id` only erases projects whose stage history is all from
  today (SGT). SGT midnight is 16:00 UTC — start before ~14:00 UTC.
- Never start over the cap with test rows (it would lock Isaac's real rewards
  and start a real bleed). Step 0 decides how many ZZ actives are allowed.
- Do not deploy unless the caller says so. Run against a local production
  build (`npm run build && npm run start -p 3100`) pointed at the live DB via
  `.env.local`.
- Never print `API_KEY`, `WORKOUT_HOOK_TOKEN`, `APP_PASSWORD` or the anon key.

```bash
cd "~/Focus App"
export FL=http://localhost:3100/api/v1
export FL_KEY=$(grep '^API_KEY=' .env.local | cut -d= -f2-)
export HOOK=$(grep '^WORKOUT_HOOK_TOKEN=' .env.local | cut -d= -f2-)
export SB_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2-)
export SB_ANON=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' .env.local | cut -d= -f2-)
alias flc='curl -s -H "Authorization: Bearer $FL_KEY" -H "Content-Type: application/json"'
# Direct PostgREST (RLS is off by design) — only for ZZ rows and test review/season rows.
alias sbc='curl -s -H "apikey: $SB_ANON" -H "Authorization: Bearer $SB_ANON" -H "Content-Type: application/json"'
export TODAY=$(TZ=Asia/Singapore date +%F)
```

---

## 1. Apply the migration

1. Before: record the baseline so you can prove nothing real moved.
   ```bash
   flc $FL/wip | jq '.data | {activeCount, label}'
   flc $FL/scores | jq '.data[-1]'
   flc $FL/rewards | jq '[.data[] | {name, status}]'
   flc "$FL/projects?includeTerminal=true" | jq '[.data[] | {name, stage}]' > /tmp/fl-before-projects.json
   ```
2. Run `supabase/migrations/0002_v2.sql` in the Supabase SQL editor (or
   `supabase db push`). It is additive and idempotent; re-running is safe.
3. Reload the PostgREST schema cache (the file ends with this, but run it again
   if any endpoint below still says "schema cache"):
   ```sql
   notify pgrst, 'reload schema';
   ```
4. Restart the local server so the one-time "has 0002 been applied?" warnings
   reset, then confirm the server log has none of them after loading `/`.

## 2. Check the schema and the backfill (SQL editor)

```sql
-- columns + defaults
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_name = 'projects' and column_name in ('kind', 'github_repo');
-- expect kind text default 'project' not null; github_repo text nullable

select kind, count(*) from projects group by kind;          -- all 'project'

-- new tables exist
select to_regclass('progress_events'), to_regclass('reviews'),
       to_regclass('seasons'), to_regclass('daily_moves');

-- stage backfill: one 'stage' row per (project, SGT day) that had a stage event
select
  (select count(*) from progress_events where kind = 'stage') as backfilled,
  (select count(distinct (project_id, (created_at at time zone 'Asia/Singapore')::date))
     from stage_events) as expected;                          -- must be equal

-- exactly one season, starting at the beginning of history (NOT at migration time)
select name, started_at,
       least((select min(created_at) from projects), (select min(created_at) from stage_events)) as history_start
from seasons;                                                 -- 1 row, started_at = history_start

select count(*) from reviews;      -- 0
select count(*) from daily_moves;  -- 0
```

Then confirm nothing real moved:

```bash
flc "$FL/projects?includeTerminal=true" | jq '[.data[] | {name, stage}]' | diff - /tmp/fl-before-projects.json && echo "projects unchanged"
flc $FL/counters | jq '.data'           # season == lifetime (Season 1 covers all history)
flc $FL/seasons | jq '.data'            # "Season 1"
```

And on `/projects`: every Done/Killed project that was on the board before is
still on the board (no "Show N from earlier seasons" toggle yet).

## 3. Read endpoints (no writes)

```bash
flc $FL/moves/today  | jq '.data | {status, name: .project.name, reason}'   # a REAL project — do not act on it
flc $FL/focus/week   | jq '.data | {score, weekStart, chargedThrough, pending}'
flc $FL/counters     | jq '.data'
flc $FL/review       | jq '.data | {weekStart, weekEnd, due, completedAt, n: (.projects | length), stages: [.projects[].project.stage]}'
# stages may include "shipped" — Shipped projects are part of the review now
flc $FL/dashboard    | jq '.data | {focus, flow, didItDaysThisWeek, reviewDue, season: .season.name, areas: (.areas | length)}'
flc $FL/seasons      | jq '.data'
```

Auth boundaries (all must be 401, nothing written):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $FL_KEY" $FL/hooks/workout   # 401: API_KEY not accepted by the hook
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $HOOK" $FL/dashboard                  # 401: hook token not accepted elsewhere
curl -s -o /dev/null -w '%{http_code}\n' -X POST $FL/hooks/workout                                     # 401: no token
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS $FL/hooks/workout                                  # 204 preflight
```

## 4. Step 0 — how many ZZ actives are allowed

```bash
ACTIVE=$(flc $FL/wip | jq '.data.activeCount'); CAP=$(flc $FL/wip | jq '.data.cap'); echo "$ACTIVE of $CAP"
```

- `ACTIVE <= CAP - 1`: proceed as written (one ZZ project in Building).
- `ACTIVE >= CAP`: create `ZZ Move` as an **area** instead (`"kind":"area"`).
  Did it / skip / stuck-clear still work for areas, but they never move Focus,
  so mark acceptance 1 ("Focus changes on tap") as "not testable without going
  over cap" rather than forcing it.

## 5. Create the test rows

```bash
TOMORROW=$(TZ=Asia/Singapore date -v+1d +%F 2>/dev/null || date -d tomorrow +%F)
IN2=$(TZ=Asia/Singapore date -v+2d +%F 2>/dev/null || date -d '+2 days' +%F)

# Rotation item 1: wins the card (nearest target date). Building = 1 more active (free under cap).
MOVE=$(flc -X POST $FL/projects -d '{"name":"ZZ Move","next_action":"ZZ first step","stage":"building","stage_target_date":"'$TOMORROW'"}' | jq -r '.data.project.id')
# Rotation item 2: an area (never counts), second on the card.
AREA=$(flc -X POST $FL/projects -d '{"name":"ZZ Area","next_action":"ZZ area step","kind":"area","stage_target_date":"'$IN2'"}' | jq -r '.data.project.id')
# Review subjects: Shipped never counts toward the cap, and the review includes Shipped.
RKILL=$(flc -X POST $FL/projects -d '{"name":"ZZ Review Kill","next_action":"ZZ decide","stage":"shipped"}' | jq -r '.data.project.id')
RDONE=$(flc -X POST $FL/projects -d '{"name":"ZZ Review Done","next_action":"ZZ wrap up","stage":"shipped"}' | jq -r '.data.project.id')
# Price-preview subject only (never moved).
IDEA=$(flc -X POST $FL/projects -d '{"name":"ZZ Idea","next_action":"ZZ maybe"}' | jq -r '.data.project.id')
echo $MOVE $AREA $RKILL $RDONE $IDEA
flc $FL/wip | jq '.data | {label, isOverCap}'   # isOverCap must be false
flc $FL/moves/today | jq '.data | {name: .project.name, reason, upNext: [.upNext[].name]}'
# expect name "ZZ Move", reason "target", "ZZ Area" next
```

If `ZZ Move` is not first on the card (e.g. a real project is stuck or has an
earlier target date), do the UI Did-it/Not-today steps through the API instead
(§7) — never tap a real project's card.

## 6. UI flows (browser, mobile width, logged in with APP_PASSWORD on localhost)

Record Focus (`flc $FL/focus/week | jq .data.score`) before starting.

1. **Did it** — `/` shows `ZZ Move` / "ZZ first step" with Did it + Not today.
   Tap **Did it**. Without a reload: Focus number goes up by 2 (unless already
   100 → ledger says "holding at 100"), ledger reads "+2 did it · N did-it
   day(s) this week", Did-it days counter ticks if it was today's first, the
   "Next action for ZZ Move?" prompt appears prefilled. Type "ZZ second step",
   Enter. Card advances to `ZZ Area`.
   - API check: `flc $FL/projects/$MOVE | jq '.data | {next_action, stuck_since}'` → "ZZ second step", null.
2. **Not today** — on `ZZ Area`, tap **Not today**: ledger "Skipped. No
   penalty. Back tomorrow.", Focus unchanged, card advances to a REAL project.
   **Stop tapping.** Reload: neither ZZ row is on the card.
3. **Stuck cleared instantly** (acceptance 2) — mark ZZ Area stuck directly,
   then Did-it it via the API (it was skipped, but Did it overrides a skip):
   ```bash
   sbc -X PATCH "$SB_URL/rest/v1/projects?id=eq.$AREA&name=like.ZZ*" -d '{"stuck_since":"'$TODAY'"}'
   flc -X POST $FL/moves/did-it -d '{"projectId":"'$AREA'"}' | jq '.data | {unstuck, s: .project.stuck_since}'
   # unstuck may be false for an area (areas are never stuck in the app) — repeat on ZZ Move if needed:
   sbc -X PATCH "$SB_URL/rest/v1/projects?id=eq.$MOVE&name=like.ZZ*" -d '{"stuck_since":"'$TODAY'"}'
   flc -X POST $FL/moves/did-it -d '{"projectId":"'$MOVE'"}' | jq '.data | {unstuck, s: .project.stuck_since}'   # unstuck true, s null
   ```
4. **Start / price preview** — `/projects` → `ZZ Idea` → Move to… → Building.
   The modal states the price: "No charge — N of 3 active." at/under cap, or
   "This takes you to 4 of 3 active: -15 Focus now, -10/day while over cap,
   rewards locked." over it. **Cancel** — do not confirm.
   Then `ZZ Review Done` → Move to… → Commercialising: the modal must say
   either "No charge — …" or "No activation charge, but this takes you to …"
   (never "-15"). **Cancel.**
   The home card's "Start this?" state only appears when nothing real is
   active; it is covered by `pickTodaysMove` tests — do not empty the real
   rotation to see it.
5. **Kind toggle** — `/projects/$IDEA` → Kind → Area: it leaves the kanban and
   appears in the "Ongoing" strip on `/projects`. Toggle back to Project: it
   returns to the Idea column. WIP label unchanged throughout.
6. **Repo link + GitHub sync** — `/projects/$MOVE` → GitHub → enter
   `https://github.com/vercel/next.js` (stored as `vercel/next.js`). Settings →
   GitHub → **Check now**: the result lists `vercel/next.js` with status `ok`
   and commit days. API check:
   ```bash
   flc -X POST $FL/github/sync | jq '.data | {authenticated, inserted, repos: [.repos[] | {repo, status, n: (.commitDays | length)}]}'
   sbc "$SB_URL/rest/v1/progress_events?project_id=eq.$MOVE&kind=eq.commit&select=day"
   ```
   Only ZZ Move should appear in `repos` unless Isaac has linked real repos by
   then (their commit rows are legitimate; leave them).
7. **Review kill + done** — `/review` lists `ZZ Review Kill` and
   `ZZ Review Done` (Shipped) alongside the real active/Shipped projects.
   - `ZZ Review Kill` → Kill → reason "ZZ test" → confirm: "+10" feedback.
   - `ZZ Review Done` → Done → confirm: "+20" feedback.
   - Do **not** press Keep or Kill/Done on any real project.
   - **Finish review**: first check whether a row already exists for that week
     (`flc $FL/review | jq '.data | {weekStart, completedAt}'`). If
     `completedAt` is already set, skip this button (Isaac did his review). If
     it is null, press Finish review, confirm the summary + "Next week starts
     at 100", then note `WEEK=<weekStart>` — it is deleted in cleanup.
8. **Review complete via API on a past week** (no real effect):
   ```bash
   flc -X POST $FL/review/complete -d '{"weekStart":"2026-09-07"}' | jq '.data'
   flc -X POST $FL/review/complete -d '{"weekStart":"2026-09-08"}' | jq '.code'   # VALIDATION (not a Monday)
   ```
9. **New season** — Settings → Start a new season, name it `ZZ test season`.
   Counters (season) restart at 0; `/projects` hides Done/Killed/Abandoned
   projects that ended before now behind "Show N from earlier seasons"
   (`ZZ Review Kill`/`Done` ended today before the season → hidden too). Real
   history is intact (lifetime counters unchanged). Deleted in cleanup.
10. **Workout hook** (acceptance 8) — record today's Workouts count first:
    ```bash
    WID=$(flc $FL/routines | jq -r '.data[] | select(.name=="Workouts") | .id')
    BEFORE=$(flc $FL/routines | jq -r --arg d "$TODAY" '.data[] | select(.name=="Workouts") | .checksByDate[$d] // 0')
    curl -s -X POST -H "Authorization: Bearer $HOOK" $FL/hooks/workout | jq '.data'   # count == BEFORE + 1
    ```
    `/routines` shows the extra tick today. Restore it in cleanup.

## 7. API equivalents (if the card order prevents the UI taps)

```bash
flc -X POST $FL/moves/did-it -d '{"projectId":"'$MOVE'","nextAction":"ZZ second step"}' | jq '.data | {unstuck, nextActionUpdated, focus: .focusWeek.score, next: .todaysMove.project.name}'
flc -X POST $FL/moves/skip   -d '{"projectId":"'$AREA'"}' | jq '.data.skipped'
flc -X PATCH $FL/projects/$IDEA -d '{"kind":"area"}'    | jq '.data.kind'
flc -X PATCH $FL/projects/$IDEA -d '{"kind":"project"}' | jq '.data.kind'
flc -X PATCH $FL/projects/$MOVE -d '{"github_repo":"https://github.com/vercel/next.js"}' | jq '.data.github_repo'
flc -X POST $FL/projects/$RKILL/kill -d '{"reason":"ZZ test"}' | jq '.data.focus'
flc -X POST $FL/projects/$RDONE/move -d '{"toStage":"done"}'  | jq '.data.focus'
```

## 8. Cleanup (mandatory, same SGT day)

```bash
# 1. Season: delete only the test season; the backfilled Season 1 becomes current again.
sbc -X DELETE "$SB_URL/rest/v1/seasons?name=eq.ZZ%20test%20season"
flc $FL/seasons | jq '.data.name'      # "Season 1"

# 2. Reviews: the past-week test row, and the real week's row ONLY if you created it in §6.7.
sbc -X DELETE "$SB_URL/rest/v1/reviews?week_start=eq.2026-09-07"
# [ -n "$WEEK" ] && sbc -X DELETE "$SB_URL/rest/v1/reviews?week_start=eq.$WEEK"

# 3. Workouts: put today's count back exactly.
flc -X POST $FL/routines/$WID/check -d '{"date":"'$TODAY'","count":'$BEFORE'}' | jq '.data.count'

# 4. Erase every ZZ project (progress_events, daily_moves, stage_events cascade).
for id in $MOVE $AREA $RKILL $RDONE $IDEA; do flc -X DELETE $FL/projects/$id | jq -c '.data // .'; done
flc "$FL/projects?includeTerminal=true" | jq '[.data[] | select(.name | startswith("ZZ"))] | length'   # 0
sbc "$SB_URL/rest/v1/projects?name=like.ZZ*&select=id,name"                                          # []

# 5. Re-run the recompute so today's snapshot, stuck flags and reward gate no longer see the test rows.
flc -X POST $FL/scores/recompute | jq '.data | {focus: .focus.score, flow: .flow.score}'
```

Then prove nothing real moved:

```bash
flc "$FL/projects?includeTerminal=true" | jq '[.data[] | {name, stage}]' | diff - /tmp/fl-before-projects.json && echo "projects unchanged"
flc $FL/rewards | jq '[.data[] | {name, status}]'   # same as §1.1
flc $FL/wip | jq '.data.label'                      # same as §1.1
flc $FL/focus/week | jq '.data.score'               # same as before §6
flc $FL/counters | jq '.data'                       # season == lifetime again
sbc "$SB_URL/rest/v1/daily_moves?select=*"          # [] unless Isaac used the app meanwhile
```

If a ZZ erase returns 409 (SGT midnight passed), do **not** kill/abandon it
(that would score). Delete it with SQL instead:
`delete from projects where name like 'ZZ%';` then re-run the recompute.

## 9. Report

For each of SPEC-V2 §10 acceptance 1–8: pass / fail / not testable (why),
plus the backfill counts, the endpoint results, screenshots of `/` after a
Did-it and of `/review` with the ZZ rows, and confirmation that cleanup left
zero `ZZ` rows and the real baseline unchanged.
