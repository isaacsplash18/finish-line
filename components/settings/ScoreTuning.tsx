import { Card, SectionTitle } from '@/components';
import { config } from '@/lib/config';
import { STAGE_LABELS } from '@/lib/types';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line/60 py-2 text-sm last:border-0">
      <div className="min-w-0">
        <span className="text-muted">{label}</span>
        <span className="block text-[11px] leading-snug text-faint">{hint}</span>
      </div>
      <span className="tabular shrink-0 font-medium text-text">{value}</span>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-faint">{title}</p>
      {children}
    </div>
  );
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/**
 * PRD §8.5 — read-only mirror of `lib/config.ts` (v2 keys, SPEC-V2 §3). Every
 * tunable the scores read is listed with a one-line meaning. Tuning is a code
 * change, on purpose: no DB-backed editor here.
 */
export function ScoreTuning() {
  const { focus, flow, projects, github, todaysMove, review } = config;
  const stages = (list: readonly (keyof typeof STAGE_LABELS)[]) =>
    list.map((s) => STAGE_LABELS[s]).join(', ');

  return (
    <Card>
      <SectionTitle>Score tuning</SectionTitle>
      <p className="mb-3 text-xs text-faint">
        Read-only. These live in <code className="text-text">lib/config.ts</code>: rebalancing the
        economy is a code change, not a form here. Only projects (not areas) are ever scored.
      </p>

      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <Group title="Focus · weekly">
          <Row
            label="Weekly reset"
            value={`${focus.startingScore} on ${WEEKDAYS[focus.weekStartsOn] ?? 'Monday'}`}
            hint={`Focus restarts at ${focus.startingScore} every ${WEEKDAYS[focus.weekStartsOn] ?? 'Monday'} 00:00 SGT, clamped ${focus.min} to ${focus.max}.`}
          />
          <Row
            label="Activation over cap"
            value={signed(focus.activationOverCapPenalty)}
            hint={`Starting from ${stages(focus.activationFromStages)} into an active stage, only if it puts you over the cap. At or under: free.`}
          />
          <Row
            label="Over-cap bleed"
            value={`${signed(focus.overCapPenaltyPerProjectPerDay)}/project/day`}
            hint="Per active project beyond the cap, charged at each day's close this week."
          />
          <Row
            label="Stuck, per week"
            value={signed(focus.stuckPenaltyPerWeek)}
            hint="Per stuck project, charged once a week (not daily) the first day it is stuck."
          />
          <Row
            label="Abandoned"
            value={signed(focus.abandonedPenalty)}
            hint="The worst exit. Its reward is forfeited too."
          />
          <Row label="Done" value={signed(focus.doneBonus)} hint="A project moved to Done." />
          <Row
            label="Decisive kill"
            value={signed(focus.decisiveKillBonus)}
            hint={`Killing something that reached ${stages(focus.killBonusStages)}. Killing an Idea is neutral.`}
          />
          <Row
            label="Did it"
            value={`${signed(focus.didItBonus)}, max ${signed(focus.didItDailyCap)}/day`}
            hint="Each Did-it tap, capped per day across all projects, so the meter answers a tap."
          />
        </Group>

        <div className="flex flex-col gap-5">
          <Group title={`Flow · rolling ${flow.windowDays}d`}>
            <Row
              label="Window"
              value={`${flow.windowDays}d`}
              hint="Routine adherence is computed live over this many days."
            />
            <Row
              label="Default daily target"
              value={flow.defaultDailyTarget}
              hint="Weekly target assumed for a daily routine with none set."
            />
            <Row
              label="Score with no routines"
              value={flow.scoreWhenNoRoutines}
              hint="What Flow reads when there are no active routines."
            />
          </Group>

          <Group title="Projects">
            <Row
              label="WIP cap (soft)"
              value={projects.wipLimit}
              hint="Active = Building or Commercialising. Priced, never blocked."
            />
            <Row
              label="Stale days"
              value={`${projects.staleThresholdDays}d`}
              hint={`No progress signal for this long in ${stages(projects.staleStages)} means Stuck.`}
            />
            <Row
              label="Progress lookback"
              value={`${projects.progressLookbackDays}d`}
              hint="How much progress history is read for stuck and Today's move."
            />
          </Group>

          <Group title="GitHub">
            <Row
              label="Commit lookback"
              value={`${github.lookbackDays}d`}
              hint="Each sync records commit days from this far back as progress."
            />
          </Group>

          <Group title="Today's move & review">
            <Row
              label="Move order"
              value={todaysMove.order.join(' > ')}
              hint="Which project wins the card: stuck first, then target date, longest idle, round-robin."
            />
            <Row
              label="Review banner"
              value={review.bannerDays.map((d) => (WEEKDAYS[d] ?? '').slice(0, 3)).join(', ')}
              hint="Days the weekly-review banner shows until it is completed."
            />
          </Group>
        </div>
      </div>
    </Card>
  );
}
