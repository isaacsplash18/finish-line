'use client';

import { useState, useTransition } from 'react';

import {
  createKeyDateAction,
  deleteKeyDateAction,
  updateKeyDateAction,
} from '@/app/settings/actions';
import { Button, Card, CountdownChip, EmptyState, Input, SectionTitle, Select } from '@/components';
import { today } from '@/lib/dates';
import { STAGE_LABELS, type KeyDateWithCountdown, type ProjectStage, type UUID } from '@/lib/types';

interface ProjectOption {
  id: UUID;
  name: string;
  stage: ProjectStage;
}

export interface KeyDatesSectionProps {
  keyDates: KeyDateWithCountdown[];
  linkableProjects: ProjectOption[];
}

interface KeyDateFormValue {
  name: string;
  date: string;
  project_id: UUID | null;
}

function KeyDateForm({
  initial,
  projects,
  pending,
  onCancel,
  onSubmit,
}: {
  initial?: { name: string; date: string; project_id: UUID | null };
  projects: ProjectOption[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (value: KeyDateFormValue) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [date, setDate] = useState(initial?.date ?? today());
  const [projectId, setProjectId] = useState<string>(initial?.project_id ?? '');

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-2 p-4">
      <Input
        label="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Half-marathon"
      />
      <Input
        label="Date"
        type="date"
        value={date}
        onChange={(event) => setDate(event.target.value)}
      />
      <Select
        label="Linked project"
        hint="Optional. A passed date on a project that isn't Done flags it Stuck."
        value={projectId}
        onChange={(event) => setProjectId(event.target.value)}
      >
        <option value="">No project</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name} · {STAGE_LABELS[project.stage]}
          </option>
        ))}
      </Select>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={pending}
          onClick={() =>
            onSubmit({ name, date, project_id: (projectId || null) as UUID | null })
          }
        >
          Save
        </Button>
      </div>
    </div>
  );
}

/**
 * Key dates CRUD (PRD §7, §8.5). A date linked to a project that passes while
 * the project isn't Done auto-flags that project Stuck (`recomputeStuckFlags`).
 */
export function KeyDatesSection({ keyDates, linkableProjects }: KeyDatesSectionProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<UUID | null>(null);

  function projectOptionsFor(kd: KeyDateWithCountdown): ProjectOption[] {
    if (!kd.project_id || linkableProjects.some((p) => p.id === kd.project_id)) {
      return linkableProjects;
    }
    if (!kd.project) return linkableProjects;
    return [...linkableProjects, { id: kd.project.id, name: kd.project.name, stage: kd.project.stage }];
  }

  function handleCreate(value: KeyDateFormValue) {
    if (!value.name.trim()) return setError('Name the date.');
    setError(null);
    startTransition(async () => {
      const result = await createKeyDateAction(value);
      if (!result.ok) setError(result.error);
      else setAdding(false);
    });
  }

  function handleUpdate(id: UUID, value: KeyDateFormValue) {
    setError(null);
    startTransition(async () => {
      const result = await updateKeyDateAction(id, value);
      if (!result.ok) setError(result.error);
      else setEditingId(null);
    });
  }

  function handleDelete(id: UUID) {
    setError(null);
    startTransition(async () => {
      const result = await deleteKeyDateAction(id);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <Card>
      <SectionTitle
        action={
          !adding && (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              Add date
            </Button>
          )
        }
      >
        Key dates
      </SectionTitle>

      <p className="mb-3 text-xs text-faint">
        A linked date that passes while its project isn&apos;t Done auto-flags that project Stuck.
      </p>

      {error && <p className="mb-3 text-xs text-warn">{error}</p>}

      <div className="flex flex-col gap-3">
        {adding && (
          <KeyDateForm
            projects={linkableProjects}
            pending={isPending}
            onCancel={() => setAdding(false)}
            onSubmit={handleCreate}
          />
        )}

        {keyDates.length === 0 && !adding && <EmptyState>No key dates yet.</EmptyState>}

        {keyDates.map((kd) =>
          editingId === kd.id ? (
            <KeyDateForm
              key={kd.id}
              initial={{ name: kd.name, date: kd.date, project_id: kd.project_id }}
              projects={projectOptionsFor(kd)}
              pending={isPending}
              onCancel={() => setEditingId(null)}
              onSubmit={(value) => handleUpdate(kd.id, value)}
            />
          ) : (
            <div
              key={kd.id}
              className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-wrap items-center gap-2">
                <CountdownChip
                  name={kd.name}
                  daysAway={kd.daysAway}
                  projectName={kd.project?.name}
                  overdue={Boolean(kd.project && kd.project.stage !== 'done' && kd.daysAway < 0)}
                />
                <span className="text-xs text-faint">{kd.date}</span>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setEditingId(kd.id)}
                  disabled={isPending}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleDelete(kd.id)}
                  disabled={isPending}
                >
                  Delete
                </Button>
              </div>
            </div>
          ),
        )}
      </div>
    </Card>
  );
}
