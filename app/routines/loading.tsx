import { AppShell, Skeleton, SkeletonCard } from '@/components';

/** Routines skeleton: one heat-calendar card per routine (4 weeks x 7 days). */
export default function RoutinesLoading() {
  return (
    <AppShell
      title="Routines"
      subtitle="Tap today — or any day this week — to check it off. History is locked in."
    >
      <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading routines">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex-1">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="mt-2 h-3 w-1/2" />
              </div>
              <Skeleton className="h-8 w-20" />
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 28 }, (_, d) => (
                <Skeleton key={d} className="aspect-square rounded-md" />
              ))}
            </div>
          </SkeletonCard>
        ))}
      </div>
    </AppShell>
  );
}
