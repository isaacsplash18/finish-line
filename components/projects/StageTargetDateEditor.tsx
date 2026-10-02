'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { updateProjectAction } from '@/app/projects/actions';
import { Button, Input } from '@/components';
import { humanCountdown } from '@/lib/dates';
import type { DateKey, UUID } from '@/lib/types';

export interface StageTargetDateEditorProps {
  projectId: UUID;
  stageTargetDate: DateKey | null;
  daysToTarget: number | null;
  isTerminal: boolean;
}

/** PRD §3.1.4 — target date for the current stage, inline-editable. */
export function StageTargetDateEditor({
  projectId,
  stageTargetDate,
  daysToTarget,
  isTerminal,
}: StageTargetDateEditorProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(stageTargetDate ?? '');
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-text">
          {stageTargetDate ? (
            <>
              {stageTargetDate}{' '}
              <span className={daysToTarget != null && daysToTarget < 0 ? 'text-warn' : 'text-faint'}>
                ({humanCountdown(daysToTarget ?? 0)})
              </span>
            </>
          ) : (
            <span className="text-faint">No target set.</span>
          )}
        </p>
        {!isTerminal && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </div>
    );
  }

  function save() {
    startTransition(async () => {
      const res = await updateProjectAction(projectId, { stage_target_date: value || null });
      if (res.ok) {
        setEditing(false);
        setError(undefined);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="date"
        label="Target date for this stage"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        error={error}
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={save} loading={pending}>
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setEditing(false);
            setValue(stageTargetDate ?? '');
            setError(undefined);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
