'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/cn';
import { config } from '@/lib/config';
import { NAV_ITEMS, isNavItemActive } from './nav-items';

/** Fixed bottom tab bar. Mobile only (hidden from `lg`). */
export function BottomTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 lg:hidden',
        'border-t border-line bg-bg/95 backdrop-blur',
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      <ul className="mx-auto flex max-w-lg">
        {NAV_ITEMS.map((item) => {
          const active = isNavItemActive(item, pathname);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-[var(--spacing-tabbar)] flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors',
                  active ? 'text-accent' : 'text-faint hover:text-muted',
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Persistent sidebar. Desktop only (`lg` and up) — project reviews happen at a desk. */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-line bg-surface/40 px-3 py-5 lg:flex">
      <Link href="/" className="mb-6 flex items-center gap-2.5 px-2">
        <FinishLineMark />
        <span className="text-sm font-semibold tracking-tight">{config.appName}</span>
      </Link>

      <nav aria-label="Primary">
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active = isNavItemActive(item, pathname);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                    active
                      ? 'bg-accent-wash text-accent'
                      : 'text-muted hover:bg-surface-2 hover:text-text',
                  )}
                >
                  {item.icon}
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <p className="mt-auto px-3 text-[11px] leading-relaxed text-faint">
        Finish what you start.
      </p>
    </aside>
  );
}

/** The flag-crossing-the-line mark. Matches the app icon. */
export function FinishLineMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('size-6 shrink-0', className)}>
      <rect x="2" y="2" width="20" height="20" rx="5" fill="var(--color-surface-3)" />
      <path d="M7 4v16" stroke="var(--color-muted)" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M9 6h4v3H9zM13 9h4v3h-4zM9 12h4v3H9z"
        fill="var(--color-accent)"
      />
    </svg>
  );
}
