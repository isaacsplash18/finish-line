import Link from 'next/link';

import { Card, StageBadge } from '@/components';
import type { ProjectWithMeta } from '@/lib/types';

export interface ActiveProjectCardProps {
  project: ProjectWithMeta;
}

/**
 * One row in the dashboard's active-projects list (PRD §8.1): stage badge,
 * next action, days-in-stage. Stuck projects get the red pulse treatment
 * (shared `Card tone="stuck"`) — the one place on this screen red is allowed.
 */
export function ActiveProjectCard({ project }: ActiveProjectCardProps) {
  const overdue = project.daysToTarget != null && project.daysToTarget < 0;

  return (
    <Card as="li" tone={project.isStuck ? 'stuck' : 'default'} className="list-none">
      <Link href={`/projects/${project.id}`} className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-text">{project.name}</span>
          <StageBadge stage={project.stage} stuck={project.isStuck} size="sm" />
        </div>

        <p className="truncate text-sm text-muted">{project.next_action}</p>

        <p className="tabular text-xs text-faint">
          {project.daysInStage} {project.daysInStage === 1 ? 'day' : 'days'} in stage
          {project.daysToTarget != null && (
            <>
              {' · '}
              {overdue ? (
                <span className="text-warn">{Math.abs(project.daysToTarget)}d overdue</span>
              ) : (
                <>target in {project.daysToTarget}d</>
              )}
            </>
          )}
        </p>
      </Link>
    </Card>
  );
}
