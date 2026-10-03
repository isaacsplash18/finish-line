/**
 * Pure GitHub helpers for SPEC-V2 §6 ("GitHub as a progress signal").
 * The network call lives in `lib/data/github.ts`; everything here is testable.
 */

import { config as defaultConfig, type AppConfig } from './config';
import { toDateKey } from './dates';
import type { DateKey } from './types';

const REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;

/**
 * Normalise what Isaac pastes into the canonical `owner/name`:
 *   "isaacsplash18/tally", "https://github.com/isaacsplash18/tally",
 *   "github.com/isaacsplash18/tally.git", "git@github.com:isaacsplash18/tally.git"
 * Returns null for anything that is not a single owner/name pair.
 * (Mirrors the `projects_github_repo_format` CHECK in 0002_v2.sql.)
 */
export function normalizeGithubRepo(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  let value = input.trim();
  if (!value) return null;
  value = value
    .replace(/^git@github\.com:/i, '')
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  return REPO.test(value) ? value : null;
}

/** The shape of one item from `GET /repos/{owner}/{repo}/commits` that we read. */
export interface GithubCommitItem {
  commit?: {
    author?: { date?: string | null } | null;
    committer?: { date?: string | null } | null;
  } | null;
}

/**
 * Distinct app-timezone days with at least one commit, newest first. Uses the
 * author date (when the work was done), falling back to the committer date.
 * Commits older than `since` are dropped (GitHub filters by committer date).
 */
export function commitDays(
  items: readonly GithubCommitItem[],
  since?: Date | string,
  cfg: AppConfig = defaultConfig,
): DateKey[] {
  const sinceMs = since ? new Date(since).getTime() : null;
  const days = new Set<DateKey>();
  for (const item of items) {
    const raw = item.commit?.author?.date ?? item.commit?.committer?.date;
    if (!raw) continue;
    const at = new Date(raw);
    if (Number.isNaN(at.getTime())) continue;
    if (sinceMs !== null && at.getTime() < sinceMs) continue;
    days.add(toDateKey(at, cfg.timezone));
  }
  return [...days].sort().reverse();
}

/** Build the commits URL for a repo and lookback start. */
export function commitsUrl(
  repo: string,
  since: Date,
  cfg: AppConfig = defaultConfig,
): string {
  const [owner, name] = repo.split('/');
  const params = new URLSearchParams({ since: since.toISOString(), per_page: '100' });
  return `${cfg.github.apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits?${params}`;
}
