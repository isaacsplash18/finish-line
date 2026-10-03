import { AppShell, SectionTitle, Skeleton, SkeletonCard } from '@/components';

/**
 * Home skeleton, matching the v2 layout: the one big move card with its two
 * buttons, the Focus tile, the four counters, then the routine checklist.
 */
export default function DashboardLoading() {
  return (
    <AppShell title="Today" subtitle="Finish what you start.">
      <div className="flex flex-col gap-10" aria-busy="true" aria-label="Loading today">
        <div className="flex flex-col gap-4">
          <SkeletonCard className="p-5 sm:p-6">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-4 h-9 w-full" />
            <Skeleton className="mt-2 h-9 w-2/3" />
            <Skeleton className="mt-4 h-4 w-40" />
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Skeleton className="h-16 rounded-2xl" />
              <Skeleton className="h-16 rounded-2xl" />
            </div>
          </SkeletonCard>

          <SkeletonCard>
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-3 h-12 w-24" />
            <Skeleton className="mt-3 h-4 w-48" />
            <div className="mt-4 flex flex-col gap-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
            </div>
          </SkeletonCard>

          <div className="grid grid-cols-4 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <SkeletonCard key={i} className="rounded-xl px-2.5 py-2.5">
                <Skeleton className="h-6 w-6" />
                <Skeleton className="mt-2 h-2.5 w-full" />
              </SkeletonCard>
            ))}
          </div>

          <Skeleton className="h-7 w-28 rounded-full" />
        </div>

        <section>
          <SectionTitle>Routines</SectionTitle>
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
      </div>
    </AppShell>
  );
}
