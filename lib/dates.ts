/**
 * Date helpers. Everything day-shaped in Finish Line is a `DateKey`
 * (`YYYY-MM-DD`) resolved in the app timezone (`config.timezone`, SGT).
 *
 * These are pure and dependency-free apart from `config`, so `lib/scores.ts`
 * stays unit-testable.
 */

import { config } from './config';
import type { DateKey } from './types';

const MS_PER_DAY = 86_400_000;

/** Format any Date / ISO string as a `YYYY-MM-DD` key in the app timezone. */
export function toDateKey(input: Date | string = new Date(), timeZone = config.timezone): DateKey {
  const date = typeof input === 'string' ? new Date(input) : input;
  // en-CA gives ISO-ordered YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Today, in the app timezone. This is what "today" means everywhere in the app. */
export function today(timeZone = config.timezone): DateKey {
  return toDateKey(new Date(), timeZone);
}

/** Parse a `YYYY-MM-DD` into a UTC-midnight Date, for safe day arithmetic. */
export function parseDateKey(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

/** Whole days from `from` to `to`. Positive when `to` is later. */
export function daysBetween(from: DateKey, to: DateKey): number {
  return Math.round((parseDateKey(to).getTime() - parseDateKey(from).getTime()) / MS_PER_DAY);
}

/** Shift a date key by N days (negative shifts backwards). */
export function addDays(key: DateKey, days: number): DateKey {
  const d = parseDateKey(key);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The last `count` date keys ending at `end` (inclusive), oldest first.
 * `lastNDates(7, '2026-08-28')` ⇒ ['2026-08-22' … '2026-08-28'].
 */
export function lastNDates(count: number, end: DateKey = today()): DateKey[] {
  const out: DateKey[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(addDays(end, -i));
  return out;
}

/** Whole days elapsed since a timestamp, measured in whole app-timezone days. */
export function daysSince(timestamp: string, asOf: DateKey = today()): number {
  return daysBetween(toDateKey(timestamp), asOf);
}

/** Day of week for a date key: 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(key: DateKey): number {
  return parseDateKey(key).getUTCDay();
}

/** "in 23 days" / "today" / "3 days ago" — used by CountdownChip. */
export function humanCountdown(daysAway: number): string {
  if (daysAway === 0) return 'today';
  if (daysAway === 1) return 'tomorrow';
  if (daysAway === -1) return 'yesterday';
  if (daysAway > 1) return `in ${daysAway} days`;
  return `${Math.abs(daysAway)} days ago`;
}

export const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
