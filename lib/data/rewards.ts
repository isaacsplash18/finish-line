import 'server-only';

import { config } from '@/lib/config';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type {
  CreateRewardInput,
  ProjectStage,
  Reward,
  UpdateRewardInput,
  UUID,
} from '@/lib/types';

import { NotFoundError, ValidationError, requireText, unwrap, unwrapNullable } from './errors';

/** Every reward, newest first. Includes forfeited tombstones (PRD §4.3.2). */
export async function getRewards(): Promise<Reward[]> {
  const supabase = await getSupabaseServerClient();
  return unwrap(
    await supabase.from('rewards').select('*').order('created_at', { ascending: false }),
    'getRewards',
  );
}

export async function getReward(id: UUID): Promise<Reward | null> {
  const supabase = await getSupabaseServerClient();
  return unwrapNullable(
    await supabase.from('rewards').select('*').eq('id', id).maybeSingle(),
    'getReward',
  );
}

/**
 * PRD §4.1 — Isaac pre-defines rewards with a price tag and assigns each to a
 * specific project's Done state. One reward per project (DB-enforced).
 */
export async function createReward(input: CreateRewardInput): Promise<Reward> {
  const supabase = await getSupabaseServerClient();
  const name = requireText(input.name, 'name', 'Name the reward.');
  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0) {
    throw new ValidationError('Give the reward a price. That is the point.', 'price');
  }

  return unwrap(
    await supabase
      .from('rewards')
      .insert({
        name,
        price,
        project_id: input.project_id ?? null,
        status: input.status ?? 'locked_pending',
      })
      .select('*')
      .single(),
    'createReward',
  );
}

export async function updateReward(id: UUID, input: UpdateRewardInput): Promise<Reward> {
  const supabase = await getSupabaseServerClient();
  const patch: Partial<Reward> = {};
  if (input.name !== undefined) patch.name = requireText(input.name, 'name');
  if (input.price !== undefined) {
    const price = Number(input.price);
    if (!Number.isFinite(price) || price < 0) throw new ValidationError('Invalid price.', 'price');
    patch.price = price;
  }
  if (input.project_id !== undefined) patch.project_id = input.project_id;
  if (input.status !== undefined) {
    patch.status = input.status;
    if (input.status === 'claimed') patch.claimed_at = new Date().toISOString();
    if (input.status === 'forfeited') patch.forfeited_at = new Date().toISOString();
  }

  return unwrap(
    await supabase.from('rewards').update(patch).eq('id', id).select('*').single(),
    'updateReward',
  );
}

export async function deleteReward(id: UUID): Promise<void> {
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.from('rewards').delete().eq('id', id);
  if (error) throw new ValidationError(error.message);
}

/**
 * PRD §4.2 — "the app shows it as claimable and logs when claimed".
 * Only a `claimable` reward can be claimed; anything else throws, which is the
 * whole point of the locking rule.
 */
export async function claimReward(id: UUID): Promise<Reward> {
  const supabase = await getSupabaseServerClient();
  const reward = await getReward(id);
  if (!reward) throw new NotFoundError('Reward', id);

  if (reward.status === 'claimed') return reward;
  if (reward.status !== 'claimable') {
    throw new ValidationError(
      reward.status === 'forfeited'
        ? 'That reward is gone. You abandoned the project it was attached to.'
        : 'That reward is locked. Finish the project — and unstick everything else — first.',
    );
  }

  return unwrap(
    await supabase
      .from('rewards')
      .update({ status: 'claimed', claimed_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single(),
    'claimReward',
  );
}

/** PRD §4.3.2 — permanent. Leaves a tombstone on the dashboard. */
export async function forfeitReward(id: UUID): Promise<Reward> {
  const supabase = await getSupabaseServerClient();
  return unwrap(
    await supabase
      .from('rewards')
      .update({ status: 'forfeited', forfeited_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single(),
    'forfeitReward',
  );
}

export interface RewardLockResult {
  /** True when unclaimed rewards are currently locked. */
  locked: boolean;
  /** Why: any project Stuck (PRD §4.3.1). */
  hasStuckProject: boolean;
  /** Why: portfolio over the soft WIP cap (SPEC-CHANGES §3). */
  isOverCap: boolean;
  activeCount: number;
  cap: number;
  /** Rewards whose status changed during this pass. */
  changedRewardIds: UUID[];
}

/**
 * The global reward gate.
 *
 * PRD §4.3.1 as amended by SPEC-CHANGES §3: unclaimed rewards lock while ANY
 * project is Stuck **or** the portfolio is over the WIP cap. They unlock when
 * nothing is stuck AND the portfolio is back at or under cap.
 *
 * A reward is `claimable` only when its project is Done and the gate is open.
 * `claimed` and `forfeited` are terminal and never touched here.
 *
 * Called after every stage change and by the nightly recompute — it is
 * idempotent, so calling it more often is harmless.
 */
export async function applyRewardLockingRule(): Promise<RewardLockResult> {
  const supabase = await getSupabaseServerClient();

  const projects = unwrap(
    await supabase.from('projects').select('id, stage, stuck_since'),
    'applyRewardLockingRule:projects',
  );
  const rewards = unwrap(
    await supabase.from('rewards').select('*').in('status', ['locked_pending', 'claimable']),
    'applyRewardLockingRule:rewards',
  );

  const hasStuckProject = projects.some((p) => p.stuck_since !== null);
  const activeCount = projects.filter((p) =>
    config.projects.activeStages.includes(p.stage as ProjectStage),
  ).length;
  const cap = config.projects.wipLimit;
  const isOverCap = activeCount > cap;
  const locked = hasStuckProject || isOverCap;

  const doneProjectIds = new Set(
    projects.filter((p) => p.stage === 'done').map((p) => p.id as UUID),
  );

  const changedRewardIds: UUID[] = [];
  for (const reward of rewards) {
    const earned = reward.project_id != null && doneProjectIds.has(reward.project_id);
    const desired = earned && !locked ? 'claimable' : 'locked_pending';
    if (reward.status !== desired) {
      await supabase.from('rewards').update({ status: desired }).eq('id', reward.id);
      changedRewardIds.push(reward.id);
    }
  }

  return { locked, hasStuckProject, isOverCap, activeCount, cap, changedRewardIds };
}
