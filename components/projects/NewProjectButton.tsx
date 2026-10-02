'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { createProjectAction } from '@/app/projects/actions';
import { Button, Input, Modal, Textarea } from '@/components';

/**
 * SPEC-CHANGES §1 — always enabled, never disabled at/over cap: creating a
 * project starts it at Idea, which is free (PRD §3.3). The cap only bites
 * once a project is moved to Building, which goes through
 * `StageMoveModal`'s cost preview instead.
 */
export function NewProjectButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [resolution, setResolution] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [errors, setErrors] = useState<{ name?: string; next_action?: string; general?: string }>({});
  const [pending, startTransition] = useTransition();

  function reset() {
    setName('');
    setResolution('');
    setNextAction('');
    setTargetDate('');
    setErrors({});
  }

  function submit() {
    startTransition(async () => {
      const res = await createProjectAction({
        name,
        next_action: nextAction,
        resolution: resolution || undefined,
        stage_target_date: targetDate || null,
      });
      if (res.ok) {
        reset();
        setOpen(false);
        router.refresh();
      } else if (res.field === 'name') {
        setErrors({ name: res.error });
      } else if (res.field === 'next_action') {
        setErrors({ next_action: res.error });
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
        title="New project"
        description="Starts in Idea. Free — no cap, no clock, until it moves."
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
        </div>
      </Modal>
    </>
  );
}
