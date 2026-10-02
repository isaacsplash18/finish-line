/**
 * Finish Line shared UI kit.
 *
 * Everything here is PRESENTATIONAL: props in, markup out. No data fetching,
 * no Supabase, no server actions. Screens fetch with `@/lib/data` and pass the
 * result down.
 *
 * Colour discipline (see app/globals.css):
 *   red   = Stuck / Forfeited, nothing else
 *   amber = over the soft WIP cap
 *   orange = brand / primary / at-cap
 *   emerald = Done / claimable / streaks
 */

export { AppShell, type AppShellProps } from './app/AppShell';
export { BottomTabs, Sidebar, FinishLineMark } from './app/Nav';
export { NAV_ITEMS, isNavItemActive, type NavItem } from './app/nav-items';

export { Sparkline, type SparklineProps } from './Sparkline';
export { HeatCalendar, type HeatCalendarProps } from './HeatCalendar';
export { StageBadge, type StageBadgeProps } from './StageBadge';
export { ScoreHero, type ScoreHeroProps } from './ScoreHero';
export { CountdownChip, type CountdownChipProps } from './CountdownChip';
export { RewardCard, type RewardCardProps } from './RewardCard';
export { WipCounter, type WipCounterProps } from './WipCounter';

export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './ui/Button';
export {
  Input,
  Textarea,
  Select,
  type InputProps,
  type TextareaProps,
  type SelectProps,
  type FieldSize,
} from './ui/Input';
export { Modal, type ModalProps } from './ui/Modal';
export { Card, CardHeader, SectionTitle, EmptyState, type CardProps } from './ui/Card';
