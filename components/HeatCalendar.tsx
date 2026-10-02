'use client';

import { config } from '@/lib/config';
import { cn } from '@/lib/cn';
import { DAY_INITIALS, addDays, dayOfWeek, today } from '@/lib/dates';
import type { DateKey } from '@/lib/types';

export interface HeatCalendarProps {
  /** `{ '2026-08-28': 1 }`. Missing / 0 = not done. */
  checksByDate: Record<DateKey, number>;
  /** Number of week rows. Defaults to `config.ui.heatCalendarWeeks` (4). */
  weeks?: number;
  /** Last day shown. Defaults to today (SGT). */
  asOf?: DateKey;
  /** Dates to grey out entirely — sabbath days are never penalised (PRD §5.2.2). */
  sabbathDays?: DateKey[];
  /** Tap a day to toggle it. Omit for a read-only calendar. */
  onToggleDate?: (date: DateKey) => void;
  /** Emerald by default; pass 'accent' to tint a routine orange. */
  tone?: 'positive' | 'accent';
  className?: string;
}

/**
 * Beaver-Habits-style 4-week heat grid (PRD §5.3.1).
 *
 * Rows are weeks (oldest at the top), columns are Sun→Sat. Days in the future
 * are dimmed and never tappable. Sabbath days get a ring instead of a fill —
 * they are excluded from Flow denominators, so "empty" is not a miss.
 *
 * Purely presentational: pass `checksByDate` from
 * `getRoutinesWithChecks()` and handle `onToggleDate` with a server action.
 */
export function HeatCalendar({
  checksByDate,
  weeks = config.ui.heatCalendarWeeks,
  asOf,
  sabbathDays = [],
  onToggleDate,
  tone = 'positive',
  className,
}: HeatCalendarProps) {
  const end = asOf ?? today();
  // Extend to the Saturday of the current week so columns line up.
  const gridEnd = addDays(end, 6 - dayOfWeek(end));
  const gridStart = addDays(gridEnd, -(weeks * 7 - 1));
  const sabbath = new Set(sabbathDays);

  const rows: DateKey[][] = Array.from({ length: weeks }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => addDays(gridStart, week * 7 + day)),
  );

  const fill =
    tone === 'accent'
      ? 'bg-accent text-accent-ink border-accent'
      : 'bg-positive text-accent-ink border-positive';

  return (
    <div className={cn('inline-flex flex-col gap-1', className)}>
      <div className="grid grid-cols-7 gap-1">
        {DAY_INITIALS.map((initial, i) => (
          <span key={i} className="text-center text-[10px] font-medium text-faint">
            {initial}
          </span>
        ))}
      </div>

      {rows.map((row, weekIndex) => (
        <div key={weekIndex} className="grid grid-cols-7 gap-1">
          {row.map((date) => {
            const count = checksByDate[date] ?? 0;
            const isFuture = date > end;
            const isSabbath = sabbath.has(date);
            const done = count > 0;
            const interactive = Boolean(onToggleDate) && !isFuture;

            return (
              <button
                key={date}
                type="button"
                disabled={!interactive}
                onClick={interactive ? () => onToggleDate?.(date) : undefined}
                title={`${date}${isSabbath ? ' · sabbath' : ''}${count > 1 ? ` · ×${count}` : ''}`}
                aria-label={`${date}${done ? ', done' : ', not done'}`}
                aria-pressed={done}
                className={cn(
                  'tabular flex aspect-square min-w-7 items-center justify-center rounded-md border text-[10px] font-semibold transition-colors',
                  done ? fill : 'border-line bg-surface-2 text-transparent',
                  isSabbath && !done && 'border-dashed border-line-strong',
                  isFuture && 'opacity-25',
                  interactive && 'cursor-pointer hover:border-line-strong',
                )}
              >
                {count > 1 ? count : '·'}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
