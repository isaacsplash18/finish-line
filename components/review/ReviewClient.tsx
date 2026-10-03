'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import { completeReviewAction } from '@/app/review/actions';
import { Button, Card, EmptyState, SectionTitle } from '@/components';
import { CountersRow } from '@/components/dashboard/CountersRow';
import { FocusPanel } from '@/components/dashboard/FocusPanel';
import type { CountersSummary, FocusWeekBreakdown } from '@/lib/types';

import { ReviewProjectCard, type ReviewItem, type ReviewWeekDay } from './ReviewProjectCard';

export interface ReviewClientProps {
  weekStart: string;
  weekLabel: string;
  items: ReviewItem[];
  weekDays: ReviewWeekDay[];
  focusWeek: FocusWeekBreakdown;
  counters: CountersSummary;
  nextWeekStartsAt: number;
  /** Set when this week's review was already completed. */
  completedLabel: string | null;
}

/**
 * The Sunday review (SPEC-V2 §4): every active project with Keep / Kill / Done,
 * then the week's Focus with its working, the up-only counters, "Next week
 * starts at 100." and Finish review. A ritual, not a gate — it works any day,
 * and projects you skip simply stay as they are.
 *
 * The list is a snapshot taken at load: killing or finishing a project
 * revalidates the page (so the Focus summary moves), but the card must stay on
 * screen showing what just happened rather than vanish.
 */
export function ReviewClient({
  weekStart,
  weekLabel,
  items,
  weekDays,
  focusWeek,
  counters,
  nextWeekStartsAt,
  completedLabel,
}: ReviewClientProps) {
  const [snapshot] = useState(items);
  const [handled, setHandled] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onOutcome(id: string) {
    setHandled((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }

  function finish() {
    setError(null);
    startTransition(async () => {
      const res = await completeReviewAction(weekStart);
      if (res.ok) setFinished(true);
      else setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-8">
      {completedLabel && !finished && (
        <p className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
          Already reviewed {completedLabel}. You can still change things.
        </p>
      )}

      <section>
        <SectionTitle
          action={
            <span className="tabular text-xs text-faint">
              {handled.length} of {snapshot.length}
            </span>
          }
        >
          Projects · {weekLabel}
        </SectionTitle>
        {snapshot.length === 0 ? (
          <EmptyState>Nothing active to review. Good.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {snapshot.map((item) => (
              <li key={item.id}>
                <ReviewProjectCard item={item} weekDays={weekDays} onOutcome={onOutcome} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionTitle>How the week went</SectionTitle>
        <FocusPanel
          score={focusWeek.score}
          lines={focusWeek.lines}
          pending={{
            overCap: focusWeek.pending.overCap,
            stuck: focusWeek.pending.stuck,
            stuckCount: focusWeek.pending.stuckProjectIds.length,
            overBy: focusWeek.pending.overBy,
          }}
          ledger={null}
          title="Focus"
          hint="Where the week landed."
          note={weekLabel}
          emptyText="Nothing moved it that week. It held at 100."
        />
        <CountersRow season={counters.season} lifetime={counters.lifetime} />
        <p className="tabular text-center text-sm text-muted">
          Next week starts at {nextWeekStartsAt}.
        </p>

        {finished ? (
          <Card tone="accent" className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-2xl font-semibold tracking-tight text-text">Review done.</p>
            <p className="text-sm text-muted">Next week starts at {nextWeekStartsAt}.</p>
            <Link href="/" className="text-sm font-medium text-accent hover:text-accent-hover">
              Back to Today →
            </Link>
          </Card>
        ) : (
          <>
            {error && (
              <p role="alert" className="text-center text-sm text-warn">
                {error}
              </p>
            )}
            <Button size="lg" block onClick={finish} loading={pending}>
              Finish review
            </Button>
          </>
        )}
      </section>
    </div>
  );
}
