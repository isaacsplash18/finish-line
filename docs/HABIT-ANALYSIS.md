# Why Tally and the training app stick and Finish Line doesn't

Date: 2026-10-03. Sources: code and docs in all three apps, plus the facts about Finish Line's live data after one month. Nothing was changed in any repo.

| App | Where | What it is |
| --- | --- | --- |
| **Tally** | `/Users/isaacho/Tally` | Two-person budget PWA (Isaac + Rachell). Next.js + Supabase `toeimgwqcewifahwunyd`. In use since 2026-08-28 (genesis week 2026-08-31). |
| **Training app** ("The Half", formerly "Strength System") | GitHub `isaacsplash18/daily-app` (public), one `index.html`, about 720 lines, data in `localStorage` | It started on 2026-07-01 as a 12-week strength block. You logged through week 8. On 2026-09-22 it was rebuilt as a 10-week half-marathon block for BYD Singapore on 6 Dec. It has had 17 commits between July and September. |
| **Bible Reading** | `/Users/isaacho/Bible reading/bible-reading-app/index.html` | 66 books and 1,189 chapters. You tap a chapter to mark it read. It has one progress bar, stores data in `localStorage`, and has no dates, streaks or penalties. |
| **Finish Line** | `/Users/isaacho/Focus App` | Projects, routines, Flow and Focus scores, and rewards. Next.js + Supabase `thiizublmtqgdvaclvvf`. **Does not stick.** |

A note on naming: the GitHub repo `daily-app` ("Isaac's daily routines") is the strength/running app. Where this document says "the training app", it means that repo.

---

## 1. Diagnosis: three reasons Finish Line didn't stick

### Reason 1: The meters were dead. Nothing you did moved them, so they taught you nothing.

- **Scores change only once a day.** `ensureTodaySnapshot()` (`lib/data/scores.ts`) returns the stored row for today if there is one. Ticking a routine or killing a project does not recompute anything, and `API.md` §"Scores are snapshots" says *"The UI works the same way."* So if you ticked Bible at 7am, Flow stayed where it was until midnight. In the other two apps, the number changes as soon as you tap.
- **Once Focus hits 0, it stays there for weeks.** Focus is 100 plus the deltas over a rolling 30-day window, clamped to 0–100 (`lib/scores.ts` `explainFocusScore`). The over-cap bleed is replayed day by day from `stage_events`. It costs −10 per project over the cap per day, up to 30 project-days (`config.ts`: `overCapPenaltyPerProjectPerDay: -10`, `maxOverCapProjectDaysCharged: 30`). Ten days at 4 of 3 costs −100 by itself. Five stuck projects add −50 to −200 more (−10 each, repeating weekly, up to 4 charges). The real total was likely in the minus hundreds. Finishing a project gives **+20**, and a decisive kill gives **+10**. Even on a day when you killed every stuck project, the over-cap days already in the window stayed charged until they aged out. Below about −20 raw, nothing you can do makes the visible number move. The only thing that changes it is the calendar.
- **No reward could be reached.** `applyRewardLockingRule()` locks *every* unclaimed reward while *any* project is stuck *or* you are over the cap (SPEC-CHANGES §3). With 5 stuck projects, the gloves, headgear and AirPods were all locked. On top of that, each reward needs its project to reach Done. So every reward depended on the state of all seven projects.

Compare the other apps:
- **Tally:** you log $12 and the big "left this week" number drops by $12 right away (`HomeScreen.tsx` `RemainingCard`).
- **Training app:** you tick a session, `render()` runs again, and the "Clocked in" card (sessions, week streak, km, kg lifted, progress bar to the next badge) updates on the same frame (`stats()` / `rewardHTML()`).
- **Bible app:** you tap a chapter and the header bar and the book's ring fill in immediately.

### Reason 2: It asked you to report work you'd already recorded elsewhere, and it tracked app edits instead of actual work.

