'use client';

import { useOptimistic, useState, useTransition } from 'react';

import {
  decrementRoutineAction,
  incrementRoutineAction,
  setSabbathAction,
  clearSabbathAction,
  toggleRoutineAction,
  updateRoutineTargetAction,
} from '@/app/routines/actions';
import { Button, Card, CardHeader, HeatCalendar, Input } from '@/components';
import { addDays, dayOfWeek, today } from '@/lib/dates';
import type { DateKey, RoutineWithChecks } from '@/lib/types';

export interface RoutineHeatCardProps {
  routine: RoutineWithChecks;
  /** Every sabbath day in the visible window — greys the same days on every card. */
  sabbathDays: DateKey[];
}

/** The Sun–Sat range that contains `asOf`. Matches the data layer's week for sabbath. */
function currentWeekRange(asOf: DateKey): [DateKey, DateKey] {
  const start = addDays(asOf, -dayOfWeek(asOf));
  return [start, addDays(start, 6)];
}

/** Optimistic edits, mirroring what the server actions do. */
type RoutineOp =
  | { type: 'set'; date: DateKey; count: number }
  | { type: 'add'; date: DateKey; by: number }
  /** Marking a sabbath clears any other mark in the same Sun–Sat week. */
  | { type: 'sabbath'; date: DateKey }
  | { type: 'target'; value: number };

function applyOp(routine: RoutineWithChecks, op: RoutineOp): RoutineWithChecks {
  switch (op.type) {
    case 'set':
      return { ...routine, checksByDate: { ...routine.checksByDate, [op.date]: op.count } };
    case 'add':
      return {
        ...routine,
        checksByDate: {
          ...routine.checksByDate,
          [op.date]: Math.max(0, (routine.checksByDate[op.date] ?? 0) + op.by),
        },
      };
    case 'sabbath': {
      const [start, end] = currentWeekRange(op.date);
      const checksByDate = { ...routine.checksByDate };
      for (const date of Object.keys(checksByDate)) {
        if (date >= start && date <= end && date !== op.date) checksByDate[date] = 0;
      }
      checksByDate[op.date] = 1;
      return { ...routine, checksByDate };
    }
    case 'target':
      return { ...routine, weekly_target: op.value };
  }
}

/**
 * One routine's 4-week heat calendar plus its editing affordances (PRD §8.4).
 *
 * - Daily routines: tap a cell in the current week to toggle it on/off.
 * - Weekly counters (Workouts): tap a cell in the current week to add one; a
 *   +/− pair next to the header corrects today's count.
 * - The sabbath routine: tap a Sat/Sun cell in the current week to mark or
 *   clear the rest day.
 *
 * Only the current week is editable — history is locked in, matching the
 * weekly-target framing ("current week progress vs weekly_target").
 */
