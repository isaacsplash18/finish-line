import {
  AppShell,
  CountdownChip,
  EmptyState,
  ScoreHero,
  SectionTitle,
  WipCounter,
} from '@/components';
import { ActiveProjectCard } from '@/components/dashboard/ActiveProjectCard';
import { RewardStrip } from '@/components/dashboard/RewardStrip';
import { RoutineChecklist } from '@/components/dashboard/RoutineChecklist';
import { getDashboardData } from '@/lib/data';

export const metadata = { title: 'Dashboard' };

/** Delta vs the previous day's snapshot, or null if there isn't one. */
function deltaOf(values: number[]): number | null {
  if (values.length < 2) return null;
  return values[values.length - 1] - values[values.length - 2];
}

function flowCaption(flow: number): string {
  if (flow >= 90) return 'Locked in.';
  if (flow >= 70) return 'Mostly on pace.';
  if (flow >= 40) return 'Slipping.';
  return "You're not doing the routines.";
}

function focusCaption(stuckCount: number, isOverCap: boolean, overBy: number, dailyBleed: number, focus: number): string {
  if (stuckCount > 0) {
    return `${stuckCount} ${stuckCount === 1 ? 'project' : 'projects'} stuck, bleeding.`;
  }
  if (isOverCap) {
    return `${overBy} over cap — ${dailyBleed}/day gone.`;
  }
  if (focus >= 90) return 'Clean.';
  return 'Recovering.';
}

function lockReasonFor(stuckCount: number, isOverCap: boolean, wipLabel: string): string | undefined {
  if (!stuckCount && !isOverCap) return undefined;
  const parts: string[] = [];
  if (stuckCount) parts.push(`${stuckCount} ${stuckCount === 1 ? 'project' : 'projects'} stuck`);
  if (isOverCap) parts.push(`${wipLabel} — over cap`);
  return parts.join(', ');
}

export default async function DashboardPage() {
  const data = await getDashboardData();

  const flowHistory = data.snapshots.map((s) => s.flow);
  const focusHistory = data.snapshots.map((s) => s.focus);
  const flowDelta = deltaOf(flowHistory);
  const focusDelta = deltaOf(focusHistory);

  // Projects worth surfacing: everything Active, plus any stuck project that
  // isn't Active (e.g. a Shipped project gone idle) — the last mile is the
  // whole point of this app, it should not be able to hide off-screen.
  const activeIds = new Set(data.activeProjects.map((p) => p.id));
  const extraStuck = data.stuckProjects.filter((p) => !activeIds.has(p.id));
  const projectsToShow = [...data.activeProjects, ...extraStuck];

  const lockReason = lockReasonFor(data.stuckProjects.length, data.isOverCap, data.wip.label);

  return (
    <AppShell
      title="Dashboard"
      subtitle="Finish what you start."
      action={<WipCounter activeCount={data.wip.activeCount} cap={data.wip.cap} dailyBleed={data.wip.dailyBleed} />}
    >
      <div className="flex flex-col gap-8">
        {/* Scores */}
        <section className="grid grid-cols-2 gap-3">
          <ScoreHero
            label="Flow"
            value={data.flow}
            history={flowHistory}
            delta={flowDelta}
            caption={flowCaption(data.flow)}
            tone="positive"
          />
          <ScoreHero
            label="Focus"
            value={data.focus}
            history={focusHistory}
            delta={focusDelta}
            caption={focusCaption(data.stuckProjects.length, data.isOverCap, data.wip.overBy, data.wip.dailyBleed, data.focus)}
            tone="accent"
          />
        </section>

        {/* Today's routines */}
        <section>
          <SectionTitle>Today</SectionTitle>
          <RoutineChecklist routines={data.routines} />
        </section>

        {/* Active projects */}
        <section>
          <SectionTitle action={<span className="tabular text-xs text-faint">{projectsToShow.length}</span>}>
            Active projects
          </SectionTitle>
          {projectsToShow.length === 0 ? (
            <EmptyState>
              Nothing active. Either you finished everything or you haven&apos;t started.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-3">
              {projectsToShow.map((project) => (
                <ActiveProjectCard key={project.id} project={project} />
              ))}
            </ul>
          )}
        </section>

        {/* Key dates */}
        <section>
          <SectionTitle>Coming up</SectionTitle>
          {data.keyDates.length === 0 ? (
            <EmptyState>No key dates yet.</EmptyState>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.keyDates.map((kd) => (
                <CountdownChip
                  key={kd.id}
                  name={kd.name}
                  daysAway={kd.daysAway}
                  projectName={kd.project?.name}
                  overdue={kd.daysAway < 0 && kd.project != null && kd.project.stage !== 'done'}
                />
              ))}
            </div>
          )}
        </section>

        {/* Rewards */}
        <section>
          <SectionTitle>Rewards</SectionTitle>
          <RewardStrip rewards={data.rewards} lockReason={lockReason} />
        </section>
      </div>
    </AppShell>
  );
}
