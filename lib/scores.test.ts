import { describe, expect, it } from 'vitest';

import { config } from './config';
import {
  CLOCK_SKEW_TOLERANCE_MS,
  IMPORT_EVENT_MARKER,
  computeCounters,
  computeFlow,
  computeFlowScore,
  computeFocusWeek,
  countActiveProjects,
  countOverCapProjectDays,
  describeActivationCost,
  describeImportImpact,
  describeKillBonus,
  describeStageMoveCost,
  isStuck,
  isVisibleInSeason,
  pickTodaysMove,
  reconcileLiveNow,
  projectKindOf,
  reviewDueFor,
  reviewWeekFor,
  rewardGate,
  stuckSince,
  weekStartSgt,
  type DailyMoveInput,
  type FlowCheckInput,
  type FlowRoutineInput,
  type FocusEventInput,
  type FocusWeekInput,
  type ProgressEventInput,
  type StuckProjectInput,
  type TodaysMoveProjectInput,
} from './scores';
import type { FocusDeltaType, FocusWeekBreakdown, ProjectKind, ProjectStage } from './types';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/**
 * The week under test: Monday 2026-10-05 … Sunday 2026-10-11 (SGT).
 * The previous week starts Monday 2026-09-28.
 */
const MON = '2026-10-05';
const TUE = '2026-10-06';
const WED = '2026-10-07';
const THU = '2026-10-08';
const FRI = '2026-10-09';
const SAT = '2026-10-10';
const SUN = '2026-10-11';
const LAST_WEEK = '2026-09-28';

/** An instant on an SGT day: `sgt('2026-10-05', '08:00')`. */
function sgt(day: string, time = '10:00'): string {
  return `${day}T${time}:00+08:00`;
}

/** A stage event at 10:00 SGT (or `time`) on `day`. */
function ev(
  project_id: string,
  from_stage: ProjectStage | null,
  to_stage: ProjectStage,
  day: string,
  time = '10:00',
  note: string | null = null,
): FocusEventInput {
  return { project_id, from_stage, to_stage, created_at: sgt(day, time), note };
}

/** A project row as the engine sees it; clocks default to `since`. */
function proj(
  id: string,
  stage: ProjectStage,
  since: string,
  extra: Partial<StuckProjectInput> = {},
): StuckProjectInput {
  return {
    id,
    stage,
    kind: 'project',
    stage_changed_at: sgt(since),
    next_action_updated_at: sgt(since),
    created_at: sgt(since),
    ...extra,
  };
}

function didIt(project_id: string, day: string, time = '10:00'): ProgressEventInput {
  return { project_id, kind: 'did_it', day, created_at: sgt(day, time) };
}

/** N projects already Active (Building) since a September day, via a free path. */
function activeSince(ids: string[], day = '2026-09-01'): Pick<FocusWeekInput, 'projects' | 'stageEvents'> {
  return {
    projects: ids.map((id) => proj(id, 'building', day)),
    stageEvents: ids.map((id) => ev(id, 'shipped', 'building', day)),
  };
}

function week(
  input: Partial<FocusWeekInput>,
  now: Date | string,
  weekStart = MON,
): FocusWeekBreakdown {
  return computeFocusWeek(
    {
      projects: input.projects ?? [],
      stageEvents: input.stageEvents ?? [],
      progressEvents: input.progressEvents ?? [],
      keyDates: input.keyDates ?? [],
    },
    weekStart,
    now,
  );
}

function line(breakdown: FocusWeekBreakdown, type: FocusDeltaType) {
  const found = breakdown.lines.find((l) => l.type === type);
  if (!found) throw new Error(`no ${type} line`);
  return found;
}

/** Recent progress for active fixtures so they are never stuck unless a test wants it. */
function freshProgress(ids: string[], day = '2026-10-01'): ProgressEventInput[] {
  return ids.map((id) => ({ project_id: id, kind: 'commit', day }));
}

/* ------------------------------------------------------------------ */
/* Week boundary                                                       */
/* ------------------------------------------------------------------ */

describe('weekStartSgt', () => {
  it('maps every day of the week to its Monday', () => {
    for (const day of [MON, TUE, WED, THU, FRI, SAT, SUN]) {
      expect(weekStartSgt(day)).toBe(MON);
    }
    expect(weekStartSgt('2026-10-12')).toBe('2026-10-12');
    expect(weekStartSgt('2026-10-04')).toBe(LAST_WEEK);
  });

  it('resets at Monday 00:00 SGT, not UTC', () => {
    // Sunday 23:59:59 SGT is still last week…
    expect(weekStartSgt(new Date('2026-10-04T15:59:59Z'))).toBe(LAST_WEEK);
    // …and Monday 00:00 SGT (Sunday 16:00 UTC) is the new one.
    expect(weekStartSgt(new Date('2026-10-04T16:00:00Z'))).toBe(MON);
  });
});

/* ------------------------------------------------------------------ */
/* Focus — weekly                                                      */
/* ------------------------------------------------------------------ */

