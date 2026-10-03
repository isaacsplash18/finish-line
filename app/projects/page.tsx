import { AppShell, WipCounter } from '@/components';
import { computeWipStatus, getProjects } from '@/lib/data';
import { KanbanBoard } from '@/components/projects/KanbanBoard';
import { NewProjectButton } from '@/components/projects/NewProjectButton';

export const metadata = { title: 'Projects' };

export default async function ProjectsPage() {
  // One projects read; the WIP counter is derived from it in memory.
  const projects = await getProjects();
  const wip = computeWipStatus(projects);

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
      <KanbanBoard projects={projects} />
    </AppShell>
  );
}
