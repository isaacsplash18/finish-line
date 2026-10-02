'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { abandonProjectAction } from '@/app/projects/actions';
import { Button, Modal, Textarea } from '@/components';
import type { Reward, UUID } from '@/lib/types';

export interface AbandonModalProps {
  project: { id: UUID; name: string };
  reward?: Reward | null;
  onClose: () => void;
}

/**
 * PRD §4.3.2 / ARCHITECTURE §4.4 — the worst outcome, deliberately. -25 Focus
 * and the linked reward is permanently forfeited. The ONLY `danger` button in
 * this feature area belongs here.
 *
 * Mounted only while open (see `DangerZone`), so the reason field always
 * starts blank.
 */
export function AbandonModal({ project, reward, onClose }: AbandonModalProps) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await abandonProjectAction(project.id, reason.trim() || undefined);
      if (res.ok) {
        router.refresh();
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
      tone="danger"
      title={`Abandon "${project.name}"?`}
      description={
        <>
          This is the worst way out: <span className="text-danger">-25 Focus</span>, permanently.
          {reward && reward.status !== 'forfeited' ? (
            <>
              {' '}
              Its reward —{' '}
              <span className="text-danger">
                ${reward.price.toLocaleString('en-US')} {reward.name}
              </span>{' '}
              — is forfeited for good.
            </>
          ) : null}{' '}
          If this is a deliberate stop, Kill it instead — same result, none of the cost.
        </>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} loading={pending}>
            Abandon — take the loss
          </Button>
        </>
      }
    >
      <Textarea
        label="Reason (optional)"
        placeholder="Why abandon instead of kill?"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        error={error ?? undefined}
      />
    </Modal>
  );
}
