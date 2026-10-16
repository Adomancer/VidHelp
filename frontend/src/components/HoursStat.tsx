import { Layers, TrendingDown, TrendingUp } from "lucide-react";
import { compactHours } from "@/lib/format";
import { cn } from "@/lib/utils";
import StatCard from "./StatCard";

type Day = { date: string; hours: number };

/** Approved hours of the last 7 days against the 7 before, from a 14-day series. */
export default function HoursStat({ days }: { days: Day[] }) {
  const sum = (list: Day[]) => list.reduce((total, day) => total + day.hours, 0);
  const recent = sum(days.slice(-7));
  const previous = sum(days.slice(0, -7));
  const change = previous > 0 ? Math.round(((recent - previous) / previous) * 100) : null;
  const Trend = change !== null && change < 0 ? TrendingDown : TrendingUp;

  return (
    <StatCard
      compact
      icon={Layers}
      tone="info"
      label="Jam live, 7 hari"
      value={compactHours(recent)}
      note={
        change === null ? (
          "Belum ada pembanding"
        ) : (
          <>
            <span className={cn("inline-flex items-center gap-0.5 font-medium", change >= 0 ? "text-success" : "text-destructive")}>
              <Trend className="size-3.5" aria-hidden="true" />
              {change >= 0 ? "+" : "−"}
              {Math.abs(change)}%
            </span>{" "}
            vs pekan lalu
          </>
        )
      }
    />
  );
}