- **Routines were entered twice.**
  - Workouts already get ticked in the training app's weekly schedule, with sets, km and minutes.
  - Bible reading already gets ticked chapter by chapter in the Bible app.
  - Finish Line asked for both again (`RoutineChecklist.tsx`), as a second tap in a second app, with no reward for doing it twice.
  - Flow sitting at 0 is what you'd expect from that. You were doing the workouts, as the training app's logs show. You just weren't reporting them twice.
- **"Stuck" measured whether you edited the app.** A project goes stuck after 14 days with no stage change and no edit to `next_action` (`ARCHITECTURE.md` §4.6; `NextActionEditor` hint: *"Editing this resets the 14-day staleness clock"*). A week of commits in the project's repo still shows as Stuck if you didn't retype the next-action text.
- **Imports probably went stuck together.** Imported projects get `next_action_updated_at = now` (`importProject`). If you didn't touch them, the whole batch hit the 14-day limit on the same morning. That matches "7 projects in, 5 stuck".
- **Reporting progress takes too many steps.** Dashboard → tap the project card (server render) → Edit → type a new next action → Save (another server round trip). That is 3 taps, some typing and 2 page loads, roughly 20–30 seconds, every time you work on something. Logging a spend in Tally takes about 5 seconds, and the PRD treats that as an acceptance test.

### Reason 3: The rules described someone else's life, and they punished by default.

- **The WIP cap of 3 doesn't match your workload.** In September alone, about 8 of your GitHub repos were active (finish-line, life-church-arrival, splash-advisory, daily-app, multiply-ent-app, tally, soycraft-b2b, isaac-twin-command-center), plus Soycraft, Splash Advisory, LFG and BBW work in `~`. Ongoing businesses never "finish", but Finish Line counts them as projects. So you were over the cap from the first week and paying −10 a day for it.
- **It charged you for your strength.** You ship v1s quickly. Tally went from PRD to working app in days, and the training app was rebuilt as a new program in one evening (6 commits on 2026-09-22). Finish Line charges −15 every time something moves into Building. The PRD says the problem is the *last mile* (commercialise, relaunch). The economy penalised the first mile instead.
- **The home screen opens with two zeros and two accusations.** In the first 3 seconds you see:
  - the WIP chip "4 of 3 active — over cap, -10/day" (amber)
  - **Flow 0**, *"You're not doing the routines."*
  - **Focus 0**, *"5 projects stuck, bleeding."*
  - then up to 7 project cards, 5 of them pulsing red (`app/page.tsx`)
- **The only way to start fresh was a wipe.** Focus has a 30-day memory and no weekly reset. That's why you asked to wipe everything.

Compare the training app: when the 12-week block stopped at week 8, the app did not declare a failure. It kept the old block as tabs ("Show the previous strength block's logs instead of hiding them") with the copy *"You completed week 8, then the program changed."* It also has a "Move this week's logs…" action for when your schedule slips.

---

## 2. Evidence by dimension

### 2.1 Interaction cost: from opening the app to the core action

| App | What the first 3 seconds show | Core daily action | Cost |
| --- | --- | --- | --- |
| Tally | One big coloured number, "Isaac · left this week $X", with Rachell's figure and "Week closes Sun 23:59 · Nd left" underneath. The numpad is already on screen. | Log a spend | **About 3 taps, under 5 s.** No login, and your identity is remembered (`session.ts`). Client-rendered with a skeleton. |
| Training app | "64 days to go · BYD Half", the Clocked-in totals, and this week's schedule with **today's row highlighted**. | Tick a session, or log weight × reps during rest between sets | **1 tap.** Static HTML, no network. Set inputs are pre-filled with the target weight calculated from your 1RM. |
| Bible app | Chapters read out of 1,189, plus a progress bar | Mark a chapter | **2 taps** (book, chapter), or type in search. |
| Finish Line | WIP warning, Flow 0, Focus 0, two critical captions | Either (a) tick a routine or (b) record project progress | (a) Scroll past the scores, then 1 tap, **but the score doesn't change.** (b) **3 taps, typing and 2 server round trips.** The dashboard is server-rendered from about 8 Supabase queries, plus a full recompute on the first open of each day. |

