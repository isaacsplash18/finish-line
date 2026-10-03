import Link from 'next/link';

import { AppShell, EmptyState } from '@/components';
import { RoutineHeatCard } from '@/components/routines/RoutineHeatCard';
import { config } from '@/lib/config';
import { today } from '@/lib/dates';
import { getRoutinesWithChecks, sabbathDaysOf } from '@/lib/data';

export const metadata = { title: 'Routines' };

/**
 * Routines (PRD §5 + §8.4): one 4-week Beaver-Habits-style heat calendar per
 * active routine, weekly progress against target, and the 1-tap check-off.
 * Adding, removing, or deactivating routines lives in Settings.
 */
export default async function RoutinesPage() {
  const asOf = today();
  const days = config.ui.heatCalendarWeeks * 7;

  // Sabbath days come out of the routines/checks we already loaded.
  const routines = await getRoutinesWithChecks({ days, asOf });
  const sabbathDays = sabbathDaysOf(routines);

  const sabbathRoutine = routines.find((r) => r.is_sabbath) ?? null;
  const regularRoutines = routines.filter((r) => !r.is_sabbath);

  return (
    <AppShell
      title="Routines"
      subtitle="Tap today — or any day this week — to check it off. History is locked in."
    >
      <div className="flex flex-col gap-5">
        {routines.length === 0 ? (
          <EmptyState>
            No active routines yet.{' '}
            <Link href="/settings" className="text-accent underline underline-offset-2">
              Add one in Settings
            </Link>
            .
          </EmptyState>
        ) : (
          <>
            {regularRoutines.map((routine) => (
              <RoutineHeatCard key={routine.id} routine={routine} sabbathDays={sabbathDays} />
            ))}
            {sabbathRoutine && (
              <RoutineHeatCard routine={sabbathRoutine} sabbathDays={sabbathDays} />
            )}
          </>
        )}

        <div className="flex justify-center pt-1">
          <Link
            href="/settings"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            Manage routines in Settings
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
