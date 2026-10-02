import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AppShell, Card, CardHeader, CountdownChip, RewardCard, SectionTitle, StageBadge } from '@/components';
import { daysBetween, today } from '@/lib/dates';
import { getProject } from '@/lib/data';
import { DangerZone } from '@/components/projects/DangerZone';
import { NextActionEditor } from '@/components/projects/NextActionEditor';
import { StageMoveControls } from '@/components/projects/StageMoveControls';
import { StageTargetDateEditor } from '@/components/projects/StageTargetDateEditor';
import { StageTimeline } from '@/components/projects/StageTimeline';

export const metadata = { title: 'Project' };

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <AppShell
      title={project.name}
      subtitle={
        <Link href="/projects" className="text-accent hover:underline">
          ← Projects
        </Link>
      }
    >
      <div className="flex flex-col gap-4">
        <Card tone={project.isStuck ? 'stuck' : 'default'}>
          <CardHeader>
            <div className="min-w-0">
              <StageBadge stage={project.stage} stuck={project.isStuck} />
              {project.resolution && <p className="mt-2 text-sm text-muted">{project.resolution}</p>}
            </div>
            <p className="shrink-0 text-right text-xs text-faint">
              {project.daysInStage}d in stage
              <br />
              {project.daysIdle}d idle
            </p>
          </CardHeader>

          {project.isTerminal && project.terminal_reason && (
            <p className="mb-3 rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">
              {STAGE_LABEL_VERB[project.stage] ?? 'Ended'}: {project.terminal_reason}
            </p>
          )}

          {!project.isTerminal && <StageMoveControls project={project} size="md" />}
        </Card>

        <Card>
          <SectionTitle>Next action</SectionTitle>
          <NextActionEditor
            projectId={project.id}
            nextAction={project.next_action}
            isTerminal={project.isTerminal}
          />
        </Card>

        <Card>
          <SectionTitle>Target date</SectionTitle>
          <StageTargetDateEditor
            projectId={project.id}
            stageTargetDate={project.stage_target_date}
            daysToTarget={project.daysToTarget}
            isTerminal={project.isTerminal}
          />
        </Card>

        <Card>
          <SectionTitle>Reward</SectionTitle>
          {project.reward ? (
            <RewardCard reward={project.reward} projectName={project.name} />
          ) : (
            <p className="text-xs text-faint">No reward pinned. Add one from Settings.</p>
          )}
        </Card>

        {project.keyDates.length > 0 && (
          <Card>
            <SectionTitle>Linked key dates</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {project.keyDates.map((keyDate) => {
                const daysAway = daysBetween(today(), keyDate.date);
                return (
                  <CountdownChip
                    key={keyDate.id}
                    name={keyDate.name}
                    daysAway={daysAway}
                    overdue={daysAway < 0 && project.stage !== 'done'}
                  />
                );
              })}
            </div>
          </Card>
        )}

        <Card>
          <SectionTitle>History</SectionTitle>
          <StageTimeline events={project.events} />
        </Card>

        {!project.isTerminal && <DangerZone project={project} reward={project.reward} />}
      </div>
    </AppShell>
  );
}

const STAGE_LABEL_VERB: Partial<Record<string, string>> = {
  done: 'Finished',
  killed: 'Killed',
  abandoned: 'Abandoned',
};
