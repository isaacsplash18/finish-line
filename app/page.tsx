import { AppShell, CountdownChip, EmptyState, SectionTitle, WipCounter } from '@/components';
import { ReviewBanner } from '@/components/dashboard/ReviewBanner';
import { RewardStrip } from '@/components/dashboard/RewardStrip';
import { RoutineChecklist } from '@/components/dashboard/RoutineChecklist';
import { TodayPanel } from '@/components/dashboard/TodayPanel';
import { getDashboardData } from '@/lib/data';

export const metadata = { title: 'Today' };

/**
 * v2 home (SPEC-V2 §1). Above the fold: ONE card — Today's move — with the
 * live weekly Focus, the up-only counters and the WIP line right under it.
 * Below the fold: routines, key dates, rewards. Nothing competes with the card.
 */
export default async function DashboardPage() {
  const data = await getDashboardData();

  // v2: rewards lock only while the portfolio is over cap.
  const lockReason = data.isOverCap ? `${data.wip.label}, over cap` : undefined;

  return (
    <AppShell title="Today" subtitle="Finish what you start.">
      <div className="flex flex-col gap-10">
        <TodayPanel
          todaysMove={data.todaysMove}
          focusWeek={data.focusWeek}
          counters={data.counters}
          didItDaysThisWeek={data.didItDaysThisWeek}
          banner={<ReviewBanner reviewDue={data.reviewDue} />}
          wip={
            <WipCounter
              activeCount={data.wip.activeCount}
              cap={data.wip.cap}
              dailyBleed={data.wip.dailyBleed}
            />
          }
        />

        {/* Second scroll section */}
        <section>
          <SectionTitle
            action={
              <span className="tabular text-xs text-faint">
                Flow <span className="font-semibold text-positive">{data.flow}</span>
              </span>
            }
          >
            Routines
          </SectionTitle>
          <RoutineChecklist routines={data.routines} />
        </section>

        <section>
          <SectionTitle>Coming up</SectionTitle>
          {data.keyDates.length === 0 ? (
            <EmptyState>No key dates yet.</EmptyState>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.keyDates.map((kd) => (
                <CountdownChip
                  key={kd.id}
                  name={kd.name}
                  daysAway={kd.daysAway}
                  projectName={kd.project?.name}
                  overdue={kd.daysAway < 0 && kd.project != null && kd.project.stage !== 'done'}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionTitle>Rewards</SectionTitle>
          <RewardStrip rewards={data.rewards} lockReason={lockReason} />
        </section>
      </div>
    </AppShell>
  );
}
