import { AppShell, SectionTitle, Skeleton, SkeletonCard } from '@/components';

/** Dashboard skeleton: two score tiles, the routine checklist, project cards. */
export default function DashboardLoading() {
  return (
    <AppShell title="Dashboard" subtitle="Finish what you start.">
      <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading dashboard">
        <section className="grid grid-cols-2 gap-3">
          {[0, 1].map((i) => (
            <SkeletonCard key={i}>
              <Skeleton className="h-3 w-12" />
              <Skeleton className="mt-3 h-14 w-24" />
              <Skeleton className="mt-3 h-8 w-full" />
              <Skeleton className="mt-3 h-3 w-3/4" />
            </SkeletonCard>
          ))}
        </section>

        <section>
          <SectionTitle>Today</SectionTitle>
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <SkeletonCard key={i} className="flex items-center gap-3 rounded-xl px-4 py-3">
                <Skeleton className="size-6 shrink-0 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="mt-1.5 h-3 w-1/4" />
                </div>
              </SkeletonCard>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle>Active projects</SectionTitle>
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <SkeletonCard key={i}>
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="mt-3 h-3 w-full" />
                <Skeleton className="mt-2 h-3 w-2/3" />
              </SkeletonCard>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
