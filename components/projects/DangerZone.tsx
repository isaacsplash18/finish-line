'use client';

import { useState } from 'react';

import { Button, Card, SectionTitle } from '@/components';
import type { Reward, UUID } from '@/lib/types';
import { AbandonModal } from './AbandonModal';

export interface DangerZoneProps {
  project: { id: UUID; name: string };
  reward?: Reward | null;
}

/**
 * ARCHITECTURE §4.4 — Abandon is the worst outcome and is kept deliberately
 * out of the way: a plain trigger down here, not a card button, opening a
 * confirmation that states the -25 and the forfeit before anything happens.
 */
export function DangerZone({ project, reward }: DangerZoneProps) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <SectionTitle>Give up instead</SectionTitle>
      <p className="text-xs text-muted">
        If you are not going to finish this and will not say so out loud, abandoning it is honest —
        but it costs the most. Killing it (above) gets you the same clean slate for less.
      </p>
      <Button variant="ghost" size="sm" className="mt-3" onClick={() => setOpen(true)}>
        Abandon this project
      </Button>
      {open && <AbandonModal project={project} reward={reward} onClose={() => setOpen(false)} />}
    </Card>
  );
}
