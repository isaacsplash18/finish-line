import { AppShell } from '@/components';
import { ImportProjectsSection } from '@/components/settings/ImportProjectsSection';
import { KeyDatesSection } from '@/components/settings/KeyDatesSection';
import { RecomputeSection } from '@/components/settings/RecomputeSection';
import { RewardsSection } from '@/components/settings/RewardsSection';
import { RoutinesSection } from '@/components/settings/RoutinesSection';
import { ScoreTuning } from '@/components/settings/ScoreTuning';
import { config } from '@/lib/config';
import {
  getKeyDates,
  getProjects,
  getRewards,
  getRoutines,
  getScoreSnapshots,
  getWipStatus,
} from '@/lib/data';

export const metadata = { title: 'Settings' };

/**
 * Settings (PRD §8.5): rewards CRUD, key dates CRUD, routines CRUD, a
 * read-only mirror of the score-tuning config, and the manual recompute
 * button.
 */
export default async function SettingsPage() {
  const [rewards, allProjects, assignableProjects, keyDates, routines, snapshots, wip] =
    await Promise.all([
      getRewards(),
      getProjects({ includeTerminal: true }),
      // "Not-done" projects a reward or key date can be pinned to.
      getProjects({ includeTerminal: false }),
      getKeyDates(),
      getRoutines(true),
      getScoreSnapshots(config.ui.sparklinePoints),
      getWipStatus(),
    ]);

  const projectsById = Object.fromEntries(
    allProjects.map((p) => [p.id, { name: p.name, stage: p.stage }]),
  );
  const projectOptions = assignableProjects.map((p) => ({ id: p.id, name: p.name, stage: p.stage }));
  const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

  return (
    <AppShell title="Settings" subtitle="Rewards, key dates, routines, and the numbers behind the scores.">
      <div className="flex flex-col gap-5">
        <ImportProjectsSection activeCount={wip.activeCount} cap={wip.cap} />
        <RewardsSection
          rewards={rewards}
          projectsById={projectsById}
          assignableProjects={projectOptions}
        />
        <KeyDatesSection keyDates={keyDates} linkableProjects={projectOptions} />
        <RoutinesSection routines={routines} />
        <ScoreTuning />
        <RecomputeSection latestSnapshot={latestSnapshot} />
      </div>
    </AppShell>
  );
}
