'use client';

import { useState, useTransition } from 'react';

import {
  createRoutineAction,
  deactivateRoutineAction,
  reactivateRoutineAction,
  removeRoutineAction,
  updateRoutineAction,
} from '@/app/settings/actions';
import { Button, Card, EmptyState, Input, SectionTitle, Select } from '@/components';
import type { Routine, RoutineCadence, UUID } from '@/lib/types';

export interface RoutinesSectionProps {
  routines: Routine[];
}

interface RoutineFormValue {
  name: string;
  cadence: RoutineCadence;
  weekly_target: number;
  is_sabbath: boolean;
}

function RoutineForm({
  initial,
  pending,
  onCancel,
  onSubmit,
}: {
  initial?: Routine;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (value: RoutineFormValue) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [cadence, setCadence] = useState<RoutineCadence>(initial?.cadence ?? 'daily');
  const [target, setTarget] = useState(String(initial?.weekly_target ?? 7));
  const [isSabbath, setIsSabbath] = useState(initial?.is_sabbath ?? false);
  const [formError, setFormError] = useState<string | null>(null);

  function submit() {
    if (!name.trim()) return setFormError('Name the routine.');
    const parsed = Number(target);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return setFormError('Weekly target must be a whole number of 1 or more.');
    }
    setFormError(null);
    onSubmit({ name, cadence, weekly_target: parsed, is_sabbath: isSabbath });
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-2 p-4">
      <Input
        label="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Dog walk"
      />
      <Select
        label="Cadence"
        value={cadence}
        onChange={(event) => setCadence(event.target.value as RoutineCadence)}
      >
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
      </Select>
      <Input
        label="Weekly target"
        type="number"
        min={1}
        value={target}
        onChange={(event) => setTarget(event.target.value)}
        hint={
          cadence === 'daily'
            ? 'Days out of 7 that must be ticked.'
            : 'Total ticks per week (e.g. workouts).'
        }
      />
      <label className="flex items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={isSabbath}
          onChange={(event) => setIsSabbath(event.target.checked)}
          className="size-4 rounded border-line bg-surface-2 accent-accent"
        />
        This is the sabbath / rest-day routine (only one allowed — setting it clears any other)
      </label>
      {formError && <p className="text-xs text-warn">{formError}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={submit} disabled={pending}>
          Save
        </Button>
      </div>
    </div>
  );
}

/**
 * Routines CRUD (PRD §5.3.2, §8.5): add, retarget, deactivate, or fully remove
 * a routine. Day-to-day check-offs live on the Routines screen.
 */
export function RoutinesSection({ routines }: RoutinesSectionProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<UUID | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<UUID | null>(null);

  function handleCreate(value: RoutineFormValue) {
    setError(null);
    startTransition(async () => {
      const result = await createRoutineAction(value);
      if (!result.ok) setError(result.error);
      else setAdding(false);
    });
  }

  function handleUpdate(id: UUID, value: RoutineFormValue) {
    setError(null);
    startTransition(async () => {
      const result = await updateRoutineAction(id, value);
      if (!result.ok) setError(result.error);
      else setEditingId(null);
    });
  }

  function handleDeactivate(id: UUID) {
    setError(null);
    startTransition(async () => {
      const result = await deactivateRoutineAction(id);
      if (!result.ok) setError(result.error);
    });
  }

  function handleReactivate(id: UUID) {
    setError(null);
    startTransition(async () => {
      const result = await reactivateRoutineAction(id);
      if (!result.ok) setError(result.error);
    });
  }

  function handleRemove(id: UUID) {
    setError(null);
    startTransition(async () => {
      const result = await removeRoutineAction(id);
      if (!result.ok) setError(result.error);
      setConfirmRemoveId(null);
    });
  }

  return (
    <Card>
      <SectionTitle
        action={
          !adding && (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              Add routine
            </Button>
          )
        }
      >
        Routines
      </SectionTitle>

      {error && <p className="mb-3 text-xs text-warn">{error}</p>}

      <div className="flex flex-col gap-3">
        {adding && (
          <RoutineForm pending={isPending} onCancel={() => setAdding(false)} onSubmit={handleCreate} />
        )}

        {routines.length === 0 && !adding && <EmptyState>No routines yet.</EmptyState>}

        {routines.map((routine) =>
          editingId === routine.id ? (
            <RoutineForm
              key={routine.id}
              initial={routine}
              pending={isPending}
              onCancel={() => setEditingId(null)}
              onSubmit={(value) => handleUpdate(routine.id, value)}
            />
          ) : (
            <div
              key={routine.id}
              className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-text">{routine.name}</p>
                  {routine.is_sabbath && (
                    <span className="rounded-full border border-accent/40 bg-accent-wash px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
                      Rest day
                    </span>
                  )}
                  {!routine.active && (
                    <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-faint">
                      Inactive
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {routine.cadence} · target {routine.weekly_target}/week
                </p>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setEditingId(routine.id)}
                  disabled={isPending}
                >
                  Edit
                </Button>
                {routine.active ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleDeactivate(routine.id)}
                    disabled={isPending}
                  >
                    Deactivate
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleReactivate(routine.id)}
                    disabled={isPending}
                  >
                    Reactivate
                  </Button>
                )}
                {confirmRemoveId === routine.id ? (
                  <>
                    <Button
                      size="sm"
                      variant="warn"
                      onClick={() => handleRemove(routine.id)}
                      disabled={isPending}
                    >
                      Confirm remove
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmRemoveId(null)}
                      disabled={isPending}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setConfirmRemoveId(routine.id)}
                    disabled={isPending}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ),
        )}
      </div>
    </Card>
  );
}
