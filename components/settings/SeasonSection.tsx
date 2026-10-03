'use client';

import { useState, useTransition } from 'react';

import { startSeasonAction } from '@/app/settings/actions';
import { Button, Card, Input, Modal, SectionTitle } from '@/components';

export interface SeasonSectionProps {
  /** Null before migration 0002 / before any season exists. */
  seasonName: string | null;
  /** SGT date key the current season started, or null. */
  startedOn: string | null;
  /** Terminal (done/killed/abandoned) projects currently visible on the board: they would be hidden. */
  willHide: number;
  /** Non-terminal projects that carry over. */
  carryOver: number;
}

/**
 * SPEC-V2 §7 — a new season instead of a wipe. The confirm spells out exactly
 * what changes and what does not.
 */
export function SeasonSection({ seasonName, startedOn, willHide, carryOver }: SeasonSectionProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [started, setStarted] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    setOpen(false);
    setName('');
    setError(undefined);
  }

  function confirm() {
    setError(undefined);
    startTransition(async () => {
      const res = await startSeasonAction(name);
      if (res.ok) {
        setStarted(res.data.name ?? 'New season');
        setOpen(false);
        setName('');
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <Card>
      <SectionTitle
        action={
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Start a new season
          </Button>
        }
      >
        Season
      </SectionTitle>

      <p className="text-sm text-muted">
        Current:{' '}
        <span className="font-medium text-text">{seasonName ?? 'No season yet'}</span>
        {startedOn && (
          <>
            {' '}
            · started <span className="tabular text-text">{startedOn}</span>
          </>
        )}
      </p>
      <p className="mt-1 text-xs text-faint">
        Up-only counters and the board count from the season start. A new season is a fresh page,
        not a wipe.
      </p>
      {started && <p className="mt-2 text-xs text-positive">Started “{started}”.</p>}

      <Modal
        open={open}
        onClose={close}
        title="Start a new season?"
        description="Draw a line. Nothing is deleted."
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={confirm} loading={pending}>
              Start season
            </Button>
          </>
        }
      >
        <ul className="mb-4 flex flex-col gap-1.5 text-sm text-muted">
          <li>
            <span className="text-text">Counters restart.</span> Finished, Killed on purpose, Did-it
            days and Weeks under cap count from today.
          </li>
          <li>
            <span className="text-text">Earlier terminal projects hide</span> from the board
            {willHide > 0 ? ` (${willHide} right now)` : ''}. A toggle brings them back.
          </li>
          <li>
            <span className="text-text">Active projects carry over</span>
            {carryOver > 0 ? ` (${carryOver} in flight)` : ''}, stages and next actions untouched.
          </li>
          <li>
            <span className="text-text">History stays.</span> Events, scores and rewards are kept.
          </li>
        </ul>
        <Input
          label="Name (optional)"
          hint="Defaults to the next number, e.g. “Season 2”."
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error}
        />
      </Modal>
    </Card>
  );
}