describe('computeFocusWeek', () => {
  it('starts at 100 with one line per delta type', () => {
    const result = week({}, sgt(WED));
    expect(result.score).toBe(100);
    expect(result.weekStart).toBe(MON);
    expect(result.weekEnd).toBe(SUN);
    expect(result.lines.map((l) => l.type)).toEqual([
      'activation',
      'overCap',
      'stuck',
      'abandoned',
      'done',
      'decisiveKill',
      'didIt',
    ]);
    expect(result.lines.every((l) => l.count === 0 && l.points === 0)).toBe(true);
  });

  /* --- §10.3: activation is free at 2-of-3, -15 at 3-of-3 --- */

  describe('activation charge', () => {
    it('costs 0 to start a project at 2 of 3 active', () => {
      const base = activeSince(['a', 'b']);
      const result = week(
        {
          projects: [...base.projects, proj('c', 'building', TUE)],
          stageEvents: [...base.stageEvents, ev('c', null, 'idea', '2026-09-20'), ev('c', 'idea', 'building', TUE)],
          progressEvents: freshProgress(['a', 'b']),
        },
        sgt(TUE, '18:00'),
      );
      expect(line(result, 'activation')).toMatchObject({ count: 0, points: 0 });
      expect(result.score).toBe(100);
    });

    it('charges -15 to start a project at 3 of 3 active (the 4th)', () => {
      const base = activeSince(['a', 'b', 'c']);
      const result = week(
        {
          projects: [...base.projects, proj('d', 'building', TUE)],
          stageEvents: [...base.stageEvents, ev('d', null, 'idea', '2026-09-20'), ev('d', 'idea', 'building', TUE)],
          progressEvents: freshProgress(['a', 'b', 'c']),
        },
        sgt(TUE, '18:00'),
      );
      expect(line(result, 'activation')).toMatchObject({ count: 1, perUnit: -15, points: -15 });
      // The over-cap day itself only lands at tonight's close.
      expect(line(result, 'overCap').points).toBe(0);
      expect(result.pending.overCap).toBe(-10);
      expect(result.score).toBe(85);
    });

    it('charges creation straight into Building over cap, and into Commercialising too', () => {
      const base = activeSince(['a', 'b', 'c']);
      const result = week(
        {
          projects: [...base.projects, proj('d', 'building', TUE), proj('e', 'commercialising', TUE)],
          stageEvents: [
            ...base.stageEvents,
            ev('d', null, 'building', TUE),
            ev('e', 'idea', 'commercialising', TUE, '11:00'),
          ],
          progressEvents: freshProgress(['a', 'b', 'c']),
        },
        sgt(TUE, '18:00'),
      );
      expect(line(result, 'activation').count).toBe(2);
    });

    it('never charges an import, a return from Shipped, or the Shipped → Commercialising last mile', () => {
      const base = activeSince(['a', 'b', 'c']);
      const result = week(
        {
          projects: [
            ...base.projects,
            proj('imp', 'building', TUE),
            proj('ret', 'building', TUE),
            proj('last', 'commercialising', TUE),
          ],
          stageEvents: [
            ...base.stageEvents,
            ev('imp', null, 'building', TUE, '09:00', `${IMPORT_EVENT_MARKER} pre-existing project`),
            ev('ret', 'shipped', 'building', TUE, '09:30'),
            ev('last', 'shipped', 'commercialising', TUE, '09:45'),
          ],
          progressEvents: freshProgress(['a', 'b', 'c']),
        },
        sgt(TUE, '18:00'),
      );
      expect(line(result, 'activation').count).toBe(0);
    });

    it('does not charge an activation that happened last week', () => {
      const base = activeSince(['a', 'b', 'c']);
      const result = week(
        {
          projects: [...base.projects, proj('d', 'building', '2026-10-01')],
          stageEvents: [...base.stageEvents, ev('d', 'idea', 'building', '2026-10-01')],
          progressEvents: freshProgress(['a', 'b', 'c', 'd']),
        },
        sgt(MON, '08:00'),
      );
      expect(line(result, 'activation').count).toBe(0);
    });
  });

  /* --- over-cap bleed, within the week only --- */

  describe('over-cap bleed', () => {
    it('charges -10 per over-cap project per closed day, this week only', () => {
      // 4 active since September: over by 1 every day.
      const base = activeSince(['a', 'b', 'c', 'd']);
      const result = week({ ...base, progressEvents: freshProgress(['a', 'b', 'c', 'd']) }, sgt(THU));
      // Mon, Tue, Wed have closed; Thursday is pending.
      expect(result.chargedThrough).toBe(WED);
      expect(line(result, 'overCap')).toMatchObject({ count: 3, perUnit: -10, points: -30 });
      expect(result.overCapDays).toBe(3);
      expect(result.pending).toMatchObject({ overCap: -10, overBy: 1 });
      expect(result.score).toBe(70);
    });

    it('scales with how far over the cap you are', () => {
      const base = activeSince(['a', 'b', 'c', 'd', 'e']);
      const result = week({ ...base, progressEvents: freshProgress(['a', 'b', 'c', 'd', 'e']) }, sgt(WED));
      expect(line(result, 'overCap').points).toBe(-40); // 2 over × Mon, Tue
    });

    it('is avoided by getting back under cap before the day closes', () => {
      const base = activeSince(['a', 'b', 'c', 'd']);
      const result = week(
        {
          ...base,
          stageEvents: [...base.stageEvents, ev('d', 'building', 'killed', MON, '21:00')],
          progressEvents: freshProgress(['a', 'b', 'c', 'd']),
        },
        sgt(WED),
      );
      expect(line(result, 'overCap').points).toBe(0);
      expect(line(result, 'decisiveKill').points).toBe(10);
      expect(result.score).toBe(100);
    });

    it('charges every day of a past week once it is over', () => {
      const base = activeSince(['a', 'b', 'c', 'd']);
      const lastWeek = week(
        { ...base, progressEvents: freshProgress(['a', 'b', 'c', 'd'], '2026-09-27') },
        sgt(WED),
        LAST_WEEK,
      );
      expect(lastWeek.chargedThrough).toBe('2026-10-04');
      expect(line(lastWeek, 'overCap').count).toBe(7);
      expect(lastWeek.pending.overCap).toBe(0);
      expect(lastWeek.score).toBe(30);
    });
  });

  /* --- §10.4: Monday reset --- */

  it('reads 100 on Monday morning regardless of last week', () => {
    // Over cap all of last week, a project stuck since mid-September, and a
    // pile of last-week penalties — none of it carries into the new week.
    const base = activeSince(['a', 'b', 'c', 'd']);
    const input: Partial<FocusWeekInput> = {
      projects: [...base.projects, proj('s', 'building', '2026-09-01'), proj('x', 'abandoned', LAST_WEEK)],
      stageEvents: [
        ...base.stageEvents,
        ev('s', 'shipped', 'building', '2026-09-01'),
        ev('x', null, 'idea', LAST_WEEK, '09:00'),
        ev('x', 'idea', 'building', LAST_WEEK, '10:00'),
        ev('x', 'building', 'abandoned', '2026-09-30'),
      ],
      progressEvents: freshProgress(['a', 'b', 'c', 'd']),
    };

    const lastWeek = week(input, sgt(SUN, '23:00'), LAST_WEEK);
    expect(lastWeek.score).toBe(0);

    const monday = week(input, sgt(MON, '07:30'));
    expect(monday.score).toBe(100);
    expect(monday.chargedThrough).toBeNull();
    // What WILL land at tonight's close if nothing changes:
    expect(monday.pending.overCap).toBe(-20); // 5 active, over by 2
    expect(monday.pending.stuckProjectIds).toEqual(['s']);
  });

  /* --- stuck: once per week, not per day --- */

  describe('stuck charge', () => {
    // 's' in Building, last progress 10 Sep ⇒ stuck since 24 Sep.
    const stuckInput: Partial<FocusWeekInput> = {
      projects: [proj('s', 'building', '2026-09-10')],
      stageEvents: [ev('s', 'shipped', 'building', '2026-09-10')],
    };

    it('charges a stuck project once per week, not once per day', () => {
      const result = week(stuckInput, sgt(SUN, '20:00'));
      expect(result.chargedThrough).toBe(SAT);
      expect(line(result, 'stuck')).toMatchObject({ count: 1, perUnit: -10, points: -10 });
      expect(result.stuckProjectIds).toEqual(['s']);
      expect(result.score).toBe(90);
    });

    it('is not charged if a Did-it clears it before the first close of the week', () => {
      const result = week({ ...stuckInput, progressEvents: [didIt('s', MON, '09:00')] }, sgt(FRI));
      expect(line(result, 'stuck').count).toBe(0);
      expect(result.pending.stuckProjectIds).toEqual([]);
    });

    it('stays charged once a day has closed with the project stuck', () => {
      // Stuck at the close of Monday, cleared Tuesday: still one charge, never two.
      const result = week({ ...stuckInput, progressEvents: [didIt('s', TUE)] }, sgt(SUN, '20:00'));
      expect(line(result, 'stuck').points).toBe(-10);
    });

    it('charges a project that goes stuck mid-week', () => {
      // Last progress 23 Sep ⇒ stuck from 7 Oct (Wednesday).
      const result = week(
        {
          projects: [proj('m', 'building', '2026-09-23')],
          stageEvents: [ev('m', 'shipped', 'building', '2026-09-23')],
        },
        sgt(FRI),
      );
      expect(line(result, 'stuck').count).toBe(1);
      const earlier = week(
        {
          projects: [proj('m', 'building', '2026-09-23')],
          stageEvents: [ev('m', 'shipped', 'building', '2026-09-23')],
        },
        sgt(WED, '12:00'),
      );
      expect(line(earlier, 'stuck').count).toBe(0);
      expect(earlier.pending.stuckProjectIds).toEqual(['m']);
    });

    it('does not judge a project by a stage it entered later in the week', () => {
      // An old Idea (ideas are never idle-stuck) started on Thursday.
      const result = week(
        {
          projects: [proj('i', 'building', THU, { created_at: sgt('2026-08-01') })],
          stageEvents: [ev('i', null, 'idea', '2026-08-01'), ev('i', 'idea', 'building', THU)],
        },
        sgt(SUN, '20:00'),
      );
      expect(line(result, 'stuck').count).toBe(0);
    });
  });

  /* --- exits --- */

  describe('exits', () => {
    it('scores done +20, decisive kill +10, abandon -25, idea kill 0', () => {
      const result = week(
        {
          projects: [
            proj('d', 'done', TUE),
            proj('k', 'killed', TUE),
            proj('i', 'killed', TUE),
            proj('x', 'abandoned', TUE),
          ],
          stageEvents: [
            ev('d', 'commercialising', 'done', TUE),
            ev('k', 'building', 'killed', TUE),
            ev('i', null, 'idea', '2026-09-01'),
            ev('i', 'idea', 'killed', TUE),
            ev('x', 'building', 'abandoned', TUE),
          ],
        },
        sgt(WED),
      );
      expect(line(result, 'done')).toMatchObject({ count: 1, points: 20 });
      expect(line(result, 'decisiveKill')).toMatchObject({ count: 1, points: 10 });
      expect(line(result, 'abandoned')).toMatchObject({ count: 1, points: -25 });
      expect(result.raw).toBe(105);
      expect(result.score).toBe(100);
    });

    it('still rewards a kill if the project reached Building earlier', () => {
      const result = week(
        {
          projects: [proj('p', 'killed', TUE)],
          stageEvents: [
            ev('p', 'idea', 'building', '2026-09-10'),
            ev('p', 'building', 'idea', '2026-09-12'),
            ev('p', 'idea', 'killed', TUE),
          ],
        },
        sgt(WED),
      );
      expect(line(result, 'decisiveKill').count).toBe(1);
    });

    it('makes start-over-cap-then-kill a net -5, cheaper than abandoning', () => {
      const base = activeSince(['a', 'b', 'c']);
      const shared = {
        projects: [...base.projects, proj('d', 'killed', TUE)],
        progressEvents: freshProgress(['a', 'b', 'c']),
      };
      const killed = week(
        {
          ...shared,
          stageEvents: [...base.stageEvents, ev('d', 'idea', 'building', TUE, '09:00'), ev('d', 'building', 'killed', TUE, '15:00')],
        },
        sgt(FRI),
      );
      expect(killed.score).toBe(95);

      const abandoned = week(
        {
          ...shared,
          stageEvents: [...base.stageEvents, ev('d', 'idea', 'building', TUE, '09:00'), ev('d', 'building', 'abandoned', TUE, '15:00')],
        },
        sgt(FRI),
      );
      expect(abandoned.score).toBe(60);
    });

    it('floors at 0 and keeps the raw total', () => {
      const ids = ['1', '2', '3', '4', '5'];
      const result = week(
        {
          projects: ids.map((id) => proj(id, 'abandoned', TUE)),
          stageEvents: ids.map((id) => ev(id, 'building', 'abandoned', TUE)),
        },
        sgt(WED),
      );
      expect(result.score).toBe(0);
      expect(result.raw).toBe(-25);
    });
  });

  /* --- did it --- */

  describe('did it', () => {
    it('adds +2 per tap, capped at +10 per day across projects', () => {
      const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
      const result = week(
        {
          projects: ids.map((id) => proj(id, 'building', '2026-10-01')),
          stageEvents: ids.map((id) => ev(id, 'shipped', 'building', '2026-10-01')),
          progressEvents: [...ids.map((id) => didIt(id, MON)), didIt('a', TUE), didIt('b', TUE)],
        },
        sgt(WED),
      );
      // Monday: 6 taps = 12, capped to 10. Tuesday: 2 taps = 4.
      expect(line(result, 'didIt')).toMatchObject({ count: 8, perUnit: 2, points: 14 });
    });

    it('visibly moves the meter when Focus is below 100 (§10.1)', () => {
      const base = activeSince(['a', 'b', 'c']);
      const input: Partial<FocusWeekInput> = {
        projects: [...base.projects, proj('d', 'building', TUE)],
        stageEvents: [...base.stageEvents, ev('d', 'idea', 'building', TUE, '09:00')],
        progressEvents: freshProgress(['a', 'b', 'c']),
      };
      const before = week(input, sgt(TUE, '12:00'));
      const after = week(
        { ...input, progressEvents: [...(input.progressEvents ?? []), didIt('a', TUE, '12:00')] },
        sgt(TUE, '12:01'),
      );
      expect(before.score).toBe(85);
      expect(after.score).toBe(87);
    });

    it('ignores taps from last week and taps after `now`', () => {
      const result = week(
        {
          projects: [proj('a', 'building', '2026-10-01')],
          stageEvents: [ev('a', 'shipped', 'building', '2026-10-01')],
          progressEvents: [didIt('a', '2026-10-04'), didIt('a', WED, '15:00')],
        },
        sgt(WED, '12:00'),
      );
      expect(line(result, 'didIt').count).toBe(0);
    });
  });

  /* --- §10.6: areas never affect WIP or Focus --- */

  describe('areas', () => {
    function area(id: string, stage: ProjectStage = 'building'): StuckProjectInput {
      return { ...proj(id, stage, '2026-08-01'), kind: 'area' };
    }

    it('are excluded from WIP, activation, over cap, stuck, exits and did-it', () => {
      const base = activeSince(['a', 'b', 'c']);
      const result = week(
        {
          projects: [...base.projects, area('soy'), area('splash', 'commercialising'), area('church', 'abandoned')],
          stageEvents: [
            ...base.stageEvents,
            // Would be a 4th and 5th active project, both "started over cap".
            ev('soy', 'idea', 'building', MON),
            ev('splash', null, 'commercialising', MON),
            ev('church', 'building', 'abandoned', TUE),
          ],
          // 'soy' has had no progress since August — it would be stuck.
          progressEvents: [...freshProgress(['a', 'b', 'c']), didIt('splash', TUE)],
        },
        sgt(FRI),
      );
      expect(result.lines.every((l) => l.count === 0)).toBe(true);
      expect(result.score).toBe(100);
      expect(result.pending.overBy).toBe(0);
    });

    it('never count toward the WIP number or the reward gate', () => {
      const rows: { stage: ProjectStage; kind: ProjectKind; stuck_since: string | null }[] = [
        { stage: 'building', kind: 'project', stuck_since: null },
        { stage: 'building', kind: 'project', stuck_since: null },
        { stage: 'commercialising', kind: 'project', stuck_since: null },
        { stage: 'building', kind: 'area', stuck_since: null },
        { stage: 'commercialising', kind: 'area', stuck_since: null },
      ];
      expect(countActiveProjects(rows)).toBe(3);
      expect(rewardGate(rows)).toMatchObject({ activeCount: 3, isOverCap: false, locked: false });
    });

    it('treats a row with no kind (pre-migration) as a project', () => {
      expect(projectKindOf({})).toBe('project');
      expect(projectKindOf({ kind: null })).toBe('project');
      expect(projectKindOf({ kind: 'area' })).toBe('area');
    });
  });
});

