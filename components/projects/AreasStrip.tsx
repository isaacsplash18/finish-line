import Link from 'next/link';

import type { ProjectWithMeta } from '@/lib/types';

export interface AreaItem {
  project: ProjectWithMeta;
  /** Whole days since the last progress signal (did it / commit / stage / next action). */
  daysSinceProgress: number;
}

export interface AreasStripProps {
  areas: AreaItem[];
}

/**
 * SPEC-V2 §5 — areas are ongoing ventures. They live in their own strip above
 * the kanban: never in a stage column, never in the WIP count, never stuck.
 * No stage controls here; edit the next action or convert back on the detail page.
 */
export function AreasStrip({ areas }: AreasStripProps) {
  if (areas.length === 0) return null;

  return (
    <section aria-label="Ongoing areas" className="px-4 pb-4 pt-1 lg:px-8">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">Ongoing</h2>
        <span className="text-[11px] text-faint">Outside the cap and the stages.</span>
      </div>
      <ul className="flex snap-x gap-3 overflow-x-auto pb-1 lg:grid lg:grid-cols-3 lg:overflow-visible">
        {areas.map(({ project, daysSinceProgress }) => (
          <li key={project.id} className="w-[72vw] shrink-0 snap-start sm:w-64 lg:w-auto">
            <Link
              href={`/projects/${project.id}`}
              className="flex h-full flex-col gap-1.5 rounded-2xl border border-line bg-surface p-3.5 transition-colors hover:border-line-strong"
            >
              <span className="truncate text-sm font-semibold text-text">{project.name}</span>
              <span className="line-clamp-2 text-xs text-muted">
                <span className="text-faint">Next: </span>
                {project.next_action}
              </span>
              <span className="mt-auto pt-1 text-[11px] text-faint">
                {daysSinceProgress <= 0
                  ? 'Progress today'
                  : `${daysSinceProgress}d since last progress`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
