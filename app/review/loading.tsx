import { AppShell, SectionTitle, Skeleton, SkeletonCard } from '@/components';

/** Review skeleton: project cards with their three buttons, then the summary. */
export default function ReviewLoading() {
  return (
    <AppShell title="Weekly review" subtitle="Keep, kill or finish. Then reset.">
      <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading review">
        <section>
          <SectionTitle>Projects</SectionTitle>
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <SkeletonCard key={i} className="flex flex-col gap-3">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-10 w-full rounded-xl" />
                <div className="grid grid-cols-3 gap-2">
                  <Skeleton className="h-12 rounded-xl" />
                  <Skeleton className="h-12 rounded-xl" />
                  <Skeleton className="h-12 rounded-xl" />
                </div>
              </SkeletonCard>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <SectionTitle>This week</SectionTitle>
          <SkeletonCard>
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-3 h-[4.5rem] w-28" />
            <Skeleton className="mt-3 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-5/6" />
          </SkeletonCard>
          <Skeleton className="h-12 w-full rounded-xl" />
        </section>
      </div>
    </AppShell>
  );
}
