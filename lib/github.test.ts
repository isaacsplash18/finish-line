import { describe, expect, it } from 'vitest';

import { commitDays, commitsUrl, normalizeGithubRepo } from './github';

describe('normalizeGithubRepo', () => {
  it('accepts owner/name and the usual GitHub URL forms', () => {
    for (const input of [
      'isaacsplash18/tally',
      '  isaacsplash18/tally  ',
      'https://github.com/isaacsplash18/tally',
      'https://www.github.com/isaacsplash18/tally/',
      'github.com/isaacsplash18/tally.git',
      'git@github.com:isaacsplash18/tally.git',
    ]) {
      expect(normalizeGithubRepo(input)).toBe('isaacsplash18/tally');
    }
    expect(normalizeGithubRepo('isaacsplash18/daily-app')).toBe('isaacsplash18/daily-app');
    expect(normalizeGithubRepo('owner/repo.name_x')).toBe('owner/repo.name_x');
  });

  it('rejects anything that is not a single owner/name pair', () => {
    for (const input of ['', '   ', 'tally', 'a/b/c', 'https://gitlab.com/a/b', '-bad/repo', 'owner/', null, undefined]) {
      expect(normalizeGithubRepo(input)).toBeNull();
    }
  });
});

describe('commitDays', () => {
  it('buckets commits into distinct SGT days, newest first', () => {
    const days = commitDays([
      { commit: { author: { date: '2026-10-04T15:59:00Z' } } }, // Sun 23:59 SGT
      { commit: { author: { date: '2026-10-04T16:01:00Z' } } }, // Mon 00:01 SGT
      { commit: { author: { date: '2026-10-05T03:00:00Z' } } }, // Mon again
      { commit: { committer: { date: '2026-10-02T01:00:00Z' } } }, // committer fallback
      { commit: { author: { date: 'not a date' } } },
      { commit: null },
      {},
    ]);
    expect(days).toEqual(['2026-10-05', '2026-10-04', '2026-10-02']);
  });

  it('drops commits older than the lookback start', () => {
    const days = commitDays(
      [
        { commit: { author: { date: '2026-09-20T01:00:00Z' } } },
        { commit: { author: { date: '2026-10-01T01:00:00Z' } } },
      ],
      '2026-09-26T00:00:00Z',
    );
    expect(days).toEqual(['2026-10-01']);
  });
});

describe('commitsUrl', () => {
  it('asks for up to 100 commits since the lookback start', () => {
    const url = new URL(commitsUrl('isaacsplash18/tally', new Date('2026-09-26T00:00:00Z')));
    expect(url.origin + url.pathname).toBe('https://api.github.com/repos/isaacsplash18/tally/commits');
    expect(url.searchParams.get('since')).toBe('2026-09-26T00:00:00.000Z');
    expect(url.searchParams.get('per_page')).toBe('100');
  });
});