/* ------------------------------------------------------------------ */
/* Over-cap replay                                                     */
/* ------------------------------------------------------------------ */

describe('countOverCapProjectDays', () => {
  it('uses the LAST event of a day when a project moves twice in one day', () => {
    // Created (→ Idea) and moved into Building the same day, handed over newest first.
    const events: FocusEventInput[] = [
      ev('d', 'idea', 'building', MON, '12:00'),
      ev('d', null, 'idea', MON, '11:00'),
      ...activeSince(['a', 'b', 'c']).stageEvents,
    ];
    const result = countOverCapProjectDays(events, [MON, TUE]);
    expect(result.perDay).toEqual([
      { date: MON, activeCount: 4, overBy: 1 },
      { date: TUE, activeCount: 4, overBy: 1 },
    ]);
    expect(result.total).toBe(2);
  });

  it('skips areas when their ids are passed', () => {
    const events = activeSince(['a', 'b', 'c', 'area']).stageEvents;
    expect(countOverCapProjectDays(events, [MON]).total).toBe(1);
    expect(countOverCapProjectDays(events, [MON], config, ['area']).total).toBe(0);
  });

  it('counts an imported project only from its real event day', () => {
    const events = [
      ...activeSince(['a', 'b', 'c']).stageEvents,
      ev('imp', null, 'building', WED, '10:00', `${IMPORT_EVENT_MARKER} started 2026-05-01`),
    ];
    const result = countOverCapProjectDays(events, [MON, TUE, WED]);
    expect(result.perDay.map((d) => d.overBy)).toEqual([0, 0, 1]);
  });
});

