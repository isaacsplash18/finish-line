'use client';

import { useState, useTransition } from 'react';

import {
  createRewardAction,
  deleteRewardAction,
  updateRewardAction,
} from '@/app/settings/actions';
import { Button, Card, EmptyState, Input, RewardCard, SectionTitle, Select } from '@/components';
import { STAGE_LABELS, type ProjectStage, type Reward, type UUID } from '@/lib/types';

interface ProjectOption {
  id: UUID;
  name: string;
  stage: ProjectStage;
}

export interface RewardsSectionProps {
  rewards: Reward[];
  projectsById: Record<UUID, { name: string; stage: ProjectStage }>;
  /** Not-done projects a reward can be pinned to (SPEC-CHANGES / lib/data one-per-project). */
  assignableProjects: ProjectOption[];
}

interface RewardFormValue {
  name: string;
  price: number;
  project_id: UUID | null;
}

function RewardForm({
  initial,
  projects,
  pending,
  onCancel,
  onSubmit,
}: {
  initial?: { name: string; price: number; project_id: UUID | null };
  projects: ProjectOption[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (value: RewardFormValue) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [price, setPrice] = useState(initial ? String(initial.price) : '');
  const [projectId, setProjectId] = useState<string>(initial?.project_id ?? '');

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-2 p-4">
      <Input
        label="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Watch strap"
      />
      <Input
        label="Price"
        type="number"
        min={0}
        value={price}
        onChange={(event) => setPrice(event.target.value)}
        placeholder="300"
      />
      <Select
        label="Project"
        hint="One reward per project — earned when it reaches Done."
        value={projectId}
        onChange={(event) => setProjectId(event.target.value)}
      >
        <option value="">Unassigned</option>
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
            onSubmit({ name, price: Number(price), project_id: (projectId || null) as UUID | null })
          }
        >
          Save
        </Button>
      </div>
    </div>
  );
}

/**
 * Rewards CRUD (PRD §4, §8.5). Claiming is the dashboard's job — this screen
 * only creates, edits, and deletes unassigned rewards, and surfaces status.
 */
export function RewardsSection({ rewards, projectsById, assignableProjects }: RewardsSectionProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<UUID | null>(null);

  function projectOptionsFor(reward: Reward): ProjectOption[] {
    if (!reward.project_id || assignableProjects.some((p) => p.id === reward.project_id)) {
      return assignableProjects;
    }
    const current = projectsById[reward.project_id];
    if (!current) return assignableProjects;
    return [...assignableProjects, { id: reward.project_id, name: current.name, stage: current.stage }];
  }

  function handleCreate(value: RewardFormValue) {
    if (!value.name.trim()) return setError('Name the reward.');
    setError(null);
    startTransition(async () => {
      const result = await createRewardAction(value);
      if (!result.ok) setError(result.error);
      else setAdding(false);
    });
  }

  function handleUpdate(id: UUID, value: RewardFormValue) {
    setError(null);
    startTransition(async () => {
      const result = await updateRewardAction(id, value);
      if (!result.ok) setError(result.error);
      else setEditingId(null);
    });
  }

  function handleDelete(id: UUID) {
    setError(null);
    startTransition(async () => {
      const result = await deleteRewardAction(id);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <Card>
      <SectionTitle
        action={
          !adding && (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              Add reward
            </Button>
          )
        }
      >
        Rewards
      </SectionTitle>

      {error && <p className="mb-3 text-xs text-warn">{error}</p>}

      <div className="flex flex-col gap-3">
        {adding && (
          <RewardForm
            projects={assignableProjects}
            pending={isPending}
            onCancel={() => setAdding(false)}
            onSubmit={handleCreate}
          />
        )}

        {rewards.length === 0 && !adding && (
          <EmptyState>No rewards yet. Add one and pin it to a project&apos;s Done state.</EmptyState>
        )}

        {rewards.map((reward) =>
          editingId === reward.id ? (
            <RewardForm
              key={reward.id}
              initial={{ name: reward.name, price: reward.price, project_id: reward.project_id }}
              projects={projectOptionsFor(reward)}
              pending={isPending}
              onCancel={() => setEditingId(null)}
              onSubmit={(value) => handleUpdate(reward.id, value)}
            />
          ) : (
            <div key={reward.id} className="flex flex-col gap-2">
              <RewardCard
                reward={reward}
                projectName={reward.project_id ? projectsById[reward.project_id]?.name ?? null : null}
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setEditingId(reward.id)}
                  disabled={isPending}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleDelete(reward.id)}
                  disabled={isPending || Boolean(reward.project_id)}
                  title={reward.project_id ? 'Unassign it from its project first.' : undefined}
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
