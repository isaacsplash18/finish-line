'use client';

import { useState, useTransition } from 'react';

import {
  checkGithubNowAction,
  setProjectRepoAction,
  type ProjectGithubCheck,
} from '@/app/projects/actions';
import { Button, Input } from '@/components';
import { normalizeGithubRepo } from '@/lib/github';
import type { UUID } from '@/lib/types';

export interface GithubRepoEditorProps {
  projectId: UUID;
  /** Normalised "owner/name", or null. */
  repo: string | null;
  disabled?: boolean;
}

const STATUS_COPY: Record<NonNullable<ProjectGithubCheck['repo']>['status'], string> = {
  ok: '',
  not_found: 'GitHub could not find that repo (it may be private; set GITHUB_TOKEN).',
  rate_limited: 'GitHub rate limit reached. Try again later or set GITHUB_TOKEN.',
  unauthorized: 'GitHub rejected the token.',
  error: 'Could not reach GitHub.',
};

/**
 * SPEC-V2 §6 — link a repo ("owner/name" or a github.com URL). Commits on it
 * become progress and clear Stuck. Validation is mirrored client-side with the
 * same pure normaliser the data layer uses, and the server's message is shown
 * verbatim if it still disagrees.
 */
export function GithubRepoEditor({ projectId, repo, disabled }: GithubRepoEditorProps) {
  const [value, setValue] = useState(repo ?? '');
  const [saved, setSaved] = useState(repo);
  const [error, setError] = useState<string | undefined>();
  const [check, setCheck] = useState<ProjectGithubCheck | null>(null);
  const [checkError, setCheckError] = useState<string | undefined>();
  const [saving, startSave] = useTransition();
  const [checking, startCheck] = useTransition();

  const trimmed = value.trim();
  const preview = trimmed ? normalizeGithubRepo(trimmed) : null;
  const invalid = trimmed !== '' && !preview;
  const dirty = (preview ?? '') !== (saved ?? '') || (trimmed === '' && saved !== null);

  function save() {
    setError(undefined);
    setCheck(null);
    startSave(async () => {
      const res = await setProjectRepoAction(projectId, trimmed === '' ? null : trimmed);
      if (res.ok) {
        setSaved(res.data.repo);
        setValue(res.data.repo ?? '');
      } else {
        setError(res.error);
      }
    });
  }

  function checkNow() {
    setCheckError(undefined);
    setCheck(null);
    startCheck(async () => {
      const res = await checkGithubNowAction(projectId);
      if (res.ok) setCheck(res.data);
      else setCheckError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Repo"
        placeholder="owner/name"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          setValue(e.target.value);
          setError(undefined);
        }}
        hint={
          preview
            ? `Will link github.com/${preview}.`
            : 'owner/name or a github.com URL. Commits on it count as progress.'
        }
        error={error ?? (invalid ? 'Must look like owner/name (or a github.com URL).' : undefined)}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={save}
          loading={saving}
          disabled={disabled || invalid || !dirty}
        >
          {trimmed === '' && saved ? 'Unlink' : 'Save repo'}
        </Button>
        {saved && (
          <Button
            size="sm"
            variant="secondary"
            onClick={checkNow}
            loading={checking}
            disabled={disabled || dirty}
          >
            Check commits now
          </Button>
        )}
      </div>

      {checkError && <p className="text-xs text-warn">{checkError}</p>}
      {check && <CheckResult check={check} />}
    </div>
  );
}

function CheckResult({ check }: { check: ProjectGithubCheck }) {
  const mine = check.repo;
  if (!mine) {
    return (
      <p className="text-xs text-muted">
        Nothing to check yet. Linked repos on finished projects are skipped.
      </p>
    );
  }
  if (mine.status !== 'ok') {
    return <p className="text-xs text-warn">{STATUS_COPY[mine.status] || mine.detail}</p>;
  }
  return (
    <p className="text-xs text-muted">
      <span className="tabular text-text">{mine.commitDays}</span>{' '}
      {mine.commitDays === 1 ? 'day' : 'days'} with commits in the last {check.lookbackDays} days
      {mine.inserted > 0 ? (
        <>
          {' '}
          — <span className="tabular text-positive">{mine.inserted} new</span> recorded as progress.
        </>
      ) : (
        ' — nothing new to record.'
      )}
      {!check.authenticated && <span className="text-faint"> (No GITHUB_TOKEN: public repos only.)</span>}
    </p>
  );
}
