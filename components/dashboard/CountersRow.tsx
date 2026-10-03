import { cn } from '@/lib/cn';
import type { Counters } from '@/lib/types';

export interface CountersRowProps {
  /** Current-season values: the headline numbers. */
  season: Counters;
  lifetime: Counters;
  className?: string;
}

const CELLS: { key: keyof Counters; label: string }[] = [
  { key: 'finished', label: 'Finished' },
  { key: 'decisiveKills', label: 'Killed on purpose' },
  { key: 'didItDays', label: 'Did-it days' },
  { key: 'weeksUnderCap', label: 'Weeks under cap' },
];

/**
 * The four up-only counters (SPEC-V2 §3): they never decrease, so they sit
 * quietly under the Focus number as the record nothing can take away. Season
 * is the headline; lifetime shows underneath only when it differs.
 */
export function CountersRow({ season, lifetime, className }: CountersRowProps) {
  return (
    <ul className={cn('grid grid-cols-4 gap-2', className)} aria-label="Up-only counters">
      {CELLS.map(({ key, label }) => (
        <li
          key={key}
          className="flex flex-col rounded-xl border border-line bg-surface px-2.5 py-2.5"
        >
          <span className="tabular text-2xl font-semibold leading-none text-text">
            {season[key]}
          </span>
          <span className="mt-1.5 text-[10px] font-medium uppercase leading-tight tracking-wide text-faint">
            {label}
          </span>
          {lifetime[key] !== season[key] && (
            <span className="tabular mt-0.5 text-[10px] text-faint">{lifetime[key]} lifetime</span>
          )}
        </li>
      ))}
    </ul>
  );
}
