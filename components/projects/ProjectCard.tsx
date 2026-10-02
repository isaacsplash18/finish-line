import Link from 'next/link';

import { Card, StageBadge } from '@/components';
import { humanCountdown } from '@/lib/dates';
import type { ProjectWithMeta } from '@/lib/types';
import { StageMoveControls } from './StageMoveControls';

export interface ProjectCardProps {
  project: ProjectWithMeta;
}

/**
 * A kanban card (PRD §8.2). Stuck projects pulse red via `Card tone="stuck"`.
 * The name/next-action block is a plain link to the detail page; the stage
 * controls live in their own row below so we never nest interactive elements
 * inside the anchor.
 */
export function ProjectCard({ project }: ProjectCardProps) {
  return (
    <Card as="li" tone={project.isStuck ? 'stuck' : 'default'} className="flex flex-col gap-3">
      <Link href={`/projects/${project.id}`} className="block min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 line-clamp-2 text-sm font-semibold text-text">{project.name}</h3>
          <StageBadge stage={project.stage} stuck={project.isStuck} size="sm" />
        </div>
        <p className="mt-1.5 line-clamp-2 text-xs text-muted">
          <span className="text-faint">Next: </span>
          {project.next_action}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
          <span>{project.daysInStage}d in stage</span>
          {project.daysToTarget != null && (
            <span className={project.daysToTarget < 0 ? 'text-warn' : undefined}>
              target {humanCountdown(project.daysToTarget)}
            </span>
          )}
          {project.reward && (
            <span className="truncate text-accent">
              ${project.reward.price.toLocaleString('en-US')} {project.reward.name}
            </span>
          )}
        </div>
      </Link>

      <StageMoveControls project={project} size="sm" />
    </Card>
  );
}