/* ------------------------------------------------------------------ */
/* Stuck — §2                                                          */
/* ------------------------------------------------------------------ */

describe('isStuck / stuckSince', () => {
  it('is stuck after 14 days with no progress signal in Building/Shipped/Commercialising', () => {
    for (const stage of ['building', 'shipped', 'commercialising'] as const) {
      const p = proj('p', stage, '2026-09-20');
      expect(isStuck(p, [], [], '2026-10-03')).toBe(false); // 13 days
      expect(stuckSince(p, [], [], '2026-10-04')).toBe('2026-10-04'); // 14 days
      expect(stuckSince(p, [], [], sgt(WED))).toBe('2026-10-04');
    }
  });

  it('never idle-sticks an Idea, an area, or a finished project', () => {
    expect(isStuck(proj('i', 'idea', '2026-01-01'), [], [], WED)).toBe(false);
    expect(isStuck({ ...proj('a', 'building', '2026-01-01'), kind: 'area' }, [], [], WED)).toBe(false);
    expect(isStuck(proj('d', 'done', '2026-01-01'), [], [], WED)).toBe(false);
  });

  it('counts every progress signal: did it, commit, next action, stage', () => {
    const p = proj('p', 'building', '2026-08-01');
    expect(isStuck(p, [], [], WED)).toBe(true);
    for (const kind of ['did_it', 'commit', 'next_action', 'stage'] as const) {
      expect(isStuck(p, [{ project_id: 'p', kind, day: '2026-09-30' }], [], WED)).toBe(false);
    }
    // Someone else's progress does not count.
    expect(isStuck(p, [{ project_id: 'q', kind: 'did_it', day: WED }], [], WED)).toBe(true);
  });

  it('uses the next-action clock on the row as a progress signal', () => {
    const p = proj('p', 'building', '2026-08-01', { next_action_updated_at: sgt('2026-10-01') });
    expect(isStuck(p, [], [], WED)).toBe(false);
  });

  it('is cleared by a Did-it tap immediately (§10.2)', () => {
    const p = proj('p', 'building', '2026-08-01');
    expect(isStuck(p, [], [], sgt(WED, '09:00'))).toBe(true);
    expect(isStuck(p, [didIt('p', WED, '09:01')], [], sgt(WED, '09:02'))).toBe(false);
  });

  it('flags a passed key date with no progress since, in any non-terminal stage', () => {
    const idea = proj('i', 'idea', '2026-09-01');
    const keyDates = [{ project_id: 'i', date: MON }];
    expect(isStuck(idea, [], keyDates, '2026-10-04')).toBe(false); // not yet
    expect(stuckSince(idea, [], keyDates, TUE)).toBe(MON);
    // Progress after the key date clears it.
    expect(isStuck(idea, [didIt('i', TUE)], keyDates, WED)).toBe(false);
    // Progress before the key date does not.
    expect(isStuck(idea, [didIt('i', '2026-10-04')], keyDates, WED)).toBe(true);
    // Done/killed projects are never stuck.
    expect(isStuck(proj('i', 'done', '2026-09-01'), [], keyDates, WED)).toBe(false);
  });

  it('reports the earliest of the idle and key-date rules', () => {
    const p = proj('p', 'building', '2026-09-01'); // idle-stuck from 15 Sep
    expect(stuckSince(p, [], [{ project_id: 'p', date: '2026-09-10' }], WED)).toBe('2026-09-10');
    expect(stuckSince(p, [], [{ project_id: 'p', date: '2026-09-20' }], WED)).toBe('2026-09-15');
  });
});

