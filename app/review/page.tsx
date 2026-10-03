import { AppShell } from '@/components';
import { ReviewClient } from '@/components/review/ReviewClient';
import type { ReviewItem, ReviewWeekDay } from '@/components/review/ReviewProjectCard';
import { config } from '@/lib/config';
import { addDays, parseDateKey, toDateKey } from '@/lib/dates';
import { getReviewState, getWipStatus, type ReviewProjectRow } from '@/lib/data';
import { describeKillBonus } from '@/lib/scores';
import type { DateKey, ProjectWithMeta } from '@/lib/types';

export const metadata = { title: 'Review' };

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

function shortDate(key: DateKey): string {
  return parseDateKey(key).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  });
}

function longDate(key: DateKey): string {
  return parseDateKey(key).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/**
 * The copy for the Done confirmation: the +20 and what happens to the pinned
 * reward. Rewards lock only while over cap (SPEC-V2 §3), so finishing a
 * project that is itself Active can be what frees it.
 */
function doneCopyFor(
  project: ProjectWithMeta,
  wip: { activeCount: number; cap: number },
): string {
  const parts = [`+${config.focus.doneBonus} Focus.`];
  const reward = project.reward;
  if (reward && reward.status === 'locked_pending') {
    const after = wip.activeCount - (project.isActive ? 1 : 0);
    parts.push(
      after > wip.cap
        ? `${reward.name} unlocks once you are back to ${wip.cap} of ${wip.cap} active or fewer.`
        : `${reward.name} unlocks.`,
    );
  } else if (reward && reward.status === 'forfeited') {
    parts.push(`${reward.name} was forfeited earlier.`);
  }
  return parts.join(' ');
}

function toItem(
  row: ReviewProjectRow,
  wip: { activeCount: number; cap: number },
): ReviewItem {
  const { project } = row;
  return {
    id: project.id,
    name: project.name,
    stage: project.stage,
    nextAction: project.next_action,
    progressDays: row.progressDays,
    progressDayKeys: row.progressDayKeys,
    daysInStage: project.daysInStage,
    daysToTarget: project.daysToTarget,
    isStuck: project.isStuck,
    killBonusCopy: describeKillBonus(project.stage),
    doneCopy: doneCopyFor(project, wip),
  };
}

/**
 * Sunday review (SPEC-V2 §4). Works on any day — ritual, not gate. The review
 * week is the one `getReviewState` picks (on Sunday the week ending today,
 * otherwise the week that just ended).
 */
export default async function ReviewPage() {
  // getReviewState lists active + Shipped projects (kind='project').
  const [state, wip] = await Promise.all([getReviewState(), getWipStatus()]);
  const items = state.projects.map((r) => toItem(r, wip));

  const weekDays: ReviewWeekDay[] = DAY_LABELS.map((label, i) => ({
    key: addDays(state.weekStart, i),
    label,
  }));
  const weekLabel = `${shortDate(state.weekStart)} – ${shortDate(state.weekEnd)}`;

  return (
    <AppShell title="Weekly review" subtitle="Keep, kill or finish. Then reset.">
      <ReviewClient
        weekStart={state.weekStart}
        weekLabel={weekLabel}
        items={items}
        weekDays={weekDays}
        focusWeek={state.focusWeek}
        counters={state.counters}
        nextWeekStartsAt={state.nextWeekStartsAt}
        completedLabel={state.completedAt ? longDate(toDateKey(state.completedAt)) : null}
      />
    </AppShell>
  );
}
