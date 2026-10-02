'use client';

import { useMemo, useState, useTransition } from 'react';

import { importProjectAction } from '@/app/settings/actions';
import { Button, Card, Input, SectionTitle, Select, Textarea } from '@/components';
import { today } from '@/lib/dates';
import { describeImportImpact } from '@/lib/scores';
import { STAGE_LABELS, type ImportProjectInput } from '@/lib/types';

type ImportableStage = ImportProjectInput['stage'];

const IMPORTABLE_STAGES: readonly ImportableStage[] = ['building', 'shipped', 'commercialising'];

function isActiveStage(stage: ImportableStage): boolean {
  return stage === 'building' || stage === 'commercialising';
}

export interface ImportProjectsSectionProps {
  /** Projects currently Building or Commercialising, right now. */
  activeCount: number;
  /** The soft WIP cap. */
  cap: number;
}

/**
 * "Import existing projects" (feature spec, this change). For real, in-flight
 * work that predates the app — no -15 entry charge into Building, ever. If
 * it pushes the portfolio over the soft cap, the over-cap bleed still starts
 * (from tomorrow — see `importProject` / `IMPORT_EVENT_MARKER`), so the price
 * is shown up front here, same as every other affordance in the app.
 *
 * Ideas don't belong here — they're free. Use the normal "New project" flow
 * on the Projects screen for those.
 */
export function ImportProjectsSection({ activeCount, cap }: ImportProjectsSectionProps) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [resolution, setResolution] = useState('');
  const [stage, setStage] = useState<ImportableStage>('building');
  const [startedAt, setStartedAt] = useState(today());
  const [nextAction, setNextAction] = useState('');
  const [stageTargetDate, setStageTargetDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const activeCountAfter = activeCount + (isActiveStage(stage) ? 1 : 0);
  const impact = useMemo(() => describeImportImpact(activeCountAfter), [activeCountAfter]);

  function reset() {
    setName('');
    setResolution('');
    setStage('building');
    setStartedAt(today());
    setNextAction('');
    setStageTargetDate('');
  }

  function handleSubmit() {
    if (!name.trim()) return setError('Give it a name.');
    if (!nextAction.trim()) return setError('Every project needs a next action. That is the whole point.');
    if (!startedAt) return setError('When did this actually start?');
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await importProjectAction({
        name,
        resolution: resolution.trim() || null,
        stage,
        startedAt,
        nextAction,
        stageTargetDate: stageTargetDate || null,
      });
      if (!result.ok) setError(result.error);
      else {
        setSuccess(`Imported "${name}" — no Focus charge.`);
        reset();
      }
    });
  }

  return (
    <Card>
      <SectionTitle>Import existing projects</SectionTitle>
      <p className="mb-3 text-xs text-faint">
        Already running before Finish Line existed? Bring it in as-is — no -15 entry
        charge, no pretending it just started. Ideas are free anyway, so this is only
        for something already in Building, Shipped, or Commercialising. Currently{' '}
        {activeCount} of {cap} active.
      </p>

      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-2 p-4">
        <Input
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Lazy AI Course round 2"
        />
        <Textarea
          label="Resolution"
          hint="Optional. One line: what does done look like?"
          value={resolution}
          onChange={(event) => setResolution(event.target.value)}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Stage"
            value={stage}
            onChange={(event) => setStage(event.target.value as ImportableStage)}
          >
            {IMPORTABLE_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </Select>
          <Input
            label="Actually started"
            type="date"
            value={startedAt}
            max={today()}
            onChange={(event) => setStartedAt(event.target.value)}
            hint="Drives days-in-stage on the kanban. Never backdates the score."
          />
        </div>

        <Textarea
          label="Next action"
          hint="Required — every project needs one."
          value={nextAction}
          onChange={(event) => setNextAction(event.target.value)}
        />
        <Input
          label="Stage target date"
          type="date"
          value={stageTargetDate}
          onChange={(event) => setStageTargetDate(event.target.value)}
          hint="Optional."
        />

        {impact.copy && <p className="text-xs text-warn">{impact.copy}</p>}
        <p className="text-xs text-faint">
          Importing never costs Focus — the usual -15 charge for starting a new build
          is waived for work that already existed.
        </p>

        {error && <p className="text-xs text-warn">{error}</p>}
        {success && <p className="text-xs text-positive">{success}</p>}

        <div className="flex justify-end">
          <Button variant="primary" size="sm" onClick={handleSubmit} loading={isPending}>
            Import project
          </Button>
        </div>
      </div>
    </Card>
  );
}
