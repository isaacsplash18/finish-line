import { config } from '@/lib/config';
import { cn } from '@/lib/cn';

export interface SparklineProps {
  /** Oldest → newest. Nulls are gaps (a day with no snapshot). */
  values: (number | null)[];
  /** Fixed scale. Both Finish Line scores are 0–100. */
  min?: number;
  max?: number;
  width?: number;
  height?: number;
  /** Any CSS colour, including `var(--color-accent)`. Defaults to the accent. */
  stroke?: string;
  /** Soft area fill under the line. */
  fill?: boolean;
  className?: string;
  /** Screen-reader description. */
  label?: string;
}

/**
 * Inline SVG sparkline, sized for the 30-point score history (PRD §6).
 * Presentational only: pass it `snapshots.map(s => s.focus)`.
 *
 * Series shorter than `config.ui.sparklinePoints` are right-aligned and
 * left-padded with gaps, so a new install draws a short line at the right-hand
 * edge rather than stretching two points across the whole card.
 */
export function Sparkline({
  values,
  min = 0,
  max = 100,
  width = 240,
  height = 48,
  stroke = 'var(--color-accent)',
  fill = true,
  className,
  label = 'Score history',
}: SparklineProps) {
  const slots = Math.max(config.ui.sparklinePoints, values.length);
  const padded: (number | null)[] = [
    ...Array<null>(Math.max(0, slots - values.length)).fill(null),
    ...values,
  ];

  const span = Math.max(1, max - min);
  const stepX = slots > 1 ? width / (slots - 1) : 0;
  const pointAt = (value: number, index: number) => {
    const x = index * stepX;
    const y = height - ((Math.min(max, Math.max(min, value)) - min) / span) * height;
    return [x, y] as const;
  };

  // Break the path at gaps so a missed day is a hole, not a straight lie.
  const segments: string[] = [];
  let current: string[] = [];
  padded.forEach((value, index) => {
    if (value == null) {
      if (current.length) segments.push(current.join(' '));
      current = [];
      return;
    }
    const [x, y] = pointAt(value, index);
    current.push(`${current.length ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (current.length) segments.push(current.join(' '));

  const firstIndex = padded.findIndex((v) => v != null);
  const lastIndex = padded.length - 1 - [...padded].reverse().findIndex((v) => v != null);
  const hasData = firstIndex >= 0;

  const areaPath =
    fill && hasData && segments.length
      ? `${segments[segments.length - 1]} L${(lastIndex * stepX).toFixed(1)},${height} L${(
          firstIndex * stepX
        ).toFixed(1)},${height} Z`
      : null;

  const lastValue = hasData ? (padded[lastIndex] as number) : null;
  const lastPoint = lastValue != null ? pointAt(lastValue, lastIndex) : null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={cn('overflow-visible', className)}
    >
      {areaPath && (
        <path d={areaPath} fill={stroke} opacity={0.12} stroke="none" vectorEffect="non-scaling-stroke" />
      )}
      {segments.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {lastPoint && (
        <circle cx={lastPoint[0]} cy={lastPoint[1]} r={2.5} fill={stroke} stroke="none" />
      )}
    </svg>
  );
}
