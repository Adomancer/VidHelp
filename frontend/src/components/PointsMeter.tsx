import type { SpThresholds } from "@/lib/api";

const spStyles: Record<number, string> = {
  1: "bg-yellow-500/15 text-yellow-200 border-yellow-400/40",
  2: "bg-orange-500/15 text-orange-200 border-orange-400/40",
  3: "bg-red-500/15 text-red-200 border-red-400/40",
};

export function SpBadge({ level }: { level: number }) {
  if (level <= 0) return null;
  return <span className={`px-2 py-0.5 rounded-md border text-xs font-medium ${spStyles[level] ?? spStyles[3]}`}>SP{level}</span>;
}

/**
 * Points as a bar from 0 to the opening points, with a tick at each SP threshold.
 */
export default function PointsMeter({ points, opening, thresholds }: { points: number; opening: number; thresholds: SpThresholds }) {
  const pct = (value: number) => `${Math.max(0, Math.min(100, (value / opening) * 100))}%`;
  const reached = Object.entries(thresholds).filter(([, threshold]) => points <= threshold).map(([level]) => Number(level));
  const tone = reached.length === 0 ? "bg-green-500" : Math.max(...reached) >= 3 ? "bg-red-500" : Math.max(...reached) === 2 ? "bg-orange-500" : "bg-yellow-500";

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold text-white">{points}</span>
        <span className="text-sm text-gray-400">/ {opening} poin</span>
      </div>
      <div className="relative h-3 rounded-full bg-slate-800">
        <div className={`h-3 rounded-full ${tone}`} style={{ width: pct(points) }} />
        {Object.entries(thresholds).map(([level, threshold]) => (
          <div key={level} className="absolute -top-1 h-5 w-px bg-slate-400" style={{ left: pct(threshold) }} title={`SP${level} di ${threshold}`} />
        ))}
      </div>
      <div className="relative h-4 text-[11px] text-gray-400">
        {Object.entries(thresholds).map(([level, threshold]) => (
          <span key={level} className="absolute -translate-x-1/2" style={{ left: pct(threshold) }}>
            SP{level} {threshold}
          </span>
        ))}
      </div>
    </div>
  );
}
