import type { SpThresholds } from "@/lib/api";
import StatusBadge from "./StatusBadge";

export function SpBadge({ level }: { level: number }) {
  if (level <= 0) return null;
  return <StatusBadge tone={level >= 3 ? "danger" : "warning"}>SP{level}</StatusBadge>;
}

/**
 * Points as a bar from 0 to the opening points, with a tick at each SP threshold.
 */
export default function PointsMeter({ points, opening, thresholds }: { points: number; opening: number; thresholds: SpThresholds }) {
  const pct = (value: number) => `${Math.max(0, Math.min(100, (value / opening) * 100))}%`;
  const reached = Object.entries(thresholds).filter(([, threshold]) => points <= threshold).map(([level]) => Number(level));
  const worst = reached.length === 0 ? 0 : Math.max(...reached);
  const tone = worst === 0 ? "bg-success" : worst >= 3 ? "bg-destructive" : "bg-warning";

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="text-4xl font-semibold tracking-tight text-foreground tabular-nums">{points}</span>
        <span className="text-sm text-muted-foreground">/ {opening} poin</span>
      </div>
      <div
        className="relative h-2.5 rounded-full bg-muted"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={opening}
        aria-valuenow={points}
        aria-label="Poin periode ini"
      >
        <div className={`h-full rounded-full transition-[width] duration-500 ease-out ${tone}`} style={{ width: pct(points) }} />
        {Object.entries(thresholds).map(([level, threshold]) => (
          <div key={level} className="absolute -top-1 h-[18px] w-0.5 rounded-full bg-foreground/25" style={{ left: pct(threshold) }} title={`SP${level} di ${threshold}`} />
        ))}
      </div>
      <div className="relative h-4 text-[11px] text-muted-foreground tabular-nums">
        {Object.entries(thresholds).map(([level, threshold]) => (
          <span key={level} className="absolute -translate-x-1/2" style={{ left: pct(threshold) }}>
            SP{level} {threshold}
          </span>
        ))}
      </div>
    </div>
  );
}
