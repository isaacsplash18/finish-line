import 'server-only';

import { config } from '@/lib/config';
import { addDays, dayOfWeek, parseDateKey, today } from '@/lib/dates';
import { reviewDueFor, reviewWeekFor } from '@/lib/scores';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type {
  CountersSummary,
  DateKey,
  FocusWeekBreakdown,
  ProjectWithMeta,
  Review,
  ReviewDue,
} from '@/lib/types';

import { ValidationError, unwrap, unwrapOptional } from './errors';
import { getAllKeyDateRows } from './key-dates';
import { getDidItEvents, getProgressEventsSince, progressLookbackStart } from './progress-events';
import { buildProjects, getAllProjectRows, getAllStageEvents } from './projects';
import { getRewards } from './rewards';
import { countersFromRows, focusWeekFromRows } from './scores';
import { getCurrentSeason } from './seasons';

/**
 * SPEC-V2 §4 — the Sunday review. A ritual, not a gate: it lists every active
 * (and Shipped) project with this week's numbers and three choices (Keep / Kill / Done —
 * those go through `updateProject`, `killProject`, `moveProjectStage`), then a
 * summary. Completing it records `reviews(week_start, completed_at)`, which
 * hides the home banner for that week.
 */

function requireWeekStart(weekStart: unknown): DateKey {
  if (typeof weekStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    throw new ValidationError('weekStart must be a date (YYYY-MM-DD).', 'weekStart');
  }
  if (Number.isNaN(parseDateKey(weekStart).getTime())) {
    throw new ValidationError('weekStart must be a real date.', 'weekStart');
  }
  if (dayOfWeek(weekStart) !== config.focus.weekStartsOn) {
    throw new ValidationError('weekStart must be the Monday that starts the week.', 'weekStart');
  }
  return weekStart;
}

/** Uncached: the review row for a week, or null. */
export async function fetchReview(weekStart: DateKey): Promise<Review | null> {
  const supabase = await getSupabaseServerClient();
  const rows = unwrapOptional(
    await supabase.from('reviews').select('*').eq('week_start', weekStart).limit(1),
    'fetchReview',
    [] as Review[],
  );
  return rows[0] ?? null;
}

/** Banner state for the home screen: which week, and is it due. */
export async function getReviewDue(asOf: DateKey = today()): Promise<ReviewDue> {
  const review = await fetchReview(reviewWeekFor(asOf));
  return reviewDueFor(asOf, review?.completed_at ?? null);
}

export interface ReviewProjectRow {
  project: ProjectWithMeta;
  /** Distinct days with any progress signal during the review week. */
  progressDays: number;
  progressDayKeys: DateKey[];
  daysInStage: number;
  targetDate: DateKey | null;
  isStuck: boolean;
}

export interface ReviewState {
  weekStart: DateKey;
  weekEnd: DateKey;
  review: Review | null;
  completedAt: string | null;
  /** True on banner days (Sun/Mon) until completed. */
  due: boolean;
  /**
   * Every project under review: active (Building/Commercialising) plus Shipped
   * — Shipped is outside the cap, but a Shipped project going quiet is exactly
   * the last-mile risk. kind='project' only; stuck-first, then most idle.
   */
  projects: ReviewProjectRow[];
  /** Areas, listed separately — they are never judged. */
  areas: ReviewProjectRow[];
  /** That week's Focus with its breakdown. */
  focusWeek: FocusWeekBreakdown;
  counters: CountersSummary;
  /** "Next week starts at 100." */
  nextWeekStart: DateKey;
  nextWeekStartsAt: number;
}

/**
 * Everything the review screen needs for one week. `weekStart` defaults to the
 * week under review today (`reviewWeekFor`: on Sunday the week ending today,
 * otherwise the week that just ended). One parallel batch of deduped reads.
 */
export async function getReviewState(weekStart?: DateKey): Promise<ReviewState> {
  const asOf = today();
  const ws = weekStart === undefined ? reviewWeekFor(asOf) : requireWeekStart(weekStart);
  const we = addDays(ws, 6);
  // Enough progress history to evaluate stuck across the whole review week.
  const lookback = progressLookbackStart(asOf);
  const weekLookback = addDays(ws, -(config.projects.staleThresholdDays + 1));
  const progressFrom = weekLookback < lookback ? weekLookback : lookback;

  const [projects, rewards, stageEvents, progressEvents, keyDates, didItEvents, season, review] =
    await Promise.all([
      getAllProjectRows(),
      getRewards(),
      getAllStageEvents(),
      getProgressEventsSince(progressFrom),
      getAllKeyDateRows(),
      getDidItEvents(),
      getCurrentSeason(),
      fetchReview(ws),
    ]);

  const now = new Date();
  const focusWeek = focusWeekFromRows({ projects, stageEvents, progressEvents, keyDates }, ws, now);
  const counters = countersFromRows({ projects, stageEvents, didItEvents, season }, now);

  const toRow = (project: ProjectWithMeta): ReviewProjectRow => {
    const days = [
      ...new Set(
        progressEvents
          .filter((e) => e.project_id === project.id && e.day >= ws && e.day <= we)
          .map((e) => e.day),
      ),
    ].sort();
    return {
      project,
      progressDays: days.length,
      progressDayKeys: days,
      daysInStage: project.daysInStage,
      targetDate: project.stage_target_date,
      isStuck: project.isStuck,
    };
  };

  const reviewed = buildProjects(projects, rewards, {
    stages: [...config.projects.activeStages, 'shipped'],
    kinds: ['project'],
  });
  const areas = buildProjects(projects, rewards, { includeTerminal: false, kinds: ['area'] });
  const due = reviewDueFor(asOf, review?.completed_at ?? null);

  return {
    weekStart: ws,
    weekEnd: we,
    review,
    completedAt: review?.completed_at ?? null,
    due: due.weekStart === ws && due.due,
    projects: reviewed.map(toRow),
    areas: areas.map(toRow),
    focusWeek,
    counters,
    nextWeekStart: addDays(ws, 7),
    nextWeekStartsAt: config.focus.startingScore,
  };
}

/**
 * Mark a week's review complete (idempotent — completing again just moves
 * `completed_at`). Defaults to the week under review today.
 */
export async function completeReview(weekStart?: DateKey): Promise<Review> {
  const ws = weekStart === undefined ? reviewWeekFor(today()) : requireWeekStart(weekStart);
  const supabase = await getSupabaseServerClient();
  return unwrap(
    await supabase
      .from('reviews')
      .upsert(
        { week_start: ws, completed_at: new Date().toISOString() },
        { onConflict: 'week_start' },
      )
      .select('*')
      .single(),
    'completeReview',
  );
}
