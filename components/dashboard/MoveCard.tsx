import Link from 'next/link';
import type { ReactNode } from 'react';

import { Card } from '@/components';
import { cn } from '@/lib/cn';
import { STAGE_LABELS, type TodaysMove, type TodaysMoveProject } from '@/lib/types';

export interface MoveCardProps {
  move: TodaysMove;
  /** True while a start/did-it/skip request for this card is in flight. */
  busy?: boolean;
  onDidIt: (project: TodaysMoveProject) => void;
  onSkip: (project: TodaysMoveProject) => void;
  onStart: (project: TodaysMoveProject) => void;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "target in 12 days" / "target tomorrow" / "3 days overdue". */
function targetLabel(daysToTarget: number): { text: string; overdue: boolean } {
  if (daysToTarget < 0) return { text: `${plural(Math.abs(daysToTarget), 'day')} overdue`, overdue: true };
  if (daysToTarget === 0) return { text: 'target today', overdue: false };
  if (daysToTarget === 1) return { text: 'target tomorrow', overdue: false };
  return { text: `target in ${daysToTarget} days`, overdue: false };
}

function MetaLine({ project }: { project: TodaysMoveProject }) {
  const isArea = project.kind === 'area';
  const target = project.daysToTarget != null ? targetLabel(project.daysToTarget) : null;

  return (
    <p className="tabular flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
      {project.isStuck && (
        <span className="rounded-full border border-danger/60 bg-danger-wash px-2 py-0.5 text-xs font-semibold text-danger">
          Stuck · {plural(project.daysSinceProgress, 'day')} quiet
        </span>
      )}
      {isArea ? (
        <span className="text-faint">ongoing</span>
      ) : (
        <span>
          {plural(project.daysInStage, 'day')} in {STAGE_LABELS[project.stage].toLowerCase()}
        </span>
      )}
      {target && (
        <>
          <span aria-hidden className="text-faint">
            ·
          </span>
          <span className={target.overdue ? 'text-warn' : undefined}>{target.text}</span>
        </>
      )}
    </p>
  );
}

const BIG_BUTTON =
  'inline-flex h-16 items-center justify-center rounded-2xl text-lg font-semibold tracking-tight transition-colors outline-offset-2 focus-visible:outline-2 disabled:opacity-60';

/**
 * The one card (SPEC-V2 §1). Project name small, the next action in large
 * type, the facts under it, then two big buttons. Red only when stuck.
 * Presentational: `TodayPanel` owns the state and the actions.
 */
export function MoveCard({ move, busy, onDidIt, onSkip, onStart }: MoveCardProps) {
  if (move.status === 'move') {
    const { project } = move;
    return (
      <Card tone={project.isStuck ? 'stuck' : 'accent'} className="p-5 sm:p-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Link
              href={`/projects/${project.id}`}
              className="w-fit text-sm font-medium text-muted hover:text-text"
            >
              {project.name}
            </Link>
            <p className="text-3xl font-semibold leading-tight tracking-tight text-text sm:text-4xl">
              {project.next_action}
            </p>
            <MetaLine project={project} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => onDidIt(project)}
              className={cn(
                BIG_BUTTON,
                'bg-accent text-accent-ink hover:bg-accent-hover active:bg-accent-dim focus-visible:outline-accent',
              )}
            >
              Did it
            </button>
            <button
              type="button"
              onClick={() => onSkip(project)}
              className={cn(
                BIG_BUTTON,
                'border border-line bg-surface-2 text-text hover:border-line-strong hover:bg-surface-3 focus-visible:outline-line-strong',
              )}
            >
              Not today
            </button>
          </div>
        </div>
      </Card>
    );
  }

  if (move.status === 'start_idea') {
    const { project, cost } = move;
    const over = cost.level === 'over';
    return (
      <Card tone={over ? 'overCap' : 'accent'} className="p-5 sm:p-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-faint">
              {move.copy}
            </p>
            <Link
              href={`/projects/${project.id}`}
              className="w-fit text-sm font-medium text-muted hover:text-text"
            >
              {project.name}
            </Link>
            <p className="text-3xl font-semibold leading-tight tracking-tight text-text sm:text-4xl">
              {project.next_action}
            </p>
            <p className={cn('text-sm', over ? 'text-warn' : 'text-muted')}>
              {cost.copy || `${cost.activeCountAfter} of ${cost.cap} active. No cost.`}
            </p>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => onStart(project)}
            className={cn(
              BIG_BUTTON,
              'w-full focus-visible:outline-accent',
              over
                ? 'bg-warn text-accent-ink hover:brightness-110'
                : 'bg-accent text-accent-ink hover:bg-accent-hover active:bg-accent-dim',
            )}
          >
            {busy ? 'Starting…' : 'Start'}
          </button>
        </div>
      </Card>
    );
  }

  const empty: ReactNode =
    move.status === 'all_done' ? (
      <>
        <p className="text-3xl font-semibold leading-tight tracking-tight text-text">{move.copy}</p>
        {(move.doneToday > 0 || move.skippedToday > 0) && (
          <p className="tabular text-sm text-muted">
            {move.doneToday} done · {move.skippedToday} skipped today. Back tomorrow.
          </p>
        )}
      </>
    ) : (
      <>
        <p className="text-3xl font-semibold leading-tight tracking-tight text-text">
          Nothing in flight. Good.
        </p>
        <Link href="/projects" className="w-fit text-sm font-medium text-accent hover:text-accent-hover">
          Projects →
        </Link>
      </>
    );

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-col gap-2">{empty}</div>
    </Card>
  );
}
