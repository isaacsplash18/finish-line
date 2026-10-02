'use client';

import { useState } from 'react';

import { Button, Select } from '@/components';
import { STAGE_LABELS, type ProjectStage, type UUID } from '@/lib/types';
import { KillModal } from './KillModal';
import { StageMoveModal } from './StageMoveModal';

const MOVE_TARGETS: readonly ProjectStage[] = ['idea', 'building', 'shipped', 'commercialising', 'done'];

export interface StageMoveControlsProps {
  project: { id: UUID; name: string; stage: ProjectStage; isTerminal: boolean };
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Per-card / per-detail stage controls (PRD §8.2 — "not drag-drop, 1-tap
 * matters more than drag on mobile"). A stage picker for ordinary moves (each
 * one previews its cost before confirming, SPEC-CHANGES §1/§4) plus a
 * dedicated Kill button, since killing needs a reason and never the price
 * treatment. Renders nothing once a project is terminal.
 */
export function StageMoveControls({ project, size = 'sm', className }: StageMoveControlsProps) {
  const [target, setTarget] = useState<ProjectStage | ''>('');
  const [killOpen, setKillOpen] = useState(false);

  if (project.isTerminal) return null;

  const options = MOVE_TARGETS.filter((s) => s !== project.stage);

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Move to stage"
          value={target}
          onChange={(e) => setTarget(e.target.value as ProjectStage | '')}
          fieldSize={size}
          className="w-auto"
        >
          <option value="">Move to…</option>
          {options.map((stage) => (
            <option key={stage} value={stage}>
              {STAGE_LABELS[stage]}
            </option>
          ))}
        </Select>
        <Button size={size} variant="secondary" onClick={() => setKillOpen(true)}>
          Kill
        </Button>
      </div>

      {target && (
        // Keyed on the target stage so picking a different one before confirming
        // gets fresh state instead of reusing the previous preview fetch.
        <StageMoveModal key={target} project={project} targetStage={target} onClose={() => setTarget('')} />
      )}
      {killOpen && <KillModal project={project} onClose={() => setKillOpen(false)} />}
    </div>
  );
}
