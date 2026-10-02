import { AppShell, WipCounter } from '@/components';
import { getProjects, getWipStatus } from '@/lib/data';
import { KanbanBoard } from '@/components/projects/KanbanBoard';
import { NewProjectButton } from '@/components/projects/NewProjectButton';

export const metadata = { title: 'Projects' };

export default async function ProjectsPage() {
  const [projects, wip] = await Promise.all([getProjects(), getWipStatus()]);

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
