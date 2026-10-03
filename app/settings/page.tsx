import { headers } from 'next/headers';

import { AppShell } from '@/components';
import { GithubSection, type LinkedRepo } from '@/components/settings/GithubSection';
import { ImportProjectsSection } from '@/components/settings/ImportProjectsSection';
import { KeyDatesSection } from '@/components/settings/KeyDatesSection';
import { RecomputeSection } from '@/components/settings/RecomputeSection';
import { ReviewLinkCard } from '@/components/settings/ReviewLinkCard';
import { RewardsSection } from '@/components/settings/RewardsSection';
import { RoutinesSection } from '@/components/settings/RoutinesSection';
import { ScoreTuning } from '@/components/settings/ScoreTuning';
import { SeasonSection } from '@/components/settings/SeasonSection';
import { WorkoutHookSection } from '@/components/settings/WorkoutHookSection';
import { config } from '@/lib/config';
import { toDateKey } from '@/lib/dates';
import {
  computeWipStatus,
  getCurrentSeason,
  getKeyDates,
  getProgressEventsSince,
  getProjects,
  getRewards,
  getRoutines,
  getScoreSnapshots,
  progressLookbackStart,
} from '@/lib/data';
import { isArea, isVisibleInSeason } from '@/lib/scores';

export const metadata = { title: 'Settings' };

/**
 * Settings (PRD §8.5): rewards CRUD, key dates CRUD, routines CRUD, a
 * read-only mirror of the score-tuning config, and the manual recompute
 * button. v2: weekly-review link, seasons, GitHub sync, workout hook.
 */
export default async function SettingsPage() {
  // One parallel batch (getProjects and getKeyDates share a single deduped
  // projects read; the v2 reads degrade to empty before migration 0002). Terminal / WIP views are derived in memory.
  const [rewards, allProjects, keyDates, routines, snapshots, season, progress, requestHeaders] =
    await Promise.all([
      getRewards(),
      getProjects(),
      getKeyDates(),
      getRoutines(true),
      getScoreSnapshots(config.ui.sparklinePoints),
      getCurrentSeason(),
      getProgressEventsSince(progressLookbackStart()),
      headers(),
    ]);
  const wip = computeWipStatus(allProjects);
  // "Not-done" projects a reward or key date can be pinned to.
  const assignableProjects = allProjects.filter((p) => !p.isTerminal);

  const projectsById = Object.fromEntries(
    allProjects.map((p) => [p.id, { name: p.name, stage: p.stage }]),
  );
  const projectOptions = assignableProjects.map((p) => ({ id: p.id, name: p.name, stage: p.stage }));

  // v2 §7: what "Start a new season" would hide / carry over (areas are neither).
  const scored = allProjects.filter((p) => !isArea(p));
  const willHide = scored.filter((p) => p.isTerminal && isVisibleInSeason(p, season?.started_at ?? null)).length;
  const carryOver = scored.filter((p) => !p.isTerminal).length;

  // v2 §6: booleans only, the token itself never leaves the server.
  const githubTokenConfigured = !!process.env.GITHUB_TOKEN;
  const lastCommit = new Map<string, string>();
  for (const e of progress) {
    if (e.kind === 'commit' && (lastCommit.get(e.project_id) ?? '') < e.day) lastCommit.set(e.project_id, e.day);
  }
  const linkedRepos: LinkedRepo[] = allProjects
    .filter((p) => p.github_repo && !p.isTerminal)
    .map((p) => ({
      projectId: p.id,
      projectName: p.name,
      repo: p.github_repo as string,
      isArea: isArea(p),
      lastCommitDay: lastCommit.get(p.id) ?? null,
    }));

  // v2 §8
  const workoutTokenConfigured = !!process.env.WORKOUT_HOOK_TOKEN;
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  const proto = requestHeaders.get('x-forwarded-proto') ?? (host?.startsWith('localhost') ? 'http' : 'https');
  const origin = host ? `${proto}://${host}` : 'https://your-app.vercel.app';
  const workoutRoutineExists = routines.some(
    (r) => r.active && r.name.trim().toLowerCase() === config.hooks.workoutRoutineName.toLowerCase(),
  );

  const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

  return (
    <AppShell
      title="Settings"
      subtitle="Review, seasons, rewards, routines, integrations, and the numbers behind the scores."
    >
      <div className="flex flex-col gap-5">
        <ReviewLinkCard />
        <SeasonSection
          seasonName={season?.name ?? null}
          startedOn={season ? toDateKey(season.started_at) : null}
          willHide={willHide}
          carryOver={carryOver}
        />
        <ImportProjectsSection activeCount={wip.activeCount} cap={wip.cap} />
        <RewardsSection
          rewards={rewards}
          projectsById={projectsById}
          assignableProjects={projectOptions}
        />
        <KeyDatesSection keyDates={keyDates} linkableProjects={projectOptions} />
        <RoutinesSection routines={routines} />
        <GithubSection
          tokenConfigured={githubTokenConfigured}
          lookbackDays={config.github.lookbackDays}
          repos={linkedRepos}
        />
        <WorkoutHookSection
          tokenConfigured={workoutTokenConfigured}
          origin={origin}
          routineName={config.hooks.workoutRoutineName}
          routineExists={workoutRoutineExists}
        />
        <ScoreTuning />
        <RecomputeSection latestSnapshot={latestSnapshot} />
      </div>
    </AppShell>
  );
}
