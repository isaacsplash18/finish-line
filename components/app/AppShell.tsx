import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { BottomTabs, Sidebar } from './Nav';

export interface AppShellProps {
  children: ReactNode;
  /** Screen title, shown in the sticky header. */
  title?: string;
  /** Small line under the title. */
  subtitle?: ReactNode;
  /** Right-hand slot in the header — a WipCounter, a "New project" button, etc. */
  action?: ReactNode;
  /** Renders full-bleed with no page padding (kanban boards want this). */
  bleed?: boolean;
}

/**
 * The dark app frame every screen renders inside.
 *
 * Mobile: sticky header + fixed bottom tab bar.
 * Desktop (`lg`+): fixed 240px sidebar, content offset to the right.
 *
 * A server component. `Sidebar` / `BottomTabs` are the only client parts
 * (they read `usePathname`).
 */
export function AppShell({ children, title, subtitle, action, bleed }: AppShellProps) {
  return (
    <div className="min-h-dvh bg-bg text-text">
      <Sidebar />

      <div className="lg:pl-60">
        {(title || action) && (
          <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
            <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3.5 lg:px-8">
              <div className="min-w-0">
                {title && (
                  <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
                )}
                {subtitle && <div className="mt-0.5 text-xs text-muted">{subtitle}</div>}
              </div>
              {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
            </div>
          </header>
        )}

        <main
          className={cn(
            'mx-auto max-w-4xl',
            bleed ? 'px-0' : 'px-4 py-5 lg:px-8 lg:py-8',
            // Clear the fixed tab bar on mobile.
            'pb-[calc(var(--spacing-tabbar)+1.5rem)] lg:pb-12',
          )}
        >
          {children}
        </main>
      </div>

      <BottomTabs />
    </div>
  );
}
