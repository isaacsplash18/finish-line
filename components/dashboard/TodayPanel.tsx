'use client';

import { useOptimistic, useRef, useState, useTransition } from 'react';
import type { FormEvent, ReactNode } from 'react';

import {
  logProgressAction,
  setNextActionAction,
  skipTodaysMoveAction,
  startIdeaAction,
} from '@/app/actions';
import { config } from '@/lib/config';
import type {
  CountersSummary,
  FocusWeekBreakdown,
  TodaysMove,
  TodaysMoveProject,
} from '@/lib/types';

import { CountersRow } from './CountersRow';
import { FocusPanel } from './FocusPanel';
import { MoveCard } from './MoveCard';

export interface TodayPanelProps {
  todaysMove: TodaysMove;
  focusWeek: FocusWeekBreakdown;
  counters: CountersSummary;
  /** Distinct days this week with a Did-it (server value, before this tap). */
  didItDaysThisWeek: number;
  /** Server-rendered, slotted between the move card and the Focus number. */
  banner?: ReactNode;
  /** Server-rendered WIP line, slotted under the counters. */
  wip?: ReactNode;
}

/**
 * Everything the optimistic layer adds on top of the server's numbers while a
 * request is in flight. React drops it the moment the transition (the server
 * action plus the revalidated page) lands, at which point the props already
 * contain the real values — so there is no double counting and nothing to
 * reconcile by hand.
 */
interface Overlay {
  /** Moves already answered (done or skipped) — the card advances past them. */
  advanced: string[];
  done: number;
  skipped: number;
  /** Focus points the taps added (after the per-day cap). */
  points: number;
  /** Scoring did-it taps (areas do not score). */
  taps: number;
  /** +1 when the tap is today's first Did-it (the did-it-days counter). */
  didItDay: number;
  /** Stuck projects the taps just cleared. */
  clearedStuck: string[];
}

const EMPTY_OVERLAY: Overlay = {
  advanced: [],
  done: 0,
  skipped: 0,
  points: 0,
  taps: 0,
  didItDay: 0,
  clearedStuck: [],
};

type OverlayAction =
  | {
      type: 'did_it';
      projectId: string;
      points: number;
      scored: boolean;
      firstOfDay: boolean;
      wasStuck: boolean;
    }
  | { type: 'skip'; projectId: string };

function reduceOverlay(state: Overlay, action: OverlayAction): Overlay {
  if (action.type === 'skip') {
    return { ...state, advanced: [...state.advanced, action.projectId], skipped: state.skipped + 1 };
  }
  return {
    ...state,
    advanced: [...state.advanced, action.projectId],
    done: state.done + 1,
    points: state.points + action.points,
    taps: state.taps + (action.scored ? 1 : 0),
    didItDay: state.didItDay + (action.firstOfDay ? 1 : 0),
    clearedStuck: action.wasStuck ? [...state.clearedStuck, action.projectId] : state.clearedStuck,
  };
}

/** The card as it should look once the answered moves are out of the way. */
function advance(move: TodaysMove, overlay: Overlay): TodaysMove {
  if (move.status !== 'move' || overlay.advanced.length === 0) return move;
  const rest = [move.project, ...move.upNext].filter((p) => !overlay.advanced.includes(p.id));
  const doneToday = move.doneToday + overlay.done;
  const skippedToday = move.skippedToday + overlay.skipped;
  if (rest.length === 0) {
    return {
      status: 'all_done',
      doneToday,
      skippedToday,
      copy: doneToday > 0 ? 'That’s today’s moves. Good.' : 'Everything’s parked for today.',
    };
  }
  return { ...move, project: rest[0], upNext: rest.slice(1), doneToday, skippedToday };
}

interface PromptState {
  projectId: string;
  name: string;
  original: string;
  value: string;
  autoFocus: boolean;
}

/**
 * Home: Today's move + the live Focus under it (SPEC-V2 §1, §3).
 *
 * Did it answers on the same frame: the card advances to the next move, the
 * Focus number and the ledger line change, the counters tick — all optimistic
 * — while `logProgressAction` runs. The "Next action?" prompt appears at the
 * same moment and never blocks: ignore it, Skip it, or Enter to keep / replace.
 */