The apps that stick put the action on the screen you open to. Finish Line puts the *verdict* there.

### 2.2 Feedback loop

| App | What you get back immediately |
| --- | --- |
| Tally | The envelope drops by exactly what you spent. The colour changes at 50% and 20%. You can see Rachell's number too. The pot and 🔥 streak in the header change at the weekly close. |
| Training app | The session ✓ turns green and the row is struck through. Sessions, streak (as current/best), km and kg update, and the "Next: Ten sessions 7/10" bar fills. Totals only go up. |
| Bible app | The ring fills and the overall % goes up. It can only go up. |
| Finish Line | The routine row turns green. Flow and Focus **don't move until midnight**. Once Focus reaches 0, it **doesn't move for up to 30 days**. Rewards stay locked whatever you do. |

A score that can't move gives you nothing to respond to. A score that moves on every tap gives you a reason to tap again.

### 2.3 Cadence match

- **Tally:** one cadence, the week. You get a new envelope every Monday, and the countdown to Sunday 23:59 is always on screen.
- **Training app:** per session, rolled up into weeks, inside a block with an end date (race day). The weekly streak only counts weeks with 4 or more sessions ticked.
- **Bible app:** no cadence at all. You read at your own pace.
- **Finish Line** puts four clocks on one screen: daily routines, weekly routine targets (dog walk 5/7, workouts 3), projects that take weeks, and a rolling 30-day Focus window. None of them resets when the others do. The daily items are the only reason to open the app each day, and they're the items already covered by other apps. The projects need a **weekly** look, not a daily one. Mixing them on one screen meant there was no clear moment when the app was "done" for the day.

### 2.4 Punishment vs progress

The successful apps don't avoid punishment. Tally punishes: an over-budget week breaks the streak, carries the overspend into next week as debt, and freezes the shared pot (engine-spec §9, §11). Its punishment works for three reasons:

1. **It's a fact, not points.** You really did overspend $40, and next week's envelope is $40 smaller.
2. **It ends after one week.** *"One full week under budget thaws them — that week banks nothing, then earning resumes."* (`RedeemSheet`)
3. **It has a legitimate way out.** When real life produced lumpy legitimate spending, Tally added the `family` spend type (furniture, flights, medical) instead of punishing it. It bypasses envelopes, streaks and the pot (engine-spec §16). The rules were changed to fit reality.

The training app has **no punishment at all**. A broken streak still shows your best (`streak/best`). It says "Missing one run costs nothing". You can move a week's logs. It also ran for **three months with no rewards**: the rewards card only arrived on 2026-09-30. What kept you using it was **usefulness**. Every session it tells you exactly what to lift (calculated kg, ramp sets, the top triple) and what to run. You open it because you need it at the bar.

Finish Line's punishment fails all three of Tally's tests. It's made of points. It lasts up to 30 days. And when reality didn't fit (ongoing businesses, many parallel builds), there was no escape hatch, only the bleed.

### 2.5 Social and accountability

Tally's home screen shows Rachell's remaining number, and a redemption is blocked if *either* of you is frozen. That's real accountability, and it probably helps Tally's logging accuracy. **But it isn't the key ingredient.** The training app and the Bible app are completely solo, with no backend and no sharing, and they stick too. What all three have in common is: the action is on the first screen, feedback is instant, and any penalty is bounded. Sharing with Rachell is a useful extra for Finish Line (see R6), not the fix.

### 2.6 Data honesty

| Rule | Did it describe your reality? |
| --- | --- |
| 14-day Stuck | **No.** It measures edits to a text field, not work. Commits, client calls and shipped features don't count. |
| WIP cap of 3, over-cap bleed | **No.** It treats ongoing businesses (Soycraft, Splash Advisory) as unfinished projects. You were "over cap" by the definition, not by your behaviour. |
| −15 for a new build | **It works against you.** Your fast v1s are an asset. The real gap is the last mile. |
| Routines | **Duplicated.** The true data already lives in the training app and the Bible app. |
| Kill for +10 | **Yes.** This one is honest and worth keeping. |

