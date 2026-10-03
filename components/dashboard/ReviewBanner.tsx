import Link from 'next/link';

import type { ReviewDue } from '@/lib/types';

/**
 * The Sunday-review nudge (SPEC-V2 §4). Shown on banner days until that week's
 * review is completed. Orange, not red: the review is a ritual, not a failure.
 */
export function ReviewBanner({ reviewDue }: { reviewDue: ReviewDue }) {
  if (!reviewDue.due) return null;

  return (
    <Link
      href="/review"
      className="flex items-center justify-between gap-3 rounded-2xl border border-accent/40 bg-accent-wash px-4 py-3 transition-colors hover:border-accent"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-text">Weekly review is open</span>
        <span className="block text-xs text-muted">Keep, kill or finish each project. Five minutes.</span>
      </span>
      <span className="shrink-0 text-sm font-medium text-accent">Review →</span>
    </Link>
  );
}
