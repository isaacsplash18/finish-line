import { AppShell, SectionTitle, Skeleton, SkeletonCard } from '@/components';

/** Project detail skeleton: header card, then the editable sections and history. */
export default function ProjectDetailLoading() {
  return (
    <AppShell title="Project" subtitle="Loading…">
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading project">
        <SkeletonCard>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="mt-3 h-3 w-3/4" />
            </div>
            <Skeleton className="h-8 w-16" />
          </div>
          <div className="mt-4 flex gap-2">
            <Skeleton className="h-9 w-24 rounded-xl" />
            <Skeleton className="h-9 w-24 rounded-xl" />
          </div>
        </SkeletonCard>

        {['Next action', 'Target date', 'Reward'].map((title) => (
          <SkeletonCard key={title}>
            <SectionTitle>{title}</SectionTitle>
            <Skeleton className="h-4 w-2/3" />
          </SkeletonCard>
        ))}

        <SkeletonCard>
          <SectionTitle>History</SectionTitle>
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </SkeletonCard>
      </div>
    </AppShell>
  );
}