Tally and the training app both kept changing their rules to fit the facts: the `family` type, re-dating the genesis week to remove phantom weeks, per-person envelopes, dropping HIIT, moving weeks, keeping old blocks. Finish Line's rules stayed fixed and pushed back against what you were actually doing.

---

## 3. Redesign proposal for Finish Line (ranked)

Keep: the soft cap (show the price, never block), kill as a respectable exit with its +10, the import flow, the REST API, and red reserved for real problems.

### R1. Make the home screen one card: "Today's move"

- The whole first screen is the **single next action** of the project you picked at the weekly review (R3). Show it in big text, with the project name and stage underneath.
- Two buttons:
  - **Did it.** This records progress and resets the stuck clock. It then opens one text field, "Next action?", pre-filled with the old one, and Enter saves.
  - **Not today.** No penalty. It just hides the card until tomorrow.
- Underneath, a compact list of the other active projects, each with a one-tap **"Worked on it"** button that resets the stuck clock without editing anything.
- Scores go to a small strip at the bottom, or to the Projects tab.
- Target cost: **open, 1 tap, about 5 s**, the same as Tally.

### R2. Make scores move on every tap and start fresh each week

- Recompute on every action. Call `computeAndSnapshotToday()` in each server action, or compute on read; `ARCHITECTURE.md` already says the cost is "nothing at this scale". No more waiting for midnight.
- Replace the 30-day rolling Focus with **a weekly score that resets every Monday**, like Tally's envelope. The worst case becomes "fresh start in 6 days", not "0 for a month".
- Add a **total that only goes up** next to it, like the training app's Clocked-in card and the Bible app's bar: *"Finished: 4 · Shipped: 9 · Killed cleanly: 3"*. This is your lifetime record and nothing can take it away.
- Limit each penalty type to once per week. Change the over-cap bleed from −10 per day to a **single weekly flag** ("over cap this week"), the way Tally freezes the pot.

### R3. Replace nightly punishment with a weekly review

- Every Sunday evening (Tally's week closes Sunday 23:59 and the training app's weeks run Monday to Sunday, so all three line up), run a 3–5 minute review, one screen per active project. Each project gets one tap: **Done / Moved stage / Worked on it / Park (back to Idea, free) / Kill (reason, +10)**.
- Then pick **next week's one focus project** and its next action. That becomes R1's home card.
- Stuck is decided **here**, not by a 14-day timer: a project is stuck if it gets two weekly reviews in a row with no progress. You're the one confirming it, so it's honest.
- The review ends with a summary card. Optionally it goes to Rachell (R6).

### R4. Detect progress automatically

- Nearly every project is a git repo. Add an optional `repo` field to each project and let the nightly cron check GitHub (`gh api repos/isaacsplash18/<repo>/commits?since=`). Any commit counts as "worked on it".
- A Claude Code `Stop` hook could also POST to `/api/v1/projects/:id` for the repo you were in. This is a config change for you to make, but it would make progress logging cost zero taps.
- Workouts: see R7.

### R5. Separate ongoing areas from finishable projects, and aim the economy at the last mile

- Add an **Area** type (Soycraft, Splash Advisory, LFG, church). Areas have no stages, no WIP count and no stuck clock. They're just somewhere to put the work that never ends.
- Keep the soft cap at 3, but apply it to **finishable** projects only.
- Remove the −15 for entering Building, or make it apply only above the cap. Put the incentives on **Shipped → Commercialising → Done**. That last mile is the actual problem in the PRD (AI Command Centre, LAC round 2).

### R6. Fund rewards gradually, like Tally's pot

- Create a **"Finish fund"** in dollars. It earns on every last-mile step, for example +$20 when a project reaches Shipped, +$30 at the first commercial milestone, +$100 at Done. Tune the amounts in `config.ts`.
- When the fund covers the price of an item on the list (boxing gloves, headgear, AirPods), you can claim it.
- A stuck project **pauses earning for one week**, the same mechanism as Tally's freeze. It no longer locks every reward.
- Abandon still forfeits.
- **Rachell:** let her see the fund and the weekly review summary, read-only, through a link or a card in Tally. Because she shares the pot in Tally, her visibility gives the reward real weight. Ask her before building this. It works as a bonus, not as the foundation.

