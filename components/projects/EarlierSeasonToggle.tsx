'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';

export interface EarlierSeasonToggleProps {
  count: number;
  /** The already-rendered cards for the hidden projects (server-rendered, passed through). */
  children: ReactNode;
}

/**
 * SPEC-V2 §7 — terminal projects that ended before the current season started
 * are hidden from the Done / Killed column by default. This is only a view
 * filter; nothing is deleted. One tap reveals them.
 */
export function EarlierSeasonToggle({ count, children }: EarlierSeasonToggleProps) {
  const [shown, setShown] = useState(false);
  if (count === 0) return null;

  return (
    <>
      <li>
        <button
          type="button"
          aria-expanded={shown}
          onClick={() => setShown((v) => !v)}
          className="w-full rounded-xl border border-dashed border-line px-3 py-2 text-xs text-muted transition-colors hover:border-line-strong hover:text-text"
        >
          {shown ? `Hide ${count} from earlier seasons` : `Show ${count} from earlier seasons`}
        </button>
      </li>
      {shown && children}
    </>
  );
}