/* ------------------------------------------------------------------ */
/* Today's move — §1                                                   */
/* ------------------------------------------------------------------ */

describe('pickTodaysMove', () => {
  function mv(
    id: string,
    extra: Partial<TodaysMoveProjectInput> = {},
  ): TodaysMoveProjectInput {
    return {
      ...proj(id, 'building', '2026-09-30'),
      name: id.toUpperCase(),
      next_action: `Next for ${id}`,
      stage_target_date: null,
      stuck_since: null,
      ...extra,
    };
  }

  function pick(
    projects: TodaysMoveProjectInput[],
    progress: ProgressEventInput[] = [],
    moves: DailyMoveInput[] = [],
    day = WED,
  ) {
    return pickTodaysMove(projects, progress, moves, day);
  }

  function winner(result: ReturnType<typeof pick>): string {
    if (result.status !== 'move') throw new Error(`expected a move, got ${result.status}`);
    return result.project.id;
  }

  it('puts a stuck project first, ahead of a nearer target date', () => {
    const result = pick([
      mv('target', { stage_target_date: THU }),
      mv('stuck', { stuck_since: '2026-10-01', stage_target_date: '2026-12-01' }),
    ]);
    expect(winner(result)).toBe('stuck');
    expect(result.status === 'move' && result.reason).toBe('stuck');
  });

  it('then the nearest target date', () => {
    const result = pick([
      mv('later', { stage_target_date: '2026-11-01' }),
      mv('none'),
      mv('soon', { stage_target_date: FRI }),
    ]);
    expect(winner(result)).toBe('soon');
    expect(result.status === 'move' && result.upNext.map((p) => p.id)).toEqual(['later', 'none']);
    expect(result.status === 'move' && result.reason).toBe('target');
  });

  it('then the longest since last progress', () => {
    const result = pick(
      [mv('fresh'), mv('stale'), mv('mid')],
      [
        { project_id: 'fresh', kind: 'did_it', day: TUE },
        { project_id: 'mid', kind: 'commit', day: '2026-10-03' },
      ],
    );
    // 'stale' last progressed on 30 Sep (its row clocks).
    expect(winner(result)).toBe('stale');
    expect(result.status === 'move' && result.upNext.map((p) => p.id)).toEqual(['mid', 'fresh']);
    expect(result.status === 'move' && result.reason).toBe('idle');
  });

  it('then round-robin: the one least recently on the card', () => {
    const projects = [mv('a'), mv('b'), mv('c')]; // identical progress
    const moves: DailyMoveInput[] = [
      { day: MON, project_id: 'a', outcome: 'skipped' },
      { day: TUE, project_id: 'b', outcome: 'skipped' },
    ];
    const result = pick(projects, [], moves);
    expect(winner(result)).toBe('c'); // never shown
    expect(result.status === 'move' && result.upNext.map((p) => p.id)).toEqual(['a', 'b']);
    expect(result.status === 'move' && result.reason).toBe('rotation');
  });

  it("doesn't bring a skipped project back the same day, but does tomorrow", () => {
    const projects = [mv('a', { stuck_since: '2026-10-01' }), mv('b')];
    const skipped: DailyMoveInput[] = [{ day: WED, project_id: 'a', outcome: 'skipped' }];
    expect(winner(pick(projects, [], skipped, WED))).toBe('b');
    expect(winner(pick(projects, [], skipped, THU))).toBe('a');
  });

  it('advances past a project that was done today', () => {
    const projects = [mv('a'), mv('b')];
    const result = pick(projects, [didIt('a', WED)], [{ day: WED, project_id: 'a', outcome: 'did_it' }]);
    expect(winner(result)).toBe('b');
    expect(result.status === 'move' && result.doneToday).toBe(1);
  });

  it('says so when every move is made for today', () => {
    const result = pick(
      [mv('a'), mv('b')],
      [],
      [
        { day: WED, project_id: 'a', outcome: 'did_it' },
        { day: WED, project_id: 'b', outcome: 'skipped' },
      ],
    );
    expect(result).toMatchObject({ status: 'all_done', doneToday: 1, skippedToday: 1 });
  });

  it('includes areas in the rotation but never treats them as stuck', () => {
    const area = mv('soy', { kind: 'area', stage: 'idea', stuck_since: '2026-09-01' });
    const result = pick([area, mv('p', { stage_target_date: '2026-12-01' })]);
    // The area's stale stuck_since must not jump it ahead; the target date wins.
    expect(winner(result)).toBe('p');
    expect(result.status === 'move' && result.upNext[0]).toMatchObject({ id: 'soy', kind: 'area', isStuck: false });
  });

  it('only rotates active projects: no ideas, shipped or finished work while something is active', () => {
    const result = pick([
      mv('idea', { stage: 'idea' }),
      mv('shipped', { stage: 'shipped' }),
      mv('done', { stage: 'done' }),
      mv('live', { stage: 'commercialising' }),
    ]);
    expect(winner(result)).toBe('live');
    expect(result.status === 'move' && result.upNext).toEqual([]);
  });

  it('offers the top Idea with its price when nothing is active', () => {
    const result = pick([
      mv('later', { stage: 'idea', stage_target_date: '2026-12-01' }),
      mv('sooner', { stage: 'idea', stage_target_date: '2026-11-01' }),
      mv('old', { stage: 'killed' }),
    ]);
    expect(result).toMatchObject({ status: 'start_idea', copy: 'Start this?' });
    expect(result.status === 'start_idea' && result.project.id).toBe('sooner');
    expect(result.status === 'start_idea' && result.cost).toMatchObject({ activeCountAfter: 1, copy: '' });
  });

  it('is calm when nothing is in flight', () => {
    expect(pick([mv('x', { stage: 'done' })])).toEqual({ status: 'empty', copy: 'Nothing in flight. Good.' });
  });

  it('decorates the card with days in stage, target and progress', () => {
    const result = pick([mv('a', { stage_target_date: SAT })], [didIt('a', MON)]);
    expect(result.status === 'move' && result.project).toMatchObject({
      daysInStage: 7,
      daysToTarget: 3,
      lastProgressDay: MON,
      daysSinceProgress: 2,
    });
  });
});

