import { cn } from '@/lib/cn';
import { humanCountdown } from '@/lib/dates';

export interface CountdownChipProps {
  name: string;
  /** Whole days from today. Negative = already passed. */
  daysAway: number;
  /** Name of the linked project, if any (PRD §7.3). */
  projectName?: string | null;
  /**
   * True when the linked project is not Done and the date has passed — this is
   * the one case that earns red, because it flags the project Stuck.
   */
  overdue?: boolean;
  className?: string;
}

/**
 * "Half-marathon in 23 days" (PRD §7.2).
 *
 * Colour: neutral normally, amber inside a week, red only when `overdue` —
 * i.e. the date passed on a project that is not Done, which is a Stuck signal.
 */
export function CountdownChip({
  name,
  daysAway,
  projectName,
  overdue,
  className,
}: CountdownChipProps) {
  const soon = !overdue && daysAway >= 0 && daysAway <= 7;

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-baseline gap-1.5 rounded-full border px-3 py-1.5 text-xs',
        overdue
          ? 'border-danger/60 bg-danger-wash text-danger'
          : soon
            ? 'border-warn/50 bg-warn-wash text-warn'
            : 'border-line bg-surface-2 text-muted',
        className,
      )}
      title={projectName ? `Linked to ${projectName}` : undefined}
    >
      <span className="truncate font-medium text-text">{name}</span>
      <span className="tabular whitespace-nowrap">{humanCountdown(daysAway)}</span>
    </span>
  );
}
