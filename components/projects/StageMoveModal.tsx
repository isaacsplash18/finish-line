'use client';

import { useEffect, useState, useTransition } from 'react';

import { moveProjectStageAction, previewStageMoveAction, type ActionResult } from '@/app/projects/actions';
import { Button, Modal } from '@/components';
import type { StageMovePreview } from '@/lib/data/projects';
import { STAGE_LABELS, type ProjectStage, type UUID } from '@/lib/types';

export interface StageMoveModalProps {
  project: { id: UUID; name: string; stage?: ProjectStage };
  targetStage: ProjectStage;
  onClose: () => void;
}

type Preview = StageMovePreview;

/**
 * The "state the price up front" confirm for any non-terminal stage move
 * (SPEC-V2 §3). Fetches `previewStageMove` on open so the copy always
 * reflects the live active count. At or under the cap the preview copy is
 * empty and we say so ("No charge — 2 of 3 active."); only a move that adds
 * an active project over the cap carries copy, and it comes verbatim from
 * `describeStageMoveCost` (which also says "No activation charge" for the
 * Shipped → Commercialising last mile). It never disables the confirm button.
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
  const costs = Boolean(preview?.copy);
  const tone = preview && costs && preview.level === 'over' ? 'warn' : 'default';

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
          `No charge — ${preview.activeCountAfter} of ${preview.cap} active.`
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
