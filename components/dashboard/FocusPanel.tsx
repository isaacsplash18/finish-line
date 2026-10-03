import { cn } from '@/lib/cn';
import type { FocusWeekLine } from '@/lib/types';

export interface FocusPanelProps {
  /** 0–100, already clamped (and already including any optimistic delta). */
  score: number;
  lines: FocusWeekLine[];
  /** What lands at tonight's close if nothing changes. Negative numbers. */
  pending: { overCap: number; stuck: number; stuckCount: number; overBy: number };
  /** The line that answers the last tap, e.g. "+2 did it · 3 did-its this week". */
  ledger: { id: number; text: string } | null;
  /** Shown under the number when there is no ledger line yet. */
  hint?: string;
  /** Header label. */
  title?: string;
  /** Right-hand note in the header. */
  note?: string;
  /** Shown instead of the breakdown when nothing has moved the score. */
  emptyText?: string;
  className?: string;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

/**
 * This week's Focus (SPEC-V2 §3): one big live number, the ledger line that
 * answers the last tap, then the working — one line per delta type that has
 * happened — and tonight's pending charges in amber. Negatives are amber,
 * never red; red is for stuck/forfeit only.
 */
export function FocusPanel({
  score,
  lines,
  pending,
  ledger,
  hint = 'Tap Did it to move this.',
  title = 'Focus this week',
  note = 'Resets to 100 Monday',
  emptyText = 'Nothing has moved it yet this week. It starts at 100.',
  className,
}: FocusPanelProps) {
  const visible = lines.filter((l) => l.count > 0 || l.points !== 0);
  const hasPending = pending.overCap < 0 || pending.stuck < 0;

  return (
    <section
      aria-label={title}
      className={cn('rounded-2xl border border-line bg-surface p-4', className)}
    >
      {/* Keyframes live here so the bump needs no shared CSS change. */}
      <style>{`@keyframes fl-bump{0%{transform:scale(1)}35%{transform:scale(1.12)}100%{transform:scale(1)}}`}</style>

      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
          {title}
        </h2>
        <span className="text-xs text-faint">{note}</span>
      </div>

      <div className="mt-2 flex items-end gap-2">
        <span
          key={ledger?.id ?? 0}
          className="tabular inline-block origin-left text-5xl font-semibold leading-none tracking-tighter text-accent motion-safe:animate-[fl-bump_450ms_ease-out]"
          aria-live="polite"
        >
          {score}
        </span>
        <span className="tabular pb-0.5 text-sm text-faint">/ 100</span>
      </div>

      <p
        className={cn(
          'mt-2 min-h-5 text-sm',
          ledger ? 'font-medium text-positive' : 'text-faint',
        )}
        aria-live="polite"
      >
        {ledger ? ledger.text : hint}
      </p>

      {visible.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1 border-t border-line pt-3">
          {visible.map((line) => (
            <li key={line.type} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-muted">
                {line.label}
                {line.count > 0 && <span className="tabular text-faint"> × {line.count}</span>}
              </span>
              <span
                className={cn(
                  'tabular font-medium',
                  line.points > 0 ? 'text-positive' : line.points < 0 ? 'text-warn' : 'text-faint',
                )}
              >
                {signed(line.points)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 border-t border-line pt-3 text-xs text-faint">
          {emptyText}
        </p>
      )}

      {hasPending && (
        <ul className="mt-3 flex flex-col gap-1 rounded-xl border border-warn/40 bg-warn-wash/50 px-3 py-2">
          {pending.overCap < 0 && (
            <li className="text-xs text-warn">
              <span className="tabular font-medium">tonight: {pending.overCap}</span> over cap
              <span className="text-warn/80">
                {' '}
                ({pending.overBy} over). Finish or kill something to avoid it.
              </span>
            </li>
          )}
          {pending.stuck < 0 && (
            <li className="text-xs text-warn">
              <span className="tabular font-medium">tonight: {pending.stuck}</span> stuck
              <span className="text-warn/80">
                {' '}
                ({pending.stuckCount} {pending.stuckCount === 1 ? 'project' : 'projects'}). Any Did
                it clears it.
              </span>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
