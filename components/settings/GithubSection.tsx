'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import { syncGithubNowAction } from '@/app/settings/actions';
import { Button, Card, SectionTitle } from '@/components';
import type { GithubSyncResult } from '@/lib/data';

export interface LinkedRepo {
  projectId: string;
  projectName: string;
  repo: string;
  isArea: boolean;
  /** Latest SGT day a commit was recorded for it (from progress_events), or null. */
  lastCommitDay: string | null;
}

export interface GithubSectionProps {
  /** `!!process.env.GITHUB_TOKEN`, computed on the server. The value never reaches the client. */
  tokenConfigured: boolean;
  lookbackDays: number;
  repos: LinkedRepo[];
}

const STATUS_LABEL: Record<string, string> = {
  ok: 'ok',
  not_found: 'not found',
  rate_limited: 'rate limited',
  unauthorized: 'token rejected',
  error: 'error',
};

/**
 * SPEC-V2 §6 — GitHub as an optional progress signal. Link repos from each
 * project's detail page; the nightly job and this button record commit days.
 */
export function GithubSection({ tokenConfigured, lookbackDays, repos }: GithubSectionProps) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<GithubSyncResult | null>(null);
  const [error, setError] = useState<string | undefined>();

  function sync() {
    setError(undefined);
    setResult(null);
    startTransition(async () => {
      const res = await syncGithubNowAction();
      if (res.ok) setResult(res.data);
      else setError(res.error);
    });
  }

  return (
    <Card>
      <SectionTitle
        action={
          <Button size="sm" variant="secondary" onClick={sync} loading={pending} disabled={repos.length === 0}>
            Sync now
          </Button>
        }
      >
        GitHub
      </SectionTitle>

      <p className="text-sm text-muted">
        <span className="text-faint">GITHUB_TOKEN: </span>
        {tokenConfigured ? (
          <span className="font-medium text-positive">configured</span>
        ) : (
          <span className="font-medium text-warn">not set</span>
        )}
      </p>
      <p className="mt-1 text-xs text-faint">
        {tokenConfigured
          ? 'Authenticated requests: private repos work and the rate limit is generous.'
          : 'Unauthenticated: public repos only, about 60 requests an hour. Fine for a few repos; it degrades silently.'}{' '}
        The last {lookbackDays} days of commits become progress and clear Stuck.
      </p>

      <div className="mt-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-faint">Linked repos</p>
        {repos.length === 0 ? (
          <p className="text-xs text-faint">
            None yet. Open a project and add its repo under GitHub.
          </p>
        ) : (
          <ul className="flex flex-col">
            {repos.map((r) => (
              <li
                key={r.projectId}
                className="flex items-center justify-between gap-3 border-b border-line/60 py-2 text-sm last:border-0"
              >
                <div className="min-w-0">
                  <Link href={`/projects/${r.projectId}`} className="block truncate text-text hover:text-accent">
                    {r.projectName}
                    {r.isArea && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-faint">area</span>}
                  </Link>
                  <span className="block truncate text-xs text-faint">{r.repo}</span>
                </div>
                <span className="shrink-0 text-right text-xs text-faint">
                  {r.lastCommitDay ? (
                    <>
                      last commit <span className="tabular text-muted">{r.lastCommitDay}</span>
                    </>
                  ) : (
                    'no commits seen'
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="mt-3 text-xs text-warn">{error}</p>}
      {result && (
        <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5 text-xs text-muted" aria-live="polite">
          <p>
            Synced {result.repos.length} {result.repos.length === 1 ? 'repo' : 'repos'}:{' '}
            <span className="tabular text-text">{result.inserted}</span> new progress{' '}
            {result.inserted === 1 ? 'day' : 'days'} recorded
            {result.restuck ? ', stuck flags refreshed' : ''}.
          </p>
          {result.repos.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {result.repos.map((r) => (
                <li key={r.projectId} className="flex justify-between gap-3">
                  <span className="truncate">{r.repo}</span>
                  <span className={r.status === 'ok' ? 'text-faint' : 'text-warn'}>
                    {r.status === 'ok'
                      ? `${r.commitDays.length}d with commits, ${r.inserted} new`
                      : STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
