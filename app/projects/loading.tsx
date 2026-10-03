import { AppShell, Skeleton, SkeletonCard } from '@/components';

const COLUMNS = ['Idea', 'Building', 'Shipped', 'Commercialising', 'Done / Killed'];

/** Kanban skeleton: five columns of placeholder cards, same snap-scroll frame as the board. */
export default function ProjectsLoading() {
  return (
    <AppShell title="Projects" bleed>
      <div
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 pt-1 lg:snap-none lg:px-8"
        aria-busy="true"
        aria-label="Loading projects"
      >
        {COLUMNS.map((label, col) => (
          <section
            key={label}
            className="flex w-[82vw] shrink-0 snap-start flex-col sm:w-80 lg:w-72 lg:shrink-0"
          >
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
                {label}
              </h2>
              <Skeleton className="h-3 w-3" />
            </div>
            <div className="flex flex-1 flex-col gap-3">
              {Array.from({ length: col === 1 ? 2 : col === 4 ? 1 : 2 }, (_, i) => (
                <SkeletonCard key={i}>
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="mt-3 h-3 w-full" />
                  <Skeleton className="mt-3 h-5 w-20 rounded-full" />
                </SkeletonCard>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
