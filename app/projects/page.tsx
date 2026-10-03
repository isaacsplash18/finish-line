import { AppShell, WipCounter } from '@/components';
import { AreasStrip, type AreaItem } from '@/components/projects/AreasStrip';
import { KanbanBoard } from '@/components/projects/KanbanBoard';
import { NewProjectButton } from '@/components/projects/NewProjectButton';
import { daysBetween, today } from '@/lib/dates';
import {
  computeWipStatus,
  getCurrentSeason,
  getProgressEventsSince,
  getProjects,
  progressLookbackStart,
} from '@/lib/data';
import { isArea, isVisibleInSeason } from '@/lib/scores';

export const metadata = { title: 'Projects' };

export default async function ProjectsPage() {
  // One parallel batch. The v2 reads (season, progress events) degrade to
  // empty before migration 0002 is applied.
  const [projects, season, progress] = await Promise.all([
    getProjects(),
    getCurrentSeason(),
    getProgressEventsSince(progressLookbackStart()),
  ]);

  // The data layer's WIP already excludes areas (SPEC-V2 §5).
  const wip = computeWipStatus(projects);

  const areas = projects.filter((p) => isArea(p) && !p.isTerminal);
  const board = projects.filter((p) => !isArea(p));

  // SPEC-V2 §7: terminal projects from before this season start hidden by default.
  const seasonStart = season?.started_at ?? null;
  const visible = board.filter((p) => isVisibleInSeason(p, seasonStart));
  const earlierSeasons = board.filter((p) => !isVisibleInSeason(p, seasonStart));

  const lastProgress = new Map<string, string>();
  for (const event of progress) {
    const prev = lastProgress.get(event.project_id);
    if (!prev || event.day > prev) lastProgress.set(event.project_id, event.day);
  }
  const now = today();
  const areaItems: AreaItem[] = areas.map((project) => {
    const last = lastProgress.get(project.id);
    const fromEvents = last ? Math.max(0, daysBetween(last, now)) : Number.POSITIVE_INFINITY;
    // The row's own clocks (stage / next-action) are the fallback and a floor.
    return { project, daysSinceProgress: Math.min(project.daysIdle, fromEvents) };
  });

  return (
    <AppShell
      title="Projects"
      action={
        <>
          <WipCounter activeCount={wip.activeCount} cap={wip.cap} dailyBleed={wip.dailyBleed} />
          <NewProjectButton />
        </>
      }
      bleed
    >
      <AreasStrip areas={areaItems} />
      <KanbanBoard projects={visible} earlierSeasons={earlierSeasons} />
    </AppShell>
  );
}