export function TodayPanel({
  todaysMove,
  focusWeek,
  counters,
  didItDaysThisWeek,
  banner,
  wip,
}: TodayPanelProps) {
  const [overlay, applyOverlay] = useOptimistic(EMPTY_OVERLAY, reduceOverlay);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<{ id: number; text: string } | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [starting, setStarting] = useState(false);
  const ledgerId = useRef(0);

  const move = advance(todaysMove, overlay);

  /* ---- live numbers: server values + whatever is still in flight ---- */
  const stuckLine = focusWeek.lines.find((l) => l.type === 'stuck');
  const rawNow = focusWeek.raw + overlay.points;
  const scoreNow = Math.round(Math.min(config.focus.max, Math.max(config.focus.min, rawNow)));
  const lines = focusWeek.lines.map((l) =>
    l.type === 'didIt'
      ? { ...l, count: l.count + overlay.taps, points: l.points + overlay.points }
      : l,
  );
  const clearedPending = overlay.clearedStuck.filter((id) =>
    focusWeek.pending.stuckProjectIds.includes(id),
  ).length;
  const stuckCount = focusWeek.pending.stuckProjectIds.length - clearedPending;
  const pendingStuck = Math.min(
    0,
    focusWeek.pending.stuck - clearedPending * (stuckLine?.perUnit ?? config.focus.stuckPenaltyPerWeek),
  );
  const season = {
    ...counters.season,
    didItDays: counters.season.didItDays + overlay.didItDay,
  };
  const lifetime = {
    ...counters.lifetime,
    didItDays: counters.lifetime.didItDays + overlay.didItDay,
  };

  /* ---- the Next-action prompt ---------------------------------------- */

  function commitPrompt(p: PromptState | null) {
    if (!p) return;
    const next = p.value.trim();
    if (next === '' || next === p.original.trim()) return; // Enter / Skip = keep
    // Fire-and-forget: this must never block the next tap.
    void setNextActionAction(p.projectId, next).then((res) => {
      if (!res.ok) setError(res.error ?? 'Could not save that next action.');
    });
  }

  function submitPrompt(event: FormEvent) {
    event.preventDefault();
    commitPrompt(prompt);
    setPrompt(null);
  }

  /* ---- taps ------------------------------------------------------------ */

  function handleDidIt(project: TodaysMoveProject) {
    setError(null);
    commitPrompt(prompt); // a prompt left open counts as answered
    const scored = project.kind === 'project';
    const doneSoFar = todaysMove.status === 'move' ? todaysMove.doneToday + overlay.done : overlay.done;
    const room = Math.max(0, config.focus.didItDailyCap - doneSoFar * config.focus.didItBonus);
    const points = scored ? Math.min(config.focus.didItBonus, room) : 0;
    const firstOfDay = doneSoFar === 0;
    const days = didItDaysThisWeek + overlay.didItDay + (firstOfDay ? 1 : 0);

    const parts: string[] = [];
    if (!scored) parts.push('Did it · ongoing, no Focus');
    else if (points > 0) parts.push(`+${points} did it`);
    else parts.push(`Did it · daily +${config.focus.didItDailyCap} cap reached`);
    if (scored && points > 0 && rawNow >= config.focus.max) parts.push('holding at 100');
    if (project.isStuck) parts.push('unstuck');
    parts.push(`${days} did-it ${days === 1 ? 'day' : 'days'} this week`);
    ledgerId.current += 1;
    setLedger({ id: ledgerId.current, text: parts.join(' · ') });

    setPrompt({
      projectId: project.id,
      name: project.name,
      original: project.next_action,
      value: project.next_action,
      autoFocus:
        typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches,
    });

    startTransition(async () => {
      applyOverlay({
        type: 'did_it',
        projectId: project.id,
        points,
        scored,
        firstOfDay,
        wasStuck: project.isStuck,
      });
      const res = await logProgressAction(project.id);
      if (!res.ok) {
        setError(res.error);
        setLedger(null);
        setPrompt(null);
      }
    });
  }

  function handleSkip(project: TodaysMoveProject) {
    setError(null);
    commitPrompt(prompt);
    setPrompt(null);
    ledgerId.current += 1;
    setLedger({ id: ledgerId.current, text: 'Skipped. No penalty. Back tomorrow.' });
    startTransition(async () => {
      applyOverlay({ type: 'skip', projectId: project.id });
      const res = await skipTodaysMoveAction(project.id);
      if (!res.ok) {
        setError(res.error);
        setLedger(null);
      }
    });
  }

  function handleStart(project: TodaysMoveProject) {
    setError(null);
    setStarting(true);
    startTransition(async () => {
      const res = await startIdeaAction(project.id);
      setStarting(false);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <MoveCard
        move={move}
        busy={starting || (pending && move.status === 'start_idea')}
        onDidIt={handleDidIt}
        onSkip={handleSkip}
        onStart={handleStart}
      />

      {prompt && (
        <form
          onSubmit={submitPrompt}
          className="flex flex-col gap-2 rounded-2xl border border-line bg-surface px-4 py-3"
        >
          <label
            htmlFor="next-action-prompt"
            className="text-xs font-medium uppercase tracking-wide text-muted"
          >
            Next action for {prompt.name}?
          </label>
          <div className="flex items-center gap-2">
            <input
              id="next-action-prompt"
              value={prompt.value}
              onChange={(e) => setPrompt({ ...prompt, value: e.target.value })}
              onFocus={(e) => e.currentTarget.select()}
              autoFocus={prompt.autoFocus}
              autoComplete="off"
              enterKeyHint="done"
              className="min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm text-text placeholder:text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              type="button"
              onClick={() => setPrompt(null)}
              className="shrink-0 px-2 py-2 text-xs font-medium text-muted hover:text-text"
            >
              Skip
            </button>
          </div>
          <p className="text-xs text-faint">Enter keeps it. Type to replace.</p>
        </form>
      )}

      {error && (
        <p role="alert" className="text-sm text-warn">
          {error}
        </p>
      )}

      {banner}

      <FocusPanel
        score={scoreNow}
        lines={lines}
        pending={{
          overCap: focusWeek.pending.overCap,
          stuck: pendingStuck,
          stuckCount,
          overBy: focusWeek.pending.overBy,
        }}
        ledger={ledger}
      />

      <CountersRow season={season} lifetime={lifetime} />

      {wip && <div className="flex">{wip}</div>}
    </div>
  );
}