export function RoutineHeatCard({ routine: serverRoutine, sabbathDays }: RoutineHeatCardProps) {
  const [isPending, startTransition] = useTransition();
  // Ticks flip instantly; React drops the optimistic layer when the action's
  // transition settles (the fresh server render replaces it, or, on error, the
  // old state simply comes back).
  const [routine, applyOptimistic] = useOptimistic(serverRoutine, applyOp);
  const [error, setError] = useState<string | null>(null);
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetDraft, setTargetDraft] = useState(String(serverRoutine.weekly_target));

  const asOf = today();
  const [weekStart, weekEnd] = currentWeekRange(asOf);
  const inCurrentWeek = (date: DateKey) => date >= weekStart && date <= weekEnd;

  const weekEntries = Object.entries(routine.checksByDate).filter(
    ([date]) => date >= weekStart && date <= weekEnd,
  );
  const weekProgress =
    routine.cadence === 'daily'
      ? weekEntries.filter(([, count]) => count > 0).length
      : weekEntries.reduce((sum, [, count]) => sum + count, 0);

  // The sabbath card's own rings follow its optimistic ticks; other cards wait
  // for the server render (a few hundred ms) since they only borrow the days.
  const ownSabbathDays = Object.entries(routine.checksByDate)
    .filter(([, count]) => count > 0)
    .map(([date]) => date);

  function run(op: RoutineOp, action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      applyOptimistic(op);
      const result = await action();
      if (!result.ok) setError(result.error ?? 'That did not work.');
    });
  }

  function handleToggleDate(date: DateKey) {
    if (!inCurrentWeek(date)) {
      setError('Only this week can be edited — history is locked in.');
      return;
    }
    if (routine.is_sabbath) {
      const dow = dayOfWeek(date);
      if (dow !== 0 && dow !== 6) {
        setError('Sabbath only applies to Saturday or Sunday.');
        return;
      }
      const isMarked = (routine.checksByDate[date] ?? 0) > 0;
      run(
        isMarked ? { type: 'set', date, count: 0 } : { type: 'sabbath', date },
        () => (isMarked ? clearSabbathAction(date) : setSabbathAction(date)),
      );
      return;
    }
    if (routine.cadence === 'weekly') {
      run({ type: 'add', date, by: 1 }, () => incrementRoutineAction(routine.id, date));
      return;
    }
    const isDone = (routine.checksByDate[date] ?? 0) > 0;
    run({ type: 'set', date, count: isDone ? 0 : 1 }, () => toggleRoutineAction(routine.id, date));
  }

  function handleAdjustToday(delta: number) {
    if (delta > 0) {
      run({ type: 'add', date: asOf, by: 1 }, () => incrementRoutineAction(routine.id, asOf, 1));
    } else {
      const currentCount = routine.checksByDate[asOf] ?? 0;
      run({ type: 'add', date: asOf, by: -1 }, () =>
        decrementRoutineAction(routine.id, asOf, currentCount),
      );
    }
  }

  function saveTarget() {
    const parsed = Number(targetDraft);
    if (!Number.isInteger(parsed) || parsed < 1) {
      setError('Weekly target must be a whole number of 1 or more.');
      return;
    }
    setError(null);
    startTransition(async () => {
      applyOptimistic({ type: 'target', value: parsed });
      const result = await updateRoutineTargetAction(routine.id, parsed);
      if (!result.ok) setError(result.error ?? 'That did not work.');
      else setEditingTarget(false);
    });
  }

  return (
    <Card tone={routine.is_sabbath ? 'accent' : 'default'}>
      <CardHeader>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-text">{routine.name}</h3>
            {routine.is_sabbath && (
              <span className="whitespace-nowrap rounded-full border border-accent/40 bg-accent-wash px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
                Rest day
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {routine.is_sabbath
              ? 'Mark a Sat or Sun as rest. Greys that day out everywhere else.'
              : `${weekProgress} / ${routine.weekly_target} this week · ${routine.cadence}`}
          </p>
        </div>

        {!routine.is_sabbath && (
          <div className="flex shrink-0 items-center gap-1.5">
            {routine.cadence === 'weekly' && !editingTarget && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleAdjustToday(-1)}
                  disabled={isPending || (routine.checksByDate[asOf] ?? 0) === 0}
                  aria-label="Decrement today's count"
                >
                  −
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleAdjustToday(1)}
                  disabled={isPending}
                  aria-label="Increment today's count"
                >
                  +
                </Button>
              </>
            )}
            {editingTarget ? (
              <>
                <Input
                  aria-label="Weekly target"
                  type="number"
                  min={1}
                  value={targetDraft}
                  onChange={(event) => setTargetDraft(event.target.value)}
                  className="h-8 w-16 px-2 py-1 text-xs"
                />
                <Button size="sm" variant="primary" onClick={saveTarget} disabled={isPending}>
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditingTarget(false);
                    setTargetDraft(String(routine.weekly_target));
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setEditingTarget(true)}>
                Edit target
              </Button>
            )}
          </div>
        )}
      </CardHeader>

      <HeatCalendar
        checksByDate={routine.checksByDate}
        asOf={asOf}
        sabbathDays={routine.is_sabbath ? ownSabbathDays : sabbathDays}
        onToggleDate={handleToggleDate}
        tone={routine.is_sabbath ? 'accent' : 'positive'}
      />

      {error && <p className="mt-2 text-xs text-warn">{error}</p>}
    </Card>
  );
}
