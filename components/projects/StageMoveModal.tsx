'use client';

import { useEffect, useState, useTransition } from 'react';

import { moveProjectStageAction, previewStageMoveAction, type ActionResult } from '@/app/projects/actions';
import { Button, Modal } from '@/components';
import { STAGE_LABELS, type ProjectStage, type UUID } from '@/lib/types';
import type { WipCostPreview } from '@/lib/scores';

export interface StageMoveModalProps {
  project: { id: UUID; name: string };
  targetStage: ProjectStage;
  onClose: () => void;
}

type Preview = WipCostPreview & { killBonusCopy: string | null };

/**
 * The "state the price up front" confirm for any non-terminal stage move
 * (SPEC-CHANGES §1/§4). Fetches `previewStageMove` on open so the copy always
 * reflects the live active count, then either lets the move through free or
 * shows the cost — it never disables the confirm button either way.
 */
export function StageMoveModal({ project, targetStage, onClose }: StageMoveModalProps) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    previewStageMoveAction(project.id, targetStage).then((res: ActionResult<Preview>) => {
      if (cancelled) return;
      if (res.ok) setPreview(res.data);
      else setLoadError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [project.id, targetStage]);

  function confirm() {
    startTransition(async () => {
      const res = await moveProjectStageAction(project.id, targetStage);
      if (res.ok) {
        onClose();
      } else {
        setSubmitError(res.error);
      }
    });
  }

  const label = STAGE_LABELS[targetStage];
  const tone = preview && preview.level === 'over' ? 'warn' : 'default';

  return (
    <Modal
      open
      onClose={onClose}
      tone={tone}
      title={`Move "${project.name}" to ${label}?`}
      description={
        loadError ? (
          <span className="text-warn">{loadError}</span>
        ) : !preview ? (
          'Checking the price…'
        ) : preview.copy ? (
          preview.copy
        ) : (
          `${preview.activeCountAfter} of ${preview.cap} active. No cost.`
        )
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={tone === 'warn' ? 'warn' : 'primary'}
            onClick={confirm}
            loading={pending}
            disabled={!preview}
          >
            Move to {label}
          </Button>
        </>
      }
    >
      {submitError && <p className="text-xs text-warn">{submitError}</p>}
    </Modal>
  );
}
