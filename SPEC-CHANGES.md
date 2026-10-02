# Spec changes vs PRD (authoritative — overrides PRD §3.2, §4.3.3, §6.2, §13.1)

Date: 2026-08-28. Source: Isaac, mid-build. Rationale: a hard WIP block would make him
stop using the app and do the projects anyway. The cap must be economic, not physical.

## 1. Soft WIP cap replaces the hard cap

- The WIP cap (3 Active = Building + Commercialising) is a **soft cap**. Creating a
  project or moving one into Building/Commercialising is NEVER blocked, at any count.
- `moveProjectStage` must NOT throw over the cap. No disabled buttons anywhere.
- Instead, going over cap has compounding costs (below), and the UI states the price
  up front at the moment of action, e.g.:
  "This takes you to 4 of 3 active: -15 Focus now, -10/day while over cap, rewards locked."

## 2. Focus score deltas (all tunable in lib/config.ts)

Unchanged: start 100 per rolling 30-day window; -15 per move into Building in window;
-10 per currently-Stuck project (recurring while stuck); -25 per Abandoned in window;
+20 per Done (score capped 0–100).

New:
- **Over-cap bleed**: -10 per Active project beyond the cap, recurring while over cap
  (same recurrence semantics as the stuck penalty — counts each day the condition holds
  within the window). Config key e.g. `focus.overCapPenaltyPerProjectPerDay`.
- **Decisive-kill bonus**: +10 Focus per killed project *that had reached Building or
  beyond*, within the window. Killing from Idea stage is neutral (ideas are free both
  ways). Kill flow still requires the 1-line reason.
  Economy check: start shiny object (-15) then kill early (+10) = net -5, vs -10/day
  bleeding while it lingers, vs -25 + forfeited reward if abandoned. Killing early is
  always the cheapest exit. Abandonment stays the worst outcome.

## 3. Reward locking

Unclaimed rewards lock while ANY project is Stuck **or** the portfolio is over the
WIP cap. Unlock when back at/under cap and nothing stuck. Forfeit rules unchanged.

## 4. UI states

- WIP counter: under cap = normal; at cap = accent orange; over cap = **amber warning**
  ("4 of 3 active — over cap, -10/day"). Red remains reserved exclusively for
  Stuck and forfeits.
- Kill confirmation shows the +10 bonus feedback when applicable ("Decisive kill: +10 Focus").
- New-project / stage-move affordances always enabled; at/over cap they show the cost
  copy instead of being disabled.

## 5. Acceptance checklist changes

- Item 1 becomes: "Creating a 4th active project WORKS through every UI path, shows the
  compounding cost before confirmation, and the recurring over-cap penalty + reward lock
  apply from that day."
- New item: "Killing a Building-stage project adds +10 to Focus and shows in the kill
  confirmation; killing an Idea does not affect Focus."
