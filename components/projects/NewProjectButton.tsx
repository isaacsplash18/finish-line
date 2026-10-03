'use client';

import { useState, useTransition } from 'react';

import { createProjectAction } from '@/app/projects/actions';
import { Button, Input, Modal, Textarea } from '@/components';
import { cn } from '@/lib/cn';
import { normalizeGithubRepo } from '@/lib/github';
import type { ProjectKind } from '@/lib/types';

/**
 * SPEC-CHANGES §1 — always enabled, never disabled at/over cap: creating a
 * project starts it at Idea, which is free (PRD §3.3). The cap only bites
 * once a project is moved to Building, which goes through
 * `StageMoveModal`'s cost preview instead.
 */
export function NewProjectButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [resolution, setResolution] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [kind, setKind] = useState<ProjectKind>('project');
  const [repo, setRepo] = useState('');
  const [errors, setErrors] = useState<{
    name?: string;
    next_action?: string;
    github_repo?: string;
    general?: string;
  }>({});
  const [pending, startTransition] = useTransition();

  const repoPreview = repo.trim() ? normalizeGithubRepo(repo) : null;

  function reset() {
    setName('');
    setResolution('');
    setNextAction('');
    setTargetDate('');
    setKind('project');
    setRepo('');
    setErrors({});
  }

  function submit() {
    startTransition(async () => {
      const res = await createProjectAction({
        name,
        next_action: nextAction,
        resolution: resolution || undefined,
        stage_target_date: targetDate || null,
        kind,
        github_repo: repo.trim() || null,
      });
      if (res.ok) {
        reset();
        setOpen(false);
      } else if (res.field === 'name') {
        setErrors({ name: res.error });
      } else if (res.field === 'next_action') {
        setErrors({ next_action: res.error });
      } else if (res.field === 'github_repo') {
        setErrors({ github_repo: res.error });
      } else {
        setErrors({ general: res.error });
      }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        New project
      </Button>

      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          reset();
        }}
        title={kind === 'area' ? 'New area' : 'New project'}
        description={
          kind === 'area'
            ? 'An ongoing venture. Never finished, never stuck, never counted against the cap.'
            : 'Starts in Idea. Free — no cap, no clock, until it moves.'
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
                reset();
              }}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button onClick={submit} loading={pending}>
              Create
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {errors.general && <p className="text-xs text-warn">{errors.general}</p>}
          <KindSelector value={kind} onChange={setKind} />
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
            autoFocus
          />
          <Textarea
            label="Resolution"
            hint="One line. What does done actually look like?"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
          />
          <Textarea
            label="Next action"
            hint="Required. The one thing that moves this forward."
            value={nextAction}
            onChange={(e) => setNextAction(e.target.value)}
            error={errors.next_action}
          />
          <Input
            type="date"
            label="Target date (optional)"
            hint="For this stage — Idea, in this case."
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
          />
          <Input
            label="GitHub repo (optional)"
            hint={
              repoPreview
                ? `Commits on github.com/${repoPreview} count as progress.`
                : 'owner/name or a github.com URL. Commits count as progress.'
            }
            placeholder="isaacsplash18/tally"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            error={errors.github_repo ?? (repo.trim() && !repoPreview ? 'Must look like owner/name.' : undefined)}
          />
        </div>
      </Modal>
    </>
  );
}

function KindSelector({
  value,
  onChange,
}: {
  value: ProjectKind;
  onChange: (kind: ProjectKind) => void;
}) {
  const options: { kind: ProjectKind; label: string }[] = [
    { kind: 'project', label: 'Project' },
    { kind: 'area', label: 'Area' },
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">Kind</span>
      <div role="radiogroup" aria-label="Kind" className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
        {options.map((option) => (
          <button
            key={option.kind}
            type="button"
            role="radio"
            aria-checked={value === option.kind}
            onClick={() => onChange(option.kind)}
            className={cn(
              'h-9 rounded-lg text-sm font-medium transition-colors',
              value === option.kind
                ? 'bg-accent text-accent-ink'
                : 'text-muted hover:bg-surface-3 hover:text-text',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-faint">
        {value === 'area'
          ? 'Ongoing — shows in its own strip, outside the cap, stuck and scores.'
          : 'Finishable — moves through the stages and counts toward the cap.'}
      </p>
    </div>
  );
}
