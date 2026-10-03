import { NextResponse } from 'next/server';

import { computeAndSnapshotToday } from '@/lib/data';
import { isSupabaseConfigured } from '@/lib/supabase/env';

/**
 * Nightly recompute (PRD §6, §13.2, §13.5).
 *
 * Wired to Vercel Cron in `vercel.json` at 16:00 UTC = midnight SGT. Also safe
 * to hit by hand: `curl -s localhost:3000/api/cron | jq`.
 *
 * If `CRON_SECRET` is set, the request must carry
 * `Authorization: Bearer <CRON_SECRET>` — Vercel Cron sends this automatically.
 * With no secret set (local dev) the route is open.
 *
 * The dashboard falls back to `computeAndSnapshotToday()` when today's
 * snapshot is missing, so a missed night
 * self-heals the next time Isaac opens the app.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = request.headers.get('authorization');
    if (header !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'Supabase is not configured. See .env.example.' },
      { status: 503 },
    );
  }

  try {
    const result = await computeAndSnapshotToday();
    return NextResponse.json({
      ok: true,
      date: result.snapshot.date,
      flow: result.snapshot.flow,
      focus: result.snapshot.focus,
      stuck: {
        total: result.stuck.stuckProjectIds.length,
        newlyStuck: result.stuck.newlyStuckProjectIds.length,
        unstuck: result.stuck.unstuckProjectIds.length,
      },
      rewards: {
        locked: result.rewards.locked,
        hasStuckProject: result.rewards.hasStuckProject,
        isOverCap: result.rewards.isOverCap,
        changed: result.rewards.changedRewardIds.length,
      },
      focusBreakdown: result.focus,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Recompute failed' },
      { status: 500 },
    );
  }
}

/** Same work, for manual triggering from a button in Settings. */
export const POST = GET;