### R7. Take routines off the Finish Line home screen and feed them automatically

- **Workouts:** the training app ticks sessions in `localStorage` (`S.sessions[...] = true`) and has no backend. So "read the strength app's Supabase" (PRD v1.1) can't happen as things stand. The cheap fix is a small `POST /api/ingest/session` endpoint in Finish Line, called from the training app's ✓ handler, that increments Workouts.
  - **Caution:** `daily-app` is a **public** repo, and Finish Line runs on the anon key with **RLS disabled on every table**. Never put the Finish Line anon key or `API_KEY` in the training app.
  - Give the ingest route its own low-value token that can only increment Workouts. The worst case is that someone inflates your workout count.
- **Bible:** the same pattern from the Bible app's chapter tap, or drop the Bible routine and trust the Bible app.
- **Dog walk and Sabbath:** keep them as a small one-tap row, or drop them. Flow becomes a read-only "this week" strip, not a hero number.

### R8. Make "start over" a feature, not a wipe

- Add a "New season" button that archives the current board as read-only history, like the training app's old-block tabs, and starts with no penalties.
- With the weekly reset (R2) you should rarely need it, but having it means quitting is never the only way to start over.

**Suggested build order:** R2 and R1 together, then R3 and R5, then R7, then R6. R4 and R8 when you have spare time.

---

## 4. Should the apps be combined?

| Option | What you gain | What you lose | Migration cost |
| --- | --- | --- | --- |
| **A. Keep 3 separate apps, no links** (status quo) | Nothing changes, so nothing breaks | Workouts and Bible still need double entry, and Flow stays dead | 0 |
| **B. Keep 3 apps, add a one-way event pipe** (training app → Finish Line Workouts, optionally Bible → Finish Line) | No double entry, and the Workouts routine ticks itself. Each app stays fast and single-purpose. | Almost nothing | **About 1–2 hours:** one ingest route with CORS and a narrow token, plus about 15 lines in `daily-app/index.html` |
| **C. Keep 3 apps on one Supabase, plus one shared "Today" home page** | One glance at everything | The training app's no-backend simplicity: it would need syncing, and its one-evening rebuilds get heavier. Tally's 3-tap log gets a launcher in front of it. RLS policy has to be redesigned (Tally is permissive anon, Finish Line has RLS off). | **Days.** Merge two Supabase projects, move the training app off `localStorage`, plan the auth/RLS approach. |
| **D. Move Finish Line's project tracker into Tally as a tab** | It rides on an app you already open daily, and Rachell can see it | Tally is a **shared money app with no auth**. Identity is a `localStorage` toggle, so Rachell could tap your projects and your project list goes into her budget app. The tab bar grows and the 5-second log flow gets diluted. You'd be porting Finish Line's server-side data layer into Tally's client-side engine. **It risks breaking the app that works.** | **About 1 week** |
| **E. One life-dashboard PWA for all of it** | One install, one combined score | Each app's single-purpose speed. The training app is easy to rebuild because it's one HTML file. The four-cadence mixing problem gets worse, not better (§2.3). It puts Finish Line's broken loop at the front of the apps that work. | **1–2 weeks or more** |

### Recommendation

**Don't combine them. Fix the loop first.** Do option **B** now, alongside the redesign (R1–R3, R5, R7).

Run it for 4 weeks and check one thing: are you opening Finish Line at least once a week for the review, and are you tapping "Did it" most days?

- **If yes:** consider option C, a shared "Today" page. Even then, only make it a launcher that links into each app. Don't merge the apps themselves.
- **If no:** merging won't help. A broken loop doesn't get fixed by moving it into an app you already like.

The pattern across the three apps that work is **one job per app, the action on the first screen, and feedback within one tap**. Combining them would trade away the first of those to get a single icon.
