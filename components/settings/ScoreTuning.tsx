import { Card, SectionTitle } from '@/components';
import { config } from '@/lib/config';
import { STAGE_LABELS } from '@/lib/types';

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/60 py-2 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="tabular font-medium text-text">{value}</span>
    </div>
  );
}

/**
 * PRD §8.5 — read-only mirror of `lib/config.ts`. Tuning is a code change, on
 * purpose: no DB-backed editor here.
 */
export function ScoreTuning() {
  const { focus, flow, projects } = config;

  return (
    <Card>
      <SectionTitle>Score tuning</SectionTitle>
      <p className="mb-3 text-xs text-faint">
        Read-only. These live in <code className="text-text">lib/config.ts</code> — rebalancing the
        economy is a code change, not a form here.
      </p>

      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-faint">
            Focus · rolling {focus.windowDays}d, starts at {focus.startingScore}
          </p>
          <Row label="New project → Building" value={focus.newBuildingPenalty} />
          <Row label="Stuck, per charge" value={focus.stuckPenalty} />
          <Row
            label="Stuck recurrence"
            value={`every ${focus.stuckPenaltyRecurrenceDays}d, max ${focus.maxStuckRecurrences}×`}
          />
          <Row label="Abandoned" value={focus.abandonedPenalty} />
          <Row label="Done" value={`+${focus.doneBonus}`} />
          <Row
            label="Over-cap bleed"
            value={`${focus.overCapPenaltyPerProjectPerDay}/project/day`}
          />
          <Row
            label="Over-cap charge cap"
            value={`${focus.maxOverCapProjectDaysCharged} project-days`}
          />
          <Row label="Decisive-kill bonus" value={`+${focus.decisiveKillBonus}`} />
          <Row
            label="Kill-bonus stages"
            value={focus.killBonusStages.map((s) => STAGE_LABELS[s]).join(', ')}
          />
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-faint">
            Flow · rolling {flow.windowDays}d
          </p>
          <Row label="Default daily target" value={flow.defaultDailyTarget} />
          <Row label="Score with no routines" value={flow.scoreWhenNoRoutines} />

          <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Projects
          </p>
          <Row label="WIP cap (soft)" value={projects.wipLimit} />
          <Row label="Stale threshold" value={`${projects.staleThresholdDays}d idle`} />
        </div>
      </div>
    </Card>
  );
}
