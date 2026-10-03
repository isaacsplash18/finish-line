'use client';

import { useEffect, useState, useTransition } from 'react';

import { getKillPreviewAction, killProjectAction } from '@/app/projects/actions';
import { Button, Modal, Textarea } from '@/components';
import type { UUID } from '@/lib/types';

export interface KillModalProps {
  project: { id: UUID; name: string };
  onClose: () => void;
}

/**
 * PRD §3.2.3 — killing requires a one-line reason, and is deliberately
 * respectable: it costs nothing from Idea, and earns the decisive-kill bonus
 * from Building or beyond (SPEC-CHANGES §2/§4). Never uses the danger
 * treatment — that is reserved for Abandon.
 *
 * Mounted only while the kill flow is open (see `StageMoveControls`), so
 * every field starts fresh — no manual reset-in-effect needed.
 */
export function KillModal({ project, onClose }: KillModalProps) {
  const [reason, setReason] = useState('');
  const [bonusCopy, setBonusCopy] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getKillPreviewAction(project.id).then((res) => {
      if (cancelled) return;
      if (res.ok) setBonusCopy(res.data.bonusCopy);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  function confirm() {
    startTransition(async () => {
      const res = await killProjectAction(project.id, reason);
      if (res.ok) {
        onClose();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Kill "${project.name}"?`}
      description={
        bonusCopy === undefined
          ? 'Checking the score impact…'
          : bonusCopy
            ? bonusCopy
            : 'Killed on purpose. No penalty.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={confirm} loading={pending} disabled={!reason.trim()}>
            Kill project
          </Button>
        </>
      }
    >
      <Textarea
        label="Why?"
        hint="One line. Be honest — deliberate kills cost nothing."
        placeholder="e.g. Market moved on, not worth finishing."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        error={error ?? undefined}
        autoFocus
      />
    </Modal>
  );
}
