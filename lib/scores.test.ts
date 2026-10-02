import { describe, expect, it } from 'vitest';

import { config } from './config';
import {
  IMPORT_EVENT_MARKER,
  computeFlowScore,
  computeFocusScore,
  countOverCapProjectDays,
  describeActivationCost,
  describeImportImpact,
  describeKillBonus,
  explainFlowScore,
  explainFocusScore,
  type FlowCheckInput,
  type FlowRoutineInput,
  type FocusEventInput,
} from './scores';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const AS_OF = '2026-08-28';
/** The 7 days of the default Flow window ending on AS_OF. */
const WINDOW = [
  '2026-08-22',
  '2026-08-23',
  '2026-08-24',
  '2026-08-25',
  '2026-08-26',
  '2026-08-27',
  '2026-08-28',
];

const BIBLE: FlowRoutineInput = {
  id: 'bible',
  name: 'Bible / quiet time',
  cadence: 'daily',
  weekly_target: 7,
  active: true,
};

const DOG_WALK: FlowRoutineInput = {
  id: 'dog',
  name: 'Dog walk',
  cadence: 'daily',
  weekly_target: 5,
  active: true,
};

const WORKOUTS: FlowRoutineInput = {
  id: 'workouts',
  name: 'Workouts',
  cadence: 'weekly',
  weekly_target: 3,
  active: true,
};

const SABBATH: FlowRoutineInput = {
  id: 'sabbath',
  name: 'Sabbath',
  cadence: 'weekly',
  weekly_target: 1,
  active: true,
  is_sabbath: true,
};

function ticks(routineId: string, dates: string[], count = 1): FlowCheckInput[] {
  return dates.map((date) => ({ routine_id: routineId, date, count }));
}

/* ------------------------------------------------------------------ */
/* Flow score                                                          */
/* ------------------------------------------------------------------ */

describe('computeFlowScore', () => {
  it('is 100 when there are no active routines', () => {
    expect(computeFlowScore({ routines: [], checks: [], asOf: AS_OF })).toBe(
      config.flow.scoreWhenNoRoutines,
    );
  });

  it('scores a perfect week at 100', () => {
    const score = computeFlowScore({
      routines: [BIBLE, DOG_WALK, WORKOUTS],
      checks: [
        ...ticks(BIBLE.id, WINDOW),
        ...ticks(DOG_WALK.id, WINDOW.slice(0, 5)),
        ...ticks(WORKOUTS.id, ['2026-08-24', '2026-08-26', '2026-08-28']),
      ],
      asOf: AS_OF,
    });
    expect(score).toBe(100);
  });

  it('weights every routine equally', () => {
    // Bible perfect (1.0), workouts untouched (0.0) ⇒ mean 0.5.
    const score = computeFlowScore({
      routines: [BIBLE, WORKOUTS],
      checks: ticks(BIBLE.id, WINDOW),
      asOf: AS_OF,
    });
    expect(score).toBe(50);
  });

  /* --- sabbath exclusion, PRD §5.2.2 + §6.1 --- */

  it('excludes sabbath days from the denominator', () => {
    // Six days of Bible, one day missed. Without a sabbath that is 6/7.
    const missedDay = '2026-08-23';
    const sixDays = WINDOW.filter((d) => d !== missedDay);

    const withoutSabbath = explainFlowScore({
      routines: [BIBLE],
      checks: ticks(BIBLE.id, sixDays),
      asOf: AS_OF,
    });
    expect(withoutSabbath.routines[0].target).toBe(7);
    expect(withoutSabbath.routines[0].actual).toBe(6);
    expect(withoutSabbath.score).toBe(86); // round(6/7 * 100)

    // Mark the missed day as sabbath: the denominator drops to 6, so the same
    // six ticks are now a perfect week.
    const withSabbath = explainFlowScore({
      routines: [BIBLE, SABBATH],
      checks: [...ticks(BIBLE.id, sixDays), ...ticks(SABBATH.id, [missedDay])],
      asOf: AS_OF,
    });
    expect(withSabbath.sabbathDays).toEqual([missedDay]);
    expect(withSabbath.routines[0].target).toBe(6);
    expect(withSabbath.routines[0].actual).toBe(6);
    expect(withSabbath.score).toBe(100); // bible 1.0, sabbath 1.0
  });

  it('pro-rates weekly targets by the number of non-sabbath days', () => {
    const result = explainFlowScore({
      routines: [WORKOUTS, SABBATH],
      checks: [
        ...ticks(WORKOUTS.id, ['2026-08-24', '2026-08-26']),
        ...ticks(SABBATH.id, ['2026-08-23']),
      ],
      asOf: AS_OF,
    });
    const workouts = result.routines.find((r) => r.id === WORKOUTS.id)!;
    expect(workouts.target).toBeCloseTo(3 * (6 / 7), 5); // 2.571…
    expect(workouts.actual).toBe(2);
    expect(workouts.rate).toBeCloseTo(2 / (3 * (6 / 7)), 5);
  });

  it('never scores the sabbath routine against its own exclusion', () => {
    const result = explainFlowScore({
      routines: [SABBATH],
      checks: ticks(SABBATH.id, ['2026-08-23']),
      asOf: AS_OF,
    });
    const sabbath = result.routines[0];
    expect(sabbath.target).toBe(1);
    expect(sabbath.rate).toBe(1);
    expect(result.score).toBe(100);
  });

  it('counts ticks that land on a sabbath day towards the numerator', () => {
    // Sabbath excludes days from denominators only — doing the work anyway is a bonus.
    const result = explainFlowScore({
      routines: [DOG_WALK, SABBATH],
      checks: [
        ...ticks(DOG_WALK.id, ['2026-08-22', '2026-08-23', '2026-08-24', '2026-08-25']),
        ...ticks(SABBATH.id, ['2026-08-23']),
      ],
      asOf: AS_OF,
    });
    const dog = result.routines.find((r) => r.id === DOG_WALK.id)!;
    expect(dog.actual).toBe(4); // includes the sabbath-day walk
    expect(dog.target).toBeCloseTo(5 * (6 / 7), 5);
    expect(dog.rate).toBeCloseTo(4 / (5 * (6 / 7)), 5);
  });

  it('ignores checks outside the rolling window and inactive routines', () => {
    const result = explainFlowScore({
      routines: [BIBLE, { ...WORKOUTS, active: false }],
      checks: [...ticks(BIBLE.id, WINDOW), ...ticks(BIBLE.id, ['2026-08-01'])],
      asOf: AS_OF,
    });
    expect(result.routines).toHaveLength(1);
    expect(result.routines[0].actual).toBe(7);
    expect(result.score).toBe(100);
  });
});

