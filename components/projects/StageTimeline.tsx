import { EmptyState, StageBadge } from '@/components';
import { toDateKey } from '@/lib/dates';
import type { StageEvent } from '@/lib/types';

export interface StageTimelineProps {
  events: StageEvent[];
}

/** PRD §8.3 — stage history timeline, newest first (matches `getProject`'s order). */
export function StageTimeline({ events }: StageTimelineProps) {
  if (events.length === 0) return <EmptyState>No history yet.</EmptyState>;

  return (
    <ol className="flex flex-col gap-4">
      {events.map((event) => (
        <li key={event.id} className="flex gap-3">
          <div className="mt-1 flex flex-col items-center">
            <span aria-hidden className="size-1.5 rounded-full bg-line-strong" />
            <span aria-hidden className="w-px flex-1 bg-line" />
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {event.from_stage && <StageBadge stage={event.from_stage} size="sm" />}
              {event.from_stage && <span className="text-faint">→</span>}
              <StageBadge stage={event.to_stage} size="sm" />
              <span className="text-faint">{toDateKey(event.created_at)}</span>
            </div>
            {event.note && <p className="mt-1 text-sm text-muted">{event.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
