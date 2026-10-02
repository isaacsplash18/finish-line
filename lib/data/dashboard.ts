import 'server-only';

import { config } from '@/lib/config';
import { today } from '@/lib/dates';
import type { DashboardData, DateKey } from '@/lib/types';

import { getUpcomingKeyDates } from './key-dates';
import { getActiveProjects, getProjects, getWipStatus, type WipStatus } from './projects';
import { applyRewardLockingRule, getRewards } from './rewards';
import { getRoutinesWithChecks } from './routines';
import { ensureTodaySnapshot, getScoreSnapshots } from './scores';

export interface DashboardPayload extends DashboardData {
  wip: WipStatus;
  /** True while the portfolio is over the soft cap (SPEC-CHANGES §1/§3). */
  isOverCap: boolean;
}

/**
 * Everything the Dashboard screen needs, in one call. PRD §8.1.
 *
 * Runs `ensureTodaySnapshot()` first, so opening the app is enough to make the
 * scores correct even if the cron never fired (PRD §13.5).
 */
export async function getDashboardData(asOf: DateKey = today()): Promise<DashboardPayload> {
  const snapshot = await ensureTodaySnapshot(asOf);

  const [snapshots, routines, active, stuck, keyDates, rewards, wip, lock] = await Promise.all([
    getScoreSnapshots(config.ui.sparklinePoints, asOf),
    getRoutinesWithChecks({ asOf }),
    getActiveProjects(),
    getProjects({ onlyStuck: true }),
    getUpcomingKeyDates(),
    getRewards(),
    getWipStatus(),
    applyRewardLockingRule(),
  ]);

  return {
    flow: snapshot.flow,
    focus: snapshot.focus,
    snapshots,
    routines,
    activeProjects: active,
    stuckProjects: stuck,
    keyDates,
    rewards,
    rewardsLocked: lock.locked,
    activeCount: wip.activeCount,
    wipLimit: wip.cap,
    wip,
    isOverCap: wip.isOverCap,
  };
}
