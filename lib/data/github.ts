import 'server-only';

import { config } from '@/lib/config';
import { commitDays, commitsUrl, normalizeGithubRepo, type GithubCommitItem } from '@/lib/github';
import { isArea } from '@/lib/scores';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type { DateKey, Project, UUID } from '@/lib/types';

import { isMissingSchemaError } from './errors';
import { recomputeStuckFlags } from './projects';

export type GithubRepoStatus = 'ok' | 'not_found' | 'rate_limited' | 'unauthorized' | 'error';

export interface GithubRepoSyncResult {
  projectId: UUID;
  projectName: string;
  repo: string;
  status: GithubRepoStatus;
  /** SGT days with at least one commit in the lookback window, newest first. */
  commitDays: DateKey[];
  /** New `progress_events(kind='commit')` rows written (already-recorded days are skipped). */
  inserted: number;
  /** Short reason when status is not ok. Never contains the token. */
  detail?: string;
}

export interface GithubSyncResult {
  /** True when GITHUB_TOKEN is set (5000 req/h, private repos); false = unauthenticated (60 req/h, public only). */
  authenticated: boolean;
  lookbackDays: number;
  since: string;
  repos: GithubRepoSyncResult[];
  inserted: number;
  /** True when `recomputeStuckFlags` ran because new commit days landed. */
  restuck: boolean;
}

async function fetchCommits(
  repo: string,
  since: Date,
  token: string | undefined,
): Promise<{ status: GithubRepoStatus; items: GithubCommitItem[]; detail?: string }> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'finish-line',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const response = await fetch(commitsUrl(repo, since), {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(config.github.timeoutMs),
    });
    if (response.ok) {
      const body: unknown = await response.json();
      return { status: 'ok', items: Array.isArray(body) ? (body as GithubCommitItem[]) : [] };
    }
    // 409 = empty repository: no commits, not an error.
    if (response.status === 409) return { status: 'ok', items: [] };
    if (response.status === 404) return { status: 'not_found', items: [], detail: 'Repo not found (or private without a token).' };
    if (response.status === 401) return { status: 'unauthorized', items: [], detail: 'GITHUB_TOKEN rejected.' };
    if (response.status === 403 || response.status === 429) {
      const remaining = response.headers.get('x-ratelimit-remaining');
      return {
        status: remaining === '0' || response.status === 429 ? 'rate_limited' : 'error',
        items: [],
        detail: `GitHub ${response.status}`,
      };
    }
    return { status: 'error', items: [], detail: `GitHub ${response.status}` };
  } catch (error) {
    return {
      status: 'error',
      items: [],
      detail: error instanceof Error ? error.name : 'fetch failed',
    };
  }
}

/**
 * SPEC-V2 §6 — commits on a linked repo are a progress signal.
 *
 * For every non-terminal project/area with `github_repo` set, fetch commits
 * from the last `config.github.lookbackDays` (7) days via the GitHub REST API
 * and write one `progress_events(kind='commit')` per SGT commit day; days
 * already recorded are skipped by the table's unique constraint.
 *
 * Uses `GITHUB_TOKEN` when set, otherwise unauthenticated (public repos,
 * 60 requests/hour). NEVER THROWS: a missing token, rate limit, timeout,
 * unknown repo or a not-yet-migrated database each degrade to a per-repo
 * status in the result.
 *
 * When new days land and `recomputeStuck` is true (default), stuck flags are
 * recomputed so a commit un-sticks a project straight away. The nightly job
 * passes false and runs its own pass afterwards.
 */
export async function syncGithubProgress(
  options: { recomputeStuck?: boolean; now?: Date } = {},
): Promise<GithubSyncResult> {
  const token = process.env.GITHUB_TOKEN?.trim() || undefined;
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - config.github.lookbackDays * 86_400_000);
  const result: GithubSyncResult = {
    authenticated: Boolean(token),
    lookbackDays: config.github.lookbackDays,
    since: since.toISOString(),
    repos: [],
    inserted: 0,
    restuck: false,
  };

  let linked: Project[];
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .not('stage', 'in', `(${config.projects.terminalStages.join(',')})`);
    if (error) {
      if (!isMissingSchemaError(error)) console.warn('[github] project read failed:', error.message);
      return result;
    }
    linked = (data ?? []).filter((p) => normalizeGithubRepo(p.github_repo ?? null));
  } catch (error) {
    console.warn('[github] sync skipped:', error instanceof Error ? error.message : error);
    return result;
  }
  if (linked.length === 0) return result;

  const supabase = await getSupabaseServerClient();
  result.repos = await Promise.all(
    linked.map(async (project): Promise<GithubRepoSyncResult> => {
      const repo = normalizeGithubRepo(project.github_repo) as string;
      const fetched = await fetchCommits(repo, since, token);
      const days = commitDays(fetched.items, since);
      let inserted = 0;
      if (days.length > 0) {
        const { data, error } = await supabase
          .from('progress_events')
          .upsert(
            days.map((day) => ({ project_id: project.id, kind: 'commit' as const, day })),
            { onConflict: 'project_id,kind,day', ignoreDuplicates: true },
          )
          .select('id');
        if (error) {
          console.warn(`[github] ${repo}: could not record commit days: ${error.message}`);
          return {
            projectId: project.id,
            projectName: project.name,
            repo,
            status: 'error',
            commitDays: days,
            inserted: 0,
            detail: 'Could not record progress.',
          };
        }
        inserted = data?.length ?? 0;
      }
      return {
        projectId: project.id,
        projectName: project.name,
        repo,
        status: fetched.status,
        commitDays: days,
        inserted,
        ...(fetched.detail ? { detail: fetched.detail } : {}),
      };
    }),
  );
  result.inserted = result.repos.reduce((sum, r) => sum + r.inserted, 0);

  // Only scored projects can be un-stuck by a commit; areas are never stuck.
  const touchedScored = result.repos.some(
    (r) => r.inserted > 0 && !isArea(linked.find((p) => p.id === r.projectId) ?? {}),
  );
  if (touchedScored && options.recomputeStuck !== false) {
    try {
      await recomputeStuckFlags();
      result.restuck = true;
    } catch (error) {
      console.warn('[github] stuck recompute failed:', error instanceof Error ? error.message : error);
    }
  }

  return result;
}
