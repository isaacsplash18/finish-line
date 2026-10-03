'use client';

import { useState, useTransition } from 'react';

import { updateProjectAction } from '@/app/projects/actions';
import { Button, Textarea } from '@/components';
import type { UUID } from '@/lib/types';

export interface NextActionEditorProps {
  projectId: UUID;
  nextAction: string;
  isTerminal: boolean;
}

/**
 * PRD §3.1.3 / §8.3 — the one required field, inline-editable. Editing it
 * resets the 14-day staleness clock and clears `stuck_since` (ARCHITECTURE §4.2).
 * An empty save is rejected server-side; the message is shown verbatim.
 */
export function NextActionEditor({ projectId, nextAction, isTerminal }: NextActionEditorProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(nextAction);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm text-text">{nextAction}</p>
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
      const res = await updateProjectAction(projectId, { next_action: value });
      if (res.ok) {
        setEditing(false);
        setError(undefined);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        label="Next action"
        hint="Editing this resets the 14-day staleness clock."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        error={error}
        autoFocus
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
            setValue(nextAction);
            setError(undefined);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
