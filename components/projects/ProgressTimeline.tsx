import { EmptyState } from '@/components';
import { addDays, lastNDates } from '@/lib/dates';
import type { DateKey, ProgressEvent, ProgressKind } from '@/lib/types';

export interface ProgressTimelineProps {
  /** This project's progress events within the window (any order). */
  events: Pick<ProgressEvent, 'kind' | 'day'>[];
  /** Window length in days, ending today. */
  days: number;
  today: DateKey;
}

const KIND_LABEL: Record<ProgressKind, string> = {
  did_it: 'Did it',
  commit: 'Commit',
  stage: 'Stage',
  next_action: 'Next action',
};

const KIND_ORDER: readonly ProgressKind[] = ['did_it', 'commit', 'stage', 'next_action'];

function shortDay(day: DateKey): string {
  const [, m, d] = day.split('-');
  return `${Number(d)}/${Number(m)}`;
}

/**
 * SPEC-V2 §2 — the progress signals behind "stuck": a Did-it tap, a commit on
 * the linked repo, a stage move, a next-action edit. A 14-cell strip (oldest →
 * today) shows the rhythm at a glance; the list below names each day's signals.
 */
export function ProgressTimeline({ events, days, today }: ProgressTimelineProps) {
  const span = lastNDates(days, today);
  const byDay = new Map<DateKey, Set<ProgressKind>>();
  for (const event of events) {
    const set = byDay.get(event.day) ?? new Set<ProgressKind>();
    set.add(event.kind);
    byDay.set(event.day, set);
  }
  const hits = span.filter((d) => byDay.has(d));

  return (
    <div className="flex flex-col gap-3">
      <div
        role="img"
        aria-label={`Progress on ${hits.length} of the last ${days} days`}
        className="flex gap-1"
      >
        {span.map((day) => (
          <span
            key={day}
            title={`${day}${byDay.has(day) ? ': progress' : ''}`}
            className={
              byDay.has(day)
                ? 'h-5 flex-1 rounded-sm bg-accent'
                : 'h-5 flex-1 rounded-sm bg-surface-3'
            }
          />
        ))}
      </div>
      <p className="text-[11px] text-faint">
        {days}d: {shortDay(addDays(today, -(days - 1)))} to today · progress on {hits.length}
      </p>

      {hits.length === 0 ? (
        <EmptyState>No progress signals in {days} days.</EmptyState>
      ) : (
        <ol className="flex flex-col gap-2">
          {[...hits].reverse().map((day) => {
            const kinds = byDay.get(day)!;
            return (
              <li key={day} className="flex items-center gap-3 text-xs">
                <span className="tabular w-10 shrink-0 text-faint">{shortDay(day)}</span>
                <span className="flex flex-wrap gap-1.5">
                  {KIND_ORDER.filter((k) => kinds.has(k)).map((kind) => (
                    <span
                      key={kind}
                      className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted"
                    >
                      {KIND_LABEL[kind]}
                    </span>
                  ))}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
