import { EmptyState } from '@/components';
import type { ProjectStage, ProjectWithMeta } from '@/lib/types';
import { ProjectCard } from './ProjectCard';

interface Column {
  key: string;
  label: string;
  caption?: string;
  stages: readonly ProjectStage[];
}

/** PRD §8.2 — kanban columns. Done and Killed share a column; Abandoned rides along in it too. */
const COLUMNS: readonly Column[] = [
  { key: 'idea', label: 'Idea', caption: 'Free — no cap, no clock.', stages: ['idea'] },
  { key: 'building', label: 'Building', caption: 'Counts toward the cap.', stages: ['building'] },
  { key: 'shipped', label: 'Shipped', stages: ['shipped'] },
  {
    key: 'commercialising',
    label: 'Commercialising',
    caption: 'Counts toward the cap.',
    stages: ['commercialising'],
  },
  { key: 'terminal', label: 'Done / Killed', stages: ['done', 'killed', 'abandoned'] },
];

export interface KanbanBoardProps {
  projects: ProjectWithMeta[];
}

/**
 * Mobile-first: a horizontally scrollable, snap-scrolling row of columns.
 * At `lg`+ it becomes a fixed 5-column grid with no scrolling needed —
 * project reviews happen at a desk (PRD §10.1).
 */
export function KanbanBoard({ projects }: KanbanBoardProps) {
  const byStage = new Map<ProjectStage, ProjectWithMeta[]>();
  for (const project of projects) {
    const list = byStage.get(project.stage) ?? [];
    list.push(project);
    byStage.set(project.stage, list);
  }

  return (
    <div
      className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 pt-1 lg:snap-none lg:px-8"
    >
      {COLUMNS.map((column) => {
        const items = column.stages.flatMap((stage) => byStage.get(stage) ?? []);
        return (
          <section
            key={column.key}
            className="flex w-[82vw] shrink-0 snap-start flex-col sm:w-80 lg:w-72 lg:shrink-0"
          >
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
                {column.label}
              </h2>
              <span className="tabular text-xs text-faint">{items.length}</span>
            </div>
            {column.caption && <p className="mb-2 text-[11px] text-faint">{column.caption}</p>}

            <ul className="flex flex-1 flex-col gap-3">
              {items.length === 0 ? (
                <li>
                  <EmptyState>Nothing here.</EmptyState>
                </li>
              ) : (
                items.map((project) => <ProjectCard key={project.id} project={project} />)
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
