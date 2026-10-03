import { Card, SectionTitle } from '@/components';

export interface WorkoutHookSectionProps {
  /** `!!process.env.WORKOUT_HOOK_TOKEN`, computed on the server. Never the value. */
  tokenConfigured: boolean;
  /** Origin the app is served from, e.g. https://finish-line-xi.vercel.app */
  origin: string;
  routineName: string;
  /** Whether an active routine with that name exists (the hook 404s without one). */
  routineExists: boolean;
}

/**
 * SPEC-V2 §8 — a narrow endpoint so the daily-app can tick workouts without
 * ever holding the main API key. The token shown in the example is a
 * placeholder; the real one is never rendered anywhere.
 */
export function WorkoutHookSection({
  tokenConfigured,
  origin,
  routineName,
  routineExists,
}: WorkoutHookSectionProps) {
  const curl = `curl -X POST ${origin}/api/v1/hooks/workout \\
  -H "Authorization: Bearer <WORKOUT_HOOK_TOKEN>"`;

  return (
    <Card>
      <SectionTitle>Workout hook</SectionTitle>

      <p className="text-sm text-muted">
        <code className="text-text">POST /api/v1/hooks/workout</code> adds one to today&apos;s{' '}
        <span className="text-text">{routineName}</span> routine, and nothing else. daily-app uses it
        so workouts are ticked once, in one place.
      </p>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-faint">WORKOUT_HOOK_TOKEN</dt>
        <dd>
          {tokenConfigured ? (
            <span className="font-medium text-positive">configured</span>
          ) : (
            <span className="font-medium text-warn">not set: the hook rejects every call</span>
          )}
        </dd>
        <dt className="text-faint">{routineName} routine</dt>
        <dd>
          {routineExists ? (
            <span className="text-muted">active</span>
          ) : (
            <span className="text-warn">none active: the hook returns 404</span>
          )}
        </dd>
      </dl>

      <pre className="mt-3 overflow-x-auto rounded-xl bg-surface-2 p-3 text-xs leading-relaxed text-text">
        <code>{curl}</code>
      </pre>

      <p className="mt-2 text-xs text-faint">
        The token is separate from <code className="text-muted">API_KEY</code>, which this endpoint
        does not accept, and it works nowhere else. The body is ignored; the date is always today.
        Set it in the environment (see <code className="text-muted">.env.example</code>); this page
        only ever shows whether it is set.
      </p>
    </Card>
  );
}
