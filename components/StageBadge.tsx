import { cn } from '@/lib/cn';
import { STAGE_LABELS, type ProjectStage } from '@/lib/types';

export interface StageBadgeProps {
  stage: ProjectStage;
  /**
   * Overrides the stage colour with the Stuck treatment (red + pulse).
   * PRD §8.2 — stuck projects pulse red.
   */
  stuck?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Colour rules:
 *  - idea            zinc      (free, costs nothing)
 *  - building        orange    (accent — the working state)
 *  - shipped         orange dim
 *  - commercialising orange    (the last mile, the whole point of the app)
 *  - done            emerald
 *  - killed          zinc      (respectable, deliberate)
 *  - abandoned       RED       (a forfeit)
 *  - stuck override  RED
 */
const TONES: Record<ProjectStage, string> = {
  idea: 'bg-surface-3 text-muted border-line',
  building: 'bg-accent-wash text-accent border-accent/40',
  shipped: 'bg-accent-wash/60 text-accent/90 border-accent/25',
  commercialising: 'bg-accent-wash text-accent border-accent/40',
  done: 'bg-positive-wash text-positive border-positive/40',
  killed: 'bg-surface-3 text-faint border-line',
  abandoned: 'bg-danger-wash text-danger border-danger/50',
};

export function StageBadge({ stage, stuck, size = 'md', className }: StageBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
        stuck ? 'border-danger/60 bg-danger-wash text-danger' : TONES[stage],
        className,
      )}
    >
      {stuck && <span aria-hidden className="size-1.5 rounded-full bg-danger" />}
      {stuck ? 'Stuck' : STAGE_LABELS[stage]}
    </span>
  );
}
