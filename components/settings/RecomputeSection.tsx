'use client';

import { useState, useTransition } from 'react';

import { recomputeNowAction } from '@/app/settings/actions';
import { Button, Card, SectionTitle } from '@/components';
import type { ScoreSnapshot } from '@/lib/types';

export interface RecomputeSectionProps {
  latestSnapshot: ScoreSnapshot | null;
}

/**
 * PRD §8.5 cron/status blurb. Runs the same sanctioned recompute the nightly
 * `GET /api/cron` calls — `computeAndSnapshotToday()` — via a server action.
 */
export function RecomputeSection({ latestSnapshot }: RecomputeSectionProps) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleRecompute() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const outcome = await recomputeNowAction();
      if (!outcome.ok) setError(outcome.error);
      else setResult(`Done — Flow ${outcome.data.snapshot.flow}, Focus ${outcome.data.snapshot.focus}.`);
    });
  }

  return (
    <Card>
      <SectionTitle
        action={
          <Button size="sm" variant="primary" onClick={handleRecompute} loading={isPending}>
            Recompute now
          </Button>
        }
      >
        Cron status
      </SectionTitle>
      <p className="text-sm text-muted">
        Last score snapshot: <span className="tabular text-text">{latestSnapshot?.date ?? 'none yet'}</span>
      </p>
      <p className="mt-1 text-xs text-faint">
        The nightly job runs automatically at midnight SGT (Vercel Cron → <code className="text-text">GET /api/cron</code>).
        This button runs the same recompute on demand.
      </p>
      {result && <p className="mt-2 text-xs text-positive">{result}</p>}
      {error && <p className="mt-2 text-xs text-warn">{error}</p>}
    </Card>
  );
}