/* ------------------------------------------------------------------ */
/* Focus score                                                         */
/* ------------------------------------------------------------------ */

describe('computeFocusScore', () => {
  const empty = { events: [], stuckProjects: [], asOf: AS_OF };

  /** A stage event, with sensible defaults. */
  function ev(
    project_id: string,
    from_stage: FocusEventInput['from_stage'],
    to_stage: FocusEventInput['to_stage'],
    day: string,
  ): FocusEventInput {
    return { project_id, from_stage, to_stage, created_at: `${day}T02:00:00Z` };
  }

  it('starts at 100 with nothing going on', () => {
    expect(computeFocusScore(empty)).toBe(config.focus.startingScore);
  });

  it('charges 15 per new project moved into Building', () => {
    const score = computeFocusScore({
      ...empty,
      events: [
        ev('p1', 'idea', 'building', '2026-08-20'),
        ev('p2', null, 'building', '2026-08-25'),
      ],
    });
    expect(score).toBe(70);
  });

  it('does not charge for returning to Building from a later stage', () => {
    const score = computeFocusScore({
      ...empty,
      events: [ev('p1', 'shipped', 'building', '2026-08-25')],
    });
    expect(score).toBe(100);
  });

  it('ignores events older than the 30-day window', () => {
    const score = computeFocusScore({
      ...empty,
      events: [ev('p1', 'idea', 'building', '2026-06-01'), ev('p1', 'building', 'done', '2026-06-05')],
    });
    expect(score).toBe(100);
  });

  it('charges 25 per abandoned project', () => {
    const score = computeFocusScore({
      ...empty,
      events: [ev('p1', 'building', 'abandoned', '2026-08-10')],
    });
    expect(score).toBe(75);
  });

  /* --- stuck recurrence, PRD §6.2.2 --- */

  describe('stuck recurrence', () => {
    it('charges 10 once as soon as a project is stuck', () => {
      expect(
        computeFocusScore({ ...empty, stuckProjects: [{ id: 'a', stuck_since: AS_OF }] }),
      ).toBe(90);
    });

    it('charges again for every full recurrence period the project stays stuck', () => {
      // recurrence period = 7 days by default
      expect(
        computeFocusScore({ ...empty, stuckProjects: [{ id: 'a', stuck_since: '2026-08-22' }] }),
      ).toBe(90); // 6 days stuck ⇒ 1 charge
      expect(
        computeFocusScore({ ...empty, stuckProjects: [{ id: 'a', stuck_since: '2026-08-21' }] }),
      ).toBe(80); // 7 days ⇒ 2 charges
      expect(
        computeFocusScore({ ...empty, stuckProjects: [{ id: 'a', stuck_since: '2026-08-14' }] }),
      ).toBe(70); // 14 days ⇒ 3 charges
    });

    it('caps the recurrence so one dead project cannot dominate forever', () => {
      const breakdown = explainFocusScore({
        ...empty,
        stuckProjects: [{ id: 'a', stuck_since: '2025-01-01' }],
      });
      expect(breakdown.stuckCharges).toBe(config.focus.maxStuckRecurrences);
      expect(breakdown.score).toBe(60); // 100 − (4 × 10)
    });

    it('charges each stuck project independently', () => {
      expect(
        computeFocusScore({
          ...empty,
          stuckProjects: [
            { id: 'a', stuck_since: AS_OF },
            { id: 'b', stuck_since: AS_OF },
            { id: 'c', stuck_since: null }, // not stuck, ignored
          ],
        }),
      ).toBe(80);
    });
  });

  /* --- +20 done and the 0–100 clamp --- */

  describe('done bonus and clamping', () => {
    it('adds 20 per project moved to Done', () => {
      const score = computeFocusScore({
        ...empty,
        events: [
          ev('p1', 'idea', 'building', '2026-08-10'),
          ev('p1', 'commercialising', 'done', '2026-08-20'),
        ],
      });
      // 100 − 15 + 20 = 105, capped back to 100.
      expect(score).toBe(100);
    });

    it('caps the total at 100 no matter how many things get finished', () => {
      const breakdown = explainFocusScore({
        ...empty,
        events: [
          ev('p1', 'commercialising', 'done', '2026-08-10'),
          ev('p2', 'commercialising', 'done', '2026-08-14'),
          ev('p3', 'shipped', 'done', '2026-08-20'),
        ],
      });
      expect(breakdown.doneCount).toBe(3);
      expect(breakdown.deltas.done).toBe(60);
      expect(breakdown.score).toBe(100);
    });

    it('floors the total at 0', () => {
      const score = computeFocusScore({
        ...empty,
        events: [1, 2, 3, 4, 5].map((n) =>
          ev(`p${n}`, 'building', 'abandoned', `2026-08-0${n}`),
        ),
      });
      expect(score).toBe(0);
    });

    it('nets the deltas together', () => {
      // 100 − 15 (new build) − 10 (stuck) − 25 (abandoned) + 20 (done) = 70
      const breakdown = explainFocusScore({
        events: [
          ev('p1', 'idea', 'building', '2026-08-20'),
          ev('p2', 'building', 'abandoned', '2026-08-21'),
          ev('p3', 'commercialising', 'done', '2026-08-22'),
        ],
        stuckProjects: [{ id: 'a', stuck_since: AS_OF }],
        asOf: AS_OF,
      });
      expect(breakdown.score).toBe(70);
    });
  });

  /* --- SPEC-CHANGES §2: over-cap bleed --- */

  describe('over-cap bleed', () => {
    const CAP = config.projects.wipLimit; // 3

    /** N projects moved into Building (from Shipped, so no −15) on `day`. */
    function activate(count: number, day: string): FocusEventInput[] {
      return Array.from({ length: count }, (_, i) => ev(`a${i}`, 'shipped', 'building', day));
    }

    it('does not bleed at or under the cap', () => {
      const breakdown = explainFocusScore({ ...empty, events: activate(CAP, '2026-08-26') });
      expect(breakdown.overCapDays).toBe(0);
      expect(breakdown.deltas.overCap).toBe(0);
      expect(breakdown.score).toBe(100);
    });

    it('accrues 10 per over-cap project per day', () => {
      // 4 active from 26 Aug ⇒ over by 1 on the 26th, 27th and 28th ⇒ 3 project-days.
      const breakdown = explainFocusScore({ ...empty, events: activate(CAP + 1, '2026-08-26') });
      expect(breakdown.overCapDays).toBe(3);
      expect(breakdown.overCapProjectDays).toBe(3);
      expect(breakdown.deltas.overCap).toBe(-30);
      expect(breakdown.score).toBe(70);
    });

    it('scales with how far over the cap you are', () => {
      // 5 active from 27 Aug ⇒ over by 2 on the 27th and 28th ⇒ 4 project-days.
      const breakdown = explainFocusScore({ ...empty, events: activate(CAP + 2, '2026-08-27') });
      expect(breakdown.overCapProjectDays).toBe(4);
      expect(breakdown.deltas.overCap).toBe(-40);
      expect(breakdown.score).toBe(60);
    });

    it('stops bleeding once a project leaves an active stage', () => {
      const breakdown = explainFocusScore({
        ...empty,
        events: [
          ...activate(CAP + 1, '2026-08-26'),
          // a0 is killed on the 27th ⇒ only the 26th was over cap.
          ev('a0', 'building', 'killed', '2026-08-27'),
        ],
      });
      expect(breakdown.overCapProjectDays).toBe(1);
      // −10 bleed for the one over-cap day, +10 decisive kill ⇒ back to 100.
      expect(breakdown.deltas.overCap).toBe(-10);
      expect(breakdown.deltas.decisiveKill).toBe(10);
      expect(breakdown.score).toBe(100);
    });

    it('uses the LAST event of a day when a project moves twice in one day', () => {
      // The real-world shape: a project is created (→ Idea) and moved into
      // Building on the same day, and `getStageEvents` hands the log over
      // NEWEST FIRST. The day must read as Building, not Idea.
      const sameDay: FocusEventInput[] = [
        {
          project_id: 'a3',
          from_stage: 'idea',
          to_stage: 'building',
          created_at: '2026-08-26T04:00:00Z',
        },
        { project_id: 'a3', from_stage: null, to_stage: 'idea', created_at: '2026-08-26T03:00:00Z' },
      ];
      const breakdown = explainFocusScore({
        ...empty,
        events: [...sameDay, ...activate(CAP, '2026-08-26')],
      });
      // 4 active from the 26th ⇒ over by 1 on the 26th, 27th and 28th.
      expect(breakdown.overCapProjectDays).toBe(3);
      expect(breakdown.deltas.overCap).toBe(-30);
    });

    it('prices the 4th active project up front', () => {
      const preview = describeActivationCost(4, { isNewBuild: true });
      expect(preview.level).toBe('over');
      expect(preview.overBy).toBe(1);
      expect(preview.copy).toBe(
        'This takes you to 4 of 3 active: -15 Focus now, -10/day while over cap, rewards locked.',
      );
    });

    it('says nothing scary when under the cap', () => {
      expect(describeActivationCost(2, { isNewBuild: true }).level).toBe('under');
      expect(describeActivationCost(3, { isNewBuild: true }).level).toBe('at');
      expect(describeActivationCost(3, { isNewBuild: true }).copy).toBe(
        '3 of 3 active: -15 Focus now.',
      );
    });
  });

  /* --- SPEC-CHANGES §2: decisive-kill bonus --- */

  describe('decisive-kill bonus', () => {
    it('adds 10 for killing a project that reached Building', () => {
      const breakdown = explainFocusScore({
        ...empty,
        events: [ev('p1', 'building', 'killed', '2026-08-20')],
      });
      expect(breakdown.decisiveKillCount).toBe(1);
      expect(breakdown.deltas.decisiveKill).toBe(10);
      expect(breakdown.score).toBe(100); // 100 + 10, capped
    });

    it('is Focus-neutral to kill an Idea', () => {
      const breakdown = explainFocusScore({
        ...empty,
        events: [ev('p1', null, 'idea', '2026-08-18'), ev('p1', 'idea', 'killed', '2026-08-20')],
      });
      expect(breakdown.decisiveKillCount).toBe(0);
      expect(breakdown.neutralKillCount).toBe(1);
      expect(breakdown.deltas.decisiveKill).toBe(0);
      expect(breakdown.score).toBe(100);
    });

    it('still rewards the kill if the project had reached Building earlier', () => {
      const breakdown = explainFocusScore({
        ...empty,
        events: [
          ev('p1', 'idea', 'building', '2026-08-10'),
          ev('p1', 'building', 'idea', '2026-08-12'),
          ev('p1', 'idea', 'killed', '2026-08-14'),
        ],
      });
      expect(breakdown.decisiveKillCount).toBe(1);
    });

    it('makes start-then-kill a net −5, the cheapest exit', () => {
      // Shiny object started and killed two days later.
      const breakdown = explainFocusScore({
        ...empty,
        events: [
          ev('p1', 'idea', 'building', '2026-08-20'),
          ev('p1', 'building', 'killed', '2026-08-22'),
        ],
      });
      expect(breakdown.deltas.newBuilding).toBe(-15);
      expect(breakdown.deltas.decisiveKill).toBe(10);
      expect(breakdown.deltas.overCap).toBe(0);
      expect(breakdown.score).toBe(95);

      // Abandoning the same project instead is strictly worse: −15 −25 = 60.
      const abandoned = explainFocusScore({
        ...empty,
        events: [
          ev('p1', 'idea', 'building', '2026-08-20'),
          ev('p1', 'building', 'abandoned', '2026-08-22'),
        ],
      });
      expect(abandoned.score).toBe(60);
      expect(abandoned.score).toBeLessThan(breakdown.score);
    });

    it('describes the bonus for the kill confirmation', () => {
      expect(describeKillBonus('building')).toBe('Decisive kill: +10 Focus');
      expect(describeKillBonus('commercialising')).toBe('Decisive kill: +10 Focus');
      expect(describeKillBonus('idea')).toBeNull();
    });
  });

  /* --- "Import existing projects" — no entry charge, no retroactive bleed --- */

  describe('imported projects', () => {
    /** What `importProject` actually writes: creation event, marked, at `createdAt`. */
    function importEvent(projectId: string, toStage: FocusEventInput['to_stage'], createdAt: string): FocusEventInput {
      return {
        project_id: projectId,
        from_stage: null,
        to_stage: toStage,
        created_at: createdAt,
        note: `${IMPORT_EVENT_MARKER} pre-existing project, started 2026-05-01`,
      };
    }

    it('charges 0 for an import-marked move into Building', () => {
      const breakdown = explainFocusScore({
        ...empty,
        events: [importEvent('p1', 'building', '2026-08-28T02:00:00Z')],
      });
      expect(breakdown.newBuildingCount).toBe(0);
      expect(breakdown.deltas.newBuilding).toBe(0);
      expect(breakdown.score).toBe(100);
    });

    it('still charges 15 for an ordinary (unmarked) move into Building', () => {
      const breakdown = explainFocusScore({
        ...empty,
        events: [ev('p1', 'idea', 'building', '2026-08-28')],
      });
      expect(breakdown.newBuildingCount).toBe(1);
      expect(breakdown.deltas.newBuilding).toBe(-15);
      expect(breakdown.score).toBe(85);
    });

    it('still earns the decisive-kill bonus and the done bonus on an imported project', () => {
      const killed = explainFocusScore({
        ...empty,
        events: [
          importEvent('p1', 'building', '2026-08-10T02:00:00Z'),
          ev('p1', 'building', 'killed', '2026-08-20'),
        ],
      });
      expect(killed.decisiveKillCount).toBe(1);
      expect(killed.deltas.decisiveKill).toBe(10);
      // No entry charge, so a decisive kill nets a pure +10 rather than the -5
      // of a real shiny object.
      expect(killed.score).toBe(100);

      const done = explainFocusScore({
        ...empty,
        events: [
          importEvent('p2', 'building', '2026-08-10T02:00:00Z'),
          ev('p2', 'building', 'done', '2026-08-20'),
        ],
      });
      expect(done.doneCount).toBe(1);
      expect(done.deltas.done).toBe(20);
      expect(done.score).toBe(100);
    });

    it('counts an imported project as Active only from its real event created_at, not its backdated stage_changed_at', () => {
      // Isaac imports a project "started" months ago, but the stage_event is
      // written today (2026-08-28) — as `importProject` actually does.
      const window = ['2026-08-26', '2026-08-27', '2026-08-28'];
      const events = [
        ...['a', 'b', 'c'].map((id) => ev(id, 'shipped', 'building', '2026-08-01')), // already at cap
        importEvent('imported', 'building', '2026-08-28T05:00:00Z'),
      ];

      const overCap = countOverCapProjectDays(events, window);
      // The imported project only exists (for replay purposes) from the 28th —
      // no bleed on the 26th/27th despite claiming a May start date.
      expect(overCap.perDay).toEqual([
        { date: '2026-08-26', activeCount: 3, overBy: 0 },
        { date: '2026-08-27', activeCount: 3, overBy: 0 },
        { date: '2026-08-28', activeCount: 4, overBy: 1 },
      ]);
      expect(overCap.days).toBe(1);
      expect(overCap.total).toBe(1);
    });

    it('prices the import over cap without an entry charge', () => {
      const preview = describeImportImpact(4);
      expect(preview.level).toBe('over');
      expect(preview.overBy).toBe(1);
      expect(preview.copy).toBe(
        'This puts you at 4 of 3 active. No charge for importing, but the -10/day bleed starts tomorrow. Finish or kill something.',
      );

      expect(describeImportImpact(3).copy).toBe('');
      expect(describeImportImpact(2).copy).toBe('');
    });
  });
});
