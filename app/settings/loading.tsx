import { AppShell, Skeleton, SkeletonCard } from '@/components';

/** Settings skeleton: the stack of section cards. */
export default function SettingsLoading() {
  return (
    <AppShell title="Settings" subtitle="Rewards, key dates, routines, and the numbers behind the scores.">
      <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading settings">
        {[0, 1, 2, 3, 4].map((i) => (
          <SkeletonCard key={i}>
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-3 h-3 w-2/3" />
            <div className="mt-4 flex flex-col gap-2">
              <Skeleton className="h-10 w-full rounded-xl" />
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
          </SkeletonCard>
        ))}
      </div>
    </AppShell>
  );
}
