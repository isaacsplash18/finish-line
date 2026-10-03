import Link from 'next/link';

import { Card, SectionTitle } from '@/components';

/** SPEC-V2 §4 — the weekly review is the judgment moment; Settings just links to it. */
export function ReviewLinkCard() {
  return (
    <Card tone="accent">
      <SectionTitle>Weekly review</SectionTitle>
      <p className="text-sm text-muted">
        Once a week: keep, kill or finish each active project, then start the new week at 100.
      </p>
      <Link
        href="/review"
        className="mt-3 inline-flex h-10 items-center justify-center rounded-xl bg-accent px-4 text-sm font-medium tracking-tight text-accent-ink transition-colors hover:bg-accent-hover active:bg-accent-dim"
      >
        Run the weekly review
      </Link>
    </Card>
  );
}
