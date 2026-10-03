'use client';

import { useOptimistic, useState, useTransition } from 'react';

import { toggleRoutineAction } from '@/app/actions';
import { cn } from '@/lib/cn';
import type { RoutineWithChecks } from '@/lib/types';

export interface RoutineChecklistProps {
  routines: RoutineWithChecks[];
  className?: string;
}

/**
 * Today's 1-tap routine checklist (PRD §5.3.1, Beaver-Habits style).
 *
 * On a sabbath day every non-sabbath routine is greyed with a "resting" note —
 * it is not required and never penalised — while the sabbath toggle itself
 * stays live so Isaac can un-mark it if he tapped it by mistake.
 *
 * Ticks are optimistic: the check flips the instant it is tapped and the server
 * action runs in the background. If it fails the optimistic state is dropped
 * (React reverts it when the transition ends) and the error is shown.
 */
export function RoutineChecklist({ routines, className }: RoutineChecklistProps) {
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [optimisticRoutines, flipRoutine] = useOptimistic(
    routines,
    (state: RoutineWithChecks[], routineId: string) =>
      state.map((r) =>
        r.id === routineId
          ? {
              ...r,
              doneToday: !r.doneToday,
              windowCount: Math.max(0, r.windowCount + (r.doneToday ? -1 : 1)),
            }
          : r,
      ),
  );

  // Derived from the optimistic state so ticking Sabbath greys the rest instantly too.
  const sabbathToday = optimisticRoutines.some((r) => r.is_sabbath && r.doneToday);

  function handleToggle(routineId: string) {
    setError(null);
    startTransition(async () => {
      flipRoutine(routineId);
      const result = await toggleRoutineAction(routineId);
      if (!result.ok) setError(result.error ?? 'Could not update that.');
    });
  }

  if (optimisticRoutines.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-faint">
        No routines yet. Add some in Settings.
      </p>
    );
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {sabbathToday && (
        <p className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
          Rest day. Nothing else here counts against you today.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {optimisticRoutines.map((routine) => {
          const resting = sabbathToday && !routine.is_sabbath;
          const done = routine.doneToday;

          return (
            <li key={routine.id}>
              <button
                type="button"
                aria-pressed={done}
                onClick={() => handleToggle(routine.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
                  resting
                    ? 'border-line/60 bg-surface/60 opacity-50'
                    : done
                      ? 'border-positive/40 bg-positive-wash/40'
                      : 'border-line bg-surface hover:border-line-strong',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold',
                    done
                      ? 'border-positive bg-positive text-accent-ink'
                      : 'border-line-strong text-transparent',
                  )}
                >
                  ✓
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text">
                    {routine.name}
                  </span>
                  <span className="block text-xs text-faint">
                    {resting
                      ? 'Resting'
                      : routine.is_sabbath
                        ? sabbathToday
                          ? 'Resting today'
                          : 'Not resting today'
                        : `${routine.windowCount}/${routine.weekly_target} this week`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
