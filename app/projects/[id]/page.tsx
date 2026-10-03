import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AppShell, Card, CardHeader, CountdownChip, RewardCard, SectionTitle, StageBadge } from '@/components';
import { config } from '@/lib/config';
import { daysBetween, today } from '@/lib/dates';
import { getProgressEventsSince, getProject, progressLookbackStart } from '@/lib/data';
import { isArea } from '@/lib/scores';
import { DangerZone } from '@/components/projects/DangerZone';
import { GithubRepoEditor } from '@/components/projects/GithubRepoEditor';
import { KindToggle } from '@/components/projects/KindToggle';
import { NextActionEditor } from '@/components/projects/NextActionEditor';
import { StageMoveControls } from '@/components/projects/StageMoveControls';
import { StageTargetDateEditor } from '@/components/projects/StageTargetDateEditor';
import { ProgressTimeline } from '@/components/projects/ProgressTimeline';
import { StageTimeline } from '@/components/projects/StageTimeline';

/** How much progress history the detail page shows (SPEC-V2 §2: the stuck window). */
const PROGRESS_DAYS = config.projects.staleThresholdDays;

export const metadata = { title: 'Project' };

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [project, progress] = await Promise.all([
    getProject(id),
    // Reads degrade to [] before migration 0002. Filtered to this project in memory.
    getProgressEventsSince(progressLookbackStart()),
  ]);
  if (!project) notFound();

  const now = today();
  const area = isArea(project);
  const mine = progress.filter((e) => e.project_id === project.id);
  const lastProgressDay = mine.reduce<string | null>((max, e) => (!max || e.day > max ? e.day : max), null);
  // Progress events plus the row's own clocks (stage / next-action), whichever is newer.
  const daysSinceProgress = Math.min(
    project.daysIdle,
    lastProgressDay ? Math.max(0, daysBetween(lastProgressDay, now)) : Number.POSITIVE_INFINITY,
  );
  const stuckEligible = !area && config.projects.staleStages.includes(project.stage);
  const recent = mine.filter((e) => daysBetween(e.day, now) < PROGRESS_DAYS);

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
              {area ? (
                <span className="inline-flex items-center whitespace-nowrap rounded-full border border-accent/40 bg-accent-wash px-2.5 py-1 text-xs font-medium text-accent">
                  Ongoing area
                </span>
              ) : (
                <StageBadge stage={project.stage} stuck={project.isStuck} />
              )}
              {project.resolution && <p className="mt-2 text-sm text-muted">{project.resolution}</p>}
            </div>
            <p className="shrink-0 text-right text-xs text-faint">
              {!area && (
                <>
                  {project.daysInStage}d in stage
                  <br />
                </>
              )}
              {daysSinceProgress <= 0 ? 'progress today' : `${daysSinceProgress}d since progress`}
            </p>
          </CardHeader>

          {project.isTerminal && project.terminal_reason && (
            <p className="mb-3 rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">
              {STAGE_LABEL_VERB[project.stage] ?? 'Ended'}: {project.terminal_reason}
            </p>
          )}

          {!project.isTerminal && !area && <StageMoveControls project={project} size="md" />}

          {!project.isTerminal && (
            <p className={project.isStuck ? 'mt-3 text-sm text-danger' : 'mt-3 text-xs text-faint'}>
              {project.isStuck
                ? `Stuck${project.stuck_since ? ` since ${project.stuck_since}` : ''}: no progress signal for ${config.projects.staleThresholdDays} days. A Did-it tap, a commit, a stage move or a next-action edit clears it instantly.`
                : area
                  ? 'Areas are never stuck.'
                  : stuckEligible
                    ? `Goes stuck after ${config.projects.staleThresholdDays} days with no progress signal (${daysSinceProgress} so far).`
                    : 'Ideas never go stuck. The clock starts at Building.'}
            </p>
          )}
        </Card>

        <Card>
          <SectionTitle>Next action</SectionTitle>
          <NextActionEditor
            projectId={project.id}
            nextAction={project.next_action}
            isTerminal={project.isTerminal}
          />
        </Card>

        {!area && (
          <Card>
            <SectionTitle>Target date</SectionTitle>
            <StageTargetDateEditor
              projectId={project.id}
              stageTargetDate={project.stage_target_date}
              daysToTarget={project.daysToTarget}
              isTerminal={project.isTerminal}
            />
          </Card>
        )}

        {!project.isTerminal && (
          <Card>
            <SectionTitle>Kind</SectionTitle>
            <KindToggle
              projectId={project.id}
              kind={project.kind}
              isActiveStage={config.projects.activeStages.includes(project.stage)}
            />
          </Card>
        )}

        <Card>
          <SectionTitle>GitHub</SectionTitle>
          <GithubRepoEditor
            projectId={project.id}
            repo={project.github_repo}
            disabled={project.isTerminal}
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

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <SectionTitle>Progress · last {PROGRESS_DAYS} days</SectionTitle>
            <ProgressTimeline events={recent} days={PROGRESS_DAYS} today={now} />
          </Card>
          <Card>
            <SectionTitle>Stage history</SectionTitle>
            <StageTimeline events={project.events} />
          </Card>
        </div>

        {!project.isTerminal && !area && <DangerZone project={project} reward={project.reward} />}
      </div>
    </AppShell>
  );
}

const STAGE_LABEL_VERB: Partial<Record<string, string>> = {
  done: 'Finished',
  killed: 'Killed',
  abandoned: 'Abandoned',
};
