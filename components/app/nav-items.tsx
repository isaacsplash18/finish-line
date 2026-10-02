import type { ReactNode } from 'react';

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** Extra path prefixes that should light this tab up. */
  match?: string[];
}

const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: 'size-5 shrink-0',
  'aria-hidden': true,
};

/**
 * The four top-level screens (PRD §8). Project *detail* is nested under
 * /projects/[id] and does not get its own tab.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    href: '/',
    label: 'Dashboard',
    icon: (
      <svg {...iconProps}>
        <path d="M3 13h5v8H3zM9.5 3h5v18h-5zM16 9h5v12h-5z" />
      </svg>
    ),
  },
  {
    href: '/projects',
    label: 'Projects',
    match: ['/projects'],
    icon: (
      <svg {...iconProps}>
        <path d="M4 5h6v14H4zM14 5h6v9h-6z" />
      </svg>
    ),
  },
  {
    href: '/routines',
    label: 'Routines',
    icon: (
      <svg {...iconProps}>
        <path d="M4 6h16M4 12h16M4 18h16" />
        <circle cx="8" cy="6" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="14" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="10" cy="18" r="1.6" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
      </svg>
    ),
  },
];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.href === '/') return pathname === '/';
  return [item.href, ...(item.match ?? [])].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
