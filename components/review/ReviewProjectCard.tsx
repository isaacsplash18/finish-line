'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import {
  doneProjectReviewAction,
  keepProjectAction,
  killProjectReviewAction,
} from '@/app/review/actions';
import { Button, Card, Input, StageBadge, Textarea } from '@/components';
import { cn } from '@/lib/cn';
import type { DateKey, ProjectStage } from '@/lib/types';

/** Plain, serialisable per-project data, prepared on the server. */
export interface ReviewItem {
  id: string;
  name: string;
  stage: ProjectStage;
  nextAction: string;
  /** Days this week with any progress signal. */
  progressDays: number;
  progressDayKeys: DateKey[];
  daysInStage: number;
  daysToTarget: number | null;
  isStuck: boolean;
  /** "Decisive kill: +10 Focus", or null when killing is Focus-neutral. */
  killBonusCopy: string | null;
  /** "+20 Focus. Boxing gloves unlocks." */
  doneCopy: string;
}

export interface ReviewWeekDay {
  key: DateKey;
  label: string;
}

type Outcome =
  | { kind: 'kept'; text: string }
  | { kind: 'killed'; text: string }
  | { kind: 'done'; text: string };

type Mode = 'idle' | 'kill' | 'done';

export interface ReviewProjectCardProps {
  item: ReviewItem;
  weekDays: ReviewWeekDay[];
  onOutcome?: (id: string) => void;
}

function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? '' : 's'}`;
}

function targetText(days: number): { text: string; overdue: boolean } {
  if (days < 0) return { text: `${plural(Math.abs(days), 'day')} overdue`, overdue: true };
  if (days === 0) return { text: 'target today', overdue: false };
  if (days === 1) return { text: 'target tomorrow', overdue: false };
  return { text: `target in ${days} days`, overdue: false };
}

/**
 * One project in the Sunday review (SPEC-V2 §4): this week's progress days,
 * days in stage, target, stuck flag — then Keep / Kill / Done. Keep saves the
 * (prefilled, required) next action; Kill asks for a reason and states the
 * bonus; Done states the +20 and the reward it unlocks. Nothing is red except
 * the stuck flag, and no button is disabled by the WIP cap.
 */
export function ReviewProjectCard({ item, weekDays, onOutcome }: ReviewProjectCardProps) {
  const [mode, setMode] = useState<Mode>('idle');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [nextAction, setNextAction] = useState(item.nextAction);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const target = item.daysToTarget != null ? targetText(item.daysToTarget) : null;
  const progressKeys = new Set(item.progressDayKeys);

  function finish(next: Outcome) {
    setOutcome(next);
    setMode('idle');
    setError(null);
    onOutcome?.(item.id);
  }

  function keep() {
    const text = nextAction.trim();
    if (!text) {
      setError('A project needs a next action.');
      return;
    }
    if (text === item.nextAction.trim()) {
      finish({ kind: 'kept', text: `Kept. Next: ${text}` });
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await keepProjectAction(item.id, text);
      if (res.ok) finish({ kind: 'kept', text: `Kept. Next: ${text}` });
      else setError(res.error);
    });
  }

  function kill() {
    if (!reason.trim()) {
      setError('Say why, in one line.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await killProjectReviewAction(item.id, reason);
      if (res.ok) {
        finish({
          kind: 'killed',
          text: item.killBonusCopy ? `Killed. ${item.killBonusCopy}.` : 'Killed on purpose. No penalty.',
        });
      } else setError(res.error);
    });
  }

  function markDone() {
    setError(null);
    startTransition(async () => {
      const res = await doneProjectReviewAction(item.id);
      if (res.ok) finish({ kind: 'done', text: `Done. ${item.doneCopy}` });
      else setError(res.error);
    });
  }

  if (outcome) {
    return (
      <Card className="flex items-center gap-3 py-3">
        <span
          aria-hidden
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-accent-ink',
            outcome.kind === 'done' ? 'bg-positive' : 'bg-accent',
          )}
        >
          ✓
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text">{item.name}</p>
          <p className="text-xs text-muted">{outcome.text}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card tone={item.isStuck ? 'stuck' : 'default'} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Link
            href={`/projects/${item.id}`}
            className="min-w-0 truncate text-lg font-semibold tracking-tight text-text hover:text-accent"
          >
            {item.name}
          </Link>
          <StageBadge stage={item.stage} stuck={item.isStuck} size="sm" />
        </div>

        <div className="flex items-center gap-3">
          <ol className="flex items-center gap-1" aria-label="Progress days in the review week">
            {weekDays.map((d) => (
              <li
                key={d.key}
                title={d.key}
                className={cn(
                  'flex size-5 items-center justify-center rounded-full text-[9px] font-semibold',
                  progressKeys.has(d.key)
                    ? 'bg-accent text-accent-ink'
                    : 'border border-line text-faint',
                )}
              >
                {d.label}
              </li>
            ))}
          </ol>
          <span className="tabular text-xs text-muted">
            {plural(item.progressDays, 'progress day')} that week
          </span>
        </div>

        <p className="tabular text-xs text-faint">
          {plural(item.daysInStage, 'day')} in stage
          {target && (
            <>
              {' · '}
              <span className={target.overdue ? 'text-warn' : undefined}>{target.text}</span>
            </>
          )}
        </p>
      </div>

      <Input
        label="Next action"
        value={nextAction}
        onChange={(e) => {
          setNextAction(e.target.value);
          if (error) setError(null);
        }}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && mode === 'idle') {
            e.preventDefault();
            keep();
          }
        }}
        error={mode === 'idle' ? (error ?? undefined) : undefined}
        autoComplete="off"
      />

      {mode === 'idle' && (
        <div className="grid grid-cols-3 gap-2">
          <Button size="lg" onClick={keep} loading={pending}>
            Keep
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => {
              setError(null);
              setMode('kill');
            }}
            disabled={pending}
          >
            Kill
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => {
              setError(null);
              setMode('done');
            }}
            disabled={pending}
          >
            Done
          </Button>
        </div>
      )}

      {mode === 'kill' && (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2 p-3">
          <p className="text-sm text-muted">
            {item.killBonusCopy ?? 'Killed on purpose. No penalty.'}
          </p>
          <Textarea
            label="Why?"
            hint="One line. Deliberate kills cost nothing."
            placeholder="e.g. Market moved on, not worth finishing."
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError(null);
            }}
            error={error ?? undefined}
            autoFocus
          />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setMode('idle')} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={kill} loading={pending} disabled={!reason.trim()}>
              Kill it
            </Button>
          </div>
        </div>
      )}

      {mode === 'done' && (
        <div className="flex flex-col gap-3 rounded-xl border border-positive/40 bg-positive-wash/40 p-3">
          <p className="text-sm text-text">{item.doneCopy}</p>
          {error && <p className="text-xs text-warn">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setMode('idle')} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={markDone} loading={pending}>
              Mark done
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
