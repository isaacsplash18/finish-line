'use client';

import { useState, useTransition } from 'react';

import { setProjectKindAction } from '@/app/projects/actions';
import { cn } from '@/lib/cn';
import type { ProjectKind, UUID } from '@/lib/types';

export interface KindToggleProps {
  projectId: UUID;
  kind: ProjectKind;
  /** Active stage (Building / Commercialising): converting an area back to a project makes it count. */
  isActiveStage: boolean;
}

/**
 * SPEC-V2 §5 — Project / Area. One line says what an area is exempt from, so
 * the choice is never a mystery. Conversion keeps history; terminal projects
 * do not render this (the data layer refuses it).
 */
export function KindToggle({ projectId, kind, isActiveStage }: KindToggleProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  function change(next: ProjectKind) {
    if (next === kind || pending) return;
    setError(undefined);
    startTransition(async () => {
      const res = await setProjectKindAction(projectId, next);
      if (!res.ok) setError(res.error);
    });
  }

  const options: { value: ProjectKind; label: string }[] = [
    { value: 'project', label: 'Project' },
    { value: 'area', label: 'Area' },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div
        role="radiogroup"
        aria-label="Kind"
        className="grid max-w-xs grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1"
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={kind === option.value}
            disabled={pending}
            onClick={() => change(option.value)}
            className={cn(
              'h-9 rounded-lg text-sm font-medium transition-colors disabled:opacity-60',
              kind === option.value
                ? 'bg-accent text-accent-ink'
                : 'text-muted hover:bg-surface-3 hover:text-text',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted">
        {kind === 'area'
          ? 'An area is an ongoing venture: exempt from the WIP cap, stuck, activation charges, the stages and every score. It still holds a next action and shows up in Today’s move.'
          : 'A project is finishable: it moves through the stages, counts toward the cap while Building or Commercialising, can go stuck, and is scored.'}
      </p>
      {kind === 'area' && isActiveStage && (
        <p className="text-xs text-warn">
          Converting back puts it on the board as an active project and counts toward the cap again.
        </p>
      )}
      {error && <p className="text-xs text-warn">{error}</p>}
    </div>
  );
}