/* ------------------------------------------------------------------ */
/* Counters — up-only                                                  */
/* ------------------------------------------------------------------ */

describe('computeCounters', () => {
  const SEASON = sgt('2026-09-21', '12:00'); // a Monday, midday

  const stageEvents: FocusEventInput[] = [
    // Lifetime only (before the season):
    ev('old', 'commercialising', 'done', '2026-09-02'),
    ev('oldk', 'building', 'killed', '2026-09-03'),
    // This season:
    ev('p1', 'commercialising', 'done', '2026-09-22'),
    ev('p2', 'building', 'killed', '2026-09-23'),
    ev('p3', 'idea', 'killed', '2026-09-24'), // neutral, not "on purpose"
    // An area finishing never counts.
    ev('area', 'building', 'done', '2026-09-25'),
  ];
  const didItEvents: ProgressEventInput[] = [
    { project_id: 'p1', kind: 'did_it', day: '2026-09-01' },
    { project_id: 'p1', kind: 'did_it', day: '2026-09-22' },
    { project_id: 'p2', kind: 'did_it', day: '2026-09-22' }, // same day, one did-it day
    { project_id: 'area', kind: 'did_it', day: '2026-09-23' }, // areas count as showing up
    { project_id: 'p1', kind: 'commit', day: '2026-09-24' }, // not a did-it
  ];

  it('counts finished, decisive kills and did-it days per season and lifetime', () => {
    const result = computeCounters({ stageEvents, didItEvents, areaIds: ['area'] }, SEASON, sgt(WED));
    expect(result.seasonStart).toBe('2026-09-21');
    expect(result.season).toMatchObject({ finished: 1, decisiveKills: 1, didItDays: 2 });
    expect(result.lifetime).toMatchObject({ finished: 2, decisiveKills: 2, didItDays: 3 });
  });

  it('restarts season counters when a new season starts, keeping lifetime intact (§10.7)', () => {
    const before = computeCounters({ stageEvents, didItEvents, areaIds: ['area'] }, SEASON, sgt(WED));
    const after = computeCounters({ stageEvents, didItEvents, areaIds: ['area'] }, sgt(WED, '09:00'), sgt(WED, '10:00'));
    expect(after.season).toEqual({ finished: 0, decisiveKills: 0, didItDays: 0, weeksUnderCap: 0 });
    expect(after.lifetime).toEqual(before.lifetime);
  });

  it('counts only completed weeks under cap, never the week in progress', () => {
    // 4 active from Wed 16 Sep to Thu 24 Sep (killed then), under cap otherwise.
    const events: FocusEventInput[] = [
      ...activeSince(['a', 'b', 'c'], '2026-09-01').stageEvents,
      ev('d', null, 'building', '2026-09-16'),
      ev('d', 'building', 'killed', '2026-09-24'),
    ];
    // Weeks: 31 Aug (from 1 Sep) ✓, 7 Sep ✓, 14 Sep ✗, 21 Sep ✗, 28 Sep ✓ — current week (5 Oct) excluded.
    const lifetime = computeCounters({ stageEvents: events, didItEvents: [] }, null, sgt(WED)).lifetime;
    expect(lifetime.weeksUnderCap).toBe(3);
    // Season from 21 Sep: 21 Sep ✗, 28 Sep ✓.
    const season = computeCounters({ stageEvents: events, didItEvents: [] }, '2026-09-21', sgt(WED)).season;
    expect(season.weeksUnderCap).toBe(1);
    // A week in progress cannot be counted yet, so the number can't go down later.
    const sunday = computeCounters({ stageEvents: events, didItEvents: [] }, null, sgt(SUN, '23:00')).lifetime;
    expect(sunday.weeksUnderCap).toBe(3);
  });

  it('equals lifetime when there is no season', () => {
    const result = computeCounters({ stageEvents, didItEvents }, null, sgt(WED));
    expect(result.season).toEqual(result.lifetime);
    expect(result.seasonStart).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Sunday review + seasons                                             */
/* ------------------------------------------------------------------ */

describe('review week and banner (§4, §10.5)', () => {
  it('reviews the week ending today on Sunday, and the week just ended on Monday', () => {
    expect(reviewWeekFor(SUN)).toBe(MON);
    expect(reviewWeekFor('2026-10-12')).toBe(MON);
    expect(reviewWeekFor(WED)).toBe(LAST_WEEK);
  });

  it('shows the banner on Sunday and Monday until that week is completed', () => {
    expect(reviewDueFor(SUN, null)).toEqual({ weekStart: MON, due: true, completedAt: null });
    expect(reviewDueFor('2026-10-12', null).due).toBe(true);
    expect(reviewDueFor('2026-10-12', sgt(SUN, '20:00')).due).toBe(false);
    expect(reviewDueFor('2026-10-13', null).due).toBe(false); // Tuesday: not a gate, not nagging
    expect(reviewDueFor(SAT, null).due).toBe(false);
  });
});

describe('isVisibleInSeason (§7, §10.7)', () => {
  const season = sgt(WED, '09:00');
  it("hides last season's terminal projects and keeps everything else", () => {
    expect(isVisibleInSeason({ stage: 'done', stage_changed_at: sgt(TUE) }, season)).toBe(false);
    expect(isVisibleInSeason({ stage: 'killed', stage_changed_at: sgt(TUE) }, season)).toBe(false);
    expect(isVisibleInSeason({ stage: 'done', stage_changed_at: sgt(THU) }, season)).toBe(true);
    expect(isVisibleInSeason({ stage: 'building', stage_changed_at: '2026-01-01T00:00:00Z' }, season)).toBe(true);
    expect(isVisibleInSeason({ stage: 'idea', stage_changed_at: '2026-01-01T00:00:00Z' }, season)).toBe(true);
    expect(isVisibleInSeason({ stage: 'done', stage_changed_at: sgt(TUE) }, null)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Reward gate + cost copy                                             */
/* ------------------------------------------------------------------ */

describe('rewardGate', () => {
  it('locks only while over cap — stuck no longer locks', () => {
    const three = [
      { stage: 'building', stuck_since: '2026-09-01' },
      { stage: 'building', stuck_since: null },
      { stage: 'commercialising', stuck_since: null },
    ];
    expect(rewardGate(three)).toMatchObject({ locked: false, hasStuckProject: true, isOverCap: false });
    expect(rewardGate([...three, { stage: 'building', stuck_since: null }])).toMatchObject({
      locked: true,
      isOverCap: true,
      activeCount: 4,
    });
  });
});

describe('describeActivationCost', () => {
  it('is free at or under the cap', () => {
    expect(describeActivationCost(2, { isNewBuild: true })).toMatchObject({ level: 'under', copy: '' });
    expect(describeActivationCost(3, { isNewBuild: true })).toMatchObject({ level: 'at', copy: '' });
  });

  it('prices the 4th active project up front', () => {
    expect(describeActivationCost(4, { isNewBuild: true })).toMatchObject({
      level: 'over',
      overBy: 1,
      copy: 'This takes you to 4 of 3 active: -15 Focus now, -10/day while over cap, rewards locked.',
    });
  });

  it('drops the -15 for a move that is not a start', () => {
    expect(describeActivationCost(5).copy).toBe(
      'This takes you to 5 of 3 active: -20/day while over cap, rewards locked.',
    );
  });
});

describe('describeStageMoveCost', () => {
  it('prices a start from Idea like any activation', () => {
    expect(describeStageMoveCost('idea', 'building', 2)).toMatchObject({
      isActivation: true,
      activeCountAfter: 3,
      copy: '',
    });
    expect(describeStageMoveCost('idea', 'commercialising', 3)).toMatchObject({
      isActivation: true,
      overBy: 1,
      copy: 'This takes you to 4 of 3 active: -15 Focus now, -10/day while over cap, rewards locked.',
    });
  });

  it('never charges Shipped -> Commercialising as an activation', () => {
    // Under / at the cap: free, no copy at all.
    expect(describeStageMoveCost('shipped', 'commercialising', 2)).toMatchObject({
      isActivation: false,
      activeCountAfter: 3,
      level: 'at',
      copy: '',
    });
    // Over the cap: it does add an active project, so the bleed is real — but
    // the copy says plainly there is no activation charge and has no -15.
    const over = describeStageMoveCost('shipped', 'commercialising', 3);
    expect(over).toMatchObject({ isActivation: false, activeCountAfter: 4, overBy: 1 });
    expect(over.copy).toBe(
      'No activation charge, but this takes you to 4 of 3 active: -10/day while over cap, rewards locked.',
    );
    expect(over.copy).not.toContain('-15');
  });

  it('says nothing about the bleed when the move does not change the over-cap state', () => {
    // Building -> Commercialising while already 4 of 3: count unchanged.
    expect(describeStageMoveCost('building', 'commercialising', 4)).toMatchObject({
      isActivation: false,
      activeCountAfter: 4,
      level: 'over',
      copy: '',
    });
    // Commercialising -> Shipped from 5 of 3: it lowers the count.
    expect(describeStageMoveCost('commercialising', 'shipped', 5)).toMatchObject({
      isActivation: false,
      activeCountAfter: 4,
      copy: '',
    });
    // Idea -> Shipped never touches the active set.
    expect(describeStageMoveCost('idea', 'shipped', 4).copy).toBe('');
  });
});

describe('describeImportImpact', () => {
  it('prices an import over cap without an entry charge', () => {
    expect(describeImportImpact(4).copy).toBe(
      'This puts you at 4 of 3 active. No charge for importing, but the -10/day bleed starts tonight. Finish or kill something.',
    );
    expect(describeImportImpact(3).copy).toBe('');
  });
});

describe('describeKillBonus', () => {
  it('describes the bonus for Building or beyond, nothing for Ideas', () => {
    expect(describeKillBonus('building')).toBe('Decisive kill: +10 Focus');
    expect(describeKillBonus('commercialising')).toBe('Decisive kill: +10 Focus');
    expect(describeKillBonus('idea')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Flow — live, v1 formula                                             */
/* ------------------------------------------------------------------ */

describe('computeFlow', () => {
  const AS_OF = '2026-08-28';
  const WINDOW = ['2026-08-22', '2026-08-23', '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'];
  const BIBLE: FlowRoutineInput = { id: 'bible', name: 'Bible', cadence: 'daily', weekly_target: 7, active: true };
  const DOG: FlowRoutineInput = { id: 'dog', name: 'Dog walk', cadence: 'daily', weekly_target: 5, active: true };
  const WORKOUTS: FlowRoutineInput = { id: 'workouts', name: 'Workouts', cadence: 'weekly', weekly_target: 3, active: true };
  const SABBATH: FlowRoutineInput = { id: 'sabbath', name: 'Sabbath', cadence: 'weekly', weekly_target: 1, active: true, is_sabbath: true };
  const ticks = (routineId: string, dates: string[], count = 1): FlowCheckInput[] =>
    dates.map((date) => ({ routine_id: routineId, date, count }));

  it('is 100 when there are no active routines', () => {
    expect(computeFlowScore({ routines: [], checks: [], asOf: AS_OF })).toBe(config.flow.scoreWhenNoRoutines);
  });

  it('scores a perfect week at 100 and weights routines equally', () => {
    expect(
      computeFlow({
        routines: [BIBLE, DOG, WORKOUTS],
        checks: [
          ...ticks(BIBLE.id, WINDOW),
          ...ticks(DOG.id, WINDOW.slice(0, 5)),
          ...ticks(WORKOUTS.id, ['2026-08-24', '2026-08-26', '2026-08-28']),
        ],
        asOf: AS_OF,
      }).score,
    ).toBe(100);
    expect(computeFlow({ routines: [BIBLE, WORKOUTS], checks: ticks(BIBLE.id, WINDOW), asOf: AS_OF }).score).toBe(50);
  });

  it('moves on the same tap (live, rolling 7 days)', () => {
    const before = computeFlow({ routines: [WORKOUTS], checks: ticks(WORKOUTS.id, ['2026-08-24']), asOf: AS_OF });
    const after = computeFlow({
      routines: [WORKOUTS],
      checks: ticks(WORKOUTS.id, ['2026-08-24', '2026-08-28']),
      asOf: AS_OF,
    });
    expect(after.score).toBeGreaterThan(before.score);
  });

  it('excludes sabbath days from the denominator, never from the numerator', () => {
    const missed = '2026-08-23';
    const six = WINDOW.filter((d) => d !== missed);
    expect(computeFlow({ routines: [BIBLE], checks: ticks(BIBLE.id, six), asOf: AS_OF }).score).toBe(86);
    const withSabbath = computeFlow({
      routines: [BIBLE, SABBATH],
      checks: [...ticks(BIBLE.id, six), ...ticks(SABBATH.id, [missed])],
      asOf: AS_OF,
    });
    expect(withSabbath.routines[0]).toMatchObject({ target: 6, actual: 6 });
    expect(withSabbath.score).toBe(100);

    const dog = computeFlow({
      routines: [DOG, SABBATH],
      checks: [...ticks(DOG.id, ['2026-08-22', missed, '2026-08-24', '2026-08-25']), ...ticks(SABBATH.id, [missed])],
      asOf: AS_OF,
    }).routines.find((r) => r.id === DOG.id)!;
    expect(dog.actual).toBe(4);
    expect(dog.target).toBeCloseTo(5 * (6 / 7), 5);
  });

  it('ignores checks outside the window and inactive routines', () => {
    const result = computeFlow({
      routines: [BIBLE, { ...WORKOUTS, active: false }],
      checks: [...ticks(BIBLE.id, WINDOW), ...ticks(BIBLE.id, ['2026-08-01'])],
      asOf: AS_OF,
    });
    expect(result.routines).toHaveLength(1);
    expect(result.score).toBe(100);
  });
});

/* ------------------------------------------------------------------ */
/* Clock skew: read-after-write must see the write                     */
/* ------------------------------------------------------------------ */

describe('reconcileLiveNow (database clock ahead of the app clock)', () => {
  // The app clock reads 12:00:00.000 SGT on Wednesday; Postgres stamped the
  // Did-it it just committed 80 ms later than that.
  const appClock = new Date(sgt(WED, '12:00'));
  const skewed = new Date(appClock.getTime() + 80).toISOString();
  const wall = appClock.getTime();

  it('regression: a Did-it stamped a hair ahead of `now` is dropped by the raw live Focus', () => {
    const input: Partial<FocusWeekInput> = {
      projects: [proj('a', 'building', '2026-10-01')],
      stageEvents: [ev('a', 'shipped', 'building', '2026-10-01')],
      progressEvents: [{ project_id: 'a', kind: 'did_it', day: WED, created_at: skewed }],
    };
    expect(line(week(input, appClock), 'didIt').count).toBe(0); // the bug
    const reconciled = reconcileLiveNow(appClock, [skewed], wall);
    expect(line(week(input, reconciled), 'didIt').count).toBe(1); // the fix
  });

  it('moves a live now forward to the newest row stamp within tolerance', () => {
    const result = reconcileLiveNow(appClock, [null, skewed, sgt(WED, '11:00')], wall);
    expect(new Date(result).toISOString()).toBe(skewed);
  });

  it('leaves now alone when nothing is ahead of it', () => {
    expect(reconcileLiveNow(appClock, [sgt(WED, '11:59')], wall)).toBe(appClock);
    expect(reconcileLiveNow(appClock, [], wall)).toBe(appClock);
  });

  it('ignores stamps further ahead than the tolerance (a bad row cannot drag now forward)', () => {
    const far = new Date(wall + CLOCK_SKEW_TOLERANCE_MS + 1_000).toISOString();
    expect(reconcileLiveNow(appClock, [far], wall)).toBe(appClock);
  });

  it('never touches a historical or day-level now, so "as of" views still hide later rows', () => {
    const past = new Date(sgt(TUE, '12:00'));
    expect(reconcileLiveNow(past, [skewed], wall)).toBe(past);
    expect(reconcileLiveNow('2026-10-07', [skewed], wall)).toBe('2026-10-07');
  });
});
