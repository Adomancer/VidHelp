"use client";

import { useState } from "react";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A round tick step so the axis shows 3-4 clean values (1, 2, 5, 10, 20, 25, 50 h, …). */
function tickStep(max: number): number {
  for (const step of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]) {
    if (max / step <= 4) return step;
  }
  return Math.ceil(max / 4 / 1000) * 1000;
}

function dayLabel(date: string): { day: string; month: string; full: string } {
  const value = new Date(`${date}T00:00`);
  return {
    day: String(value.getDate()),
    month: value.toLocaleDateString("id-ID", { month: "short" }),
    full: value.toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" }),
  };
}

/**
 * Approved live hours per day, one bar per day. Hover (or tap, on a phone) a day for its exact total;
 * the same numbers are in a table for screen readers. The plot fills the chart's height
 * (`className` can change it, e.g. to stretch inside a tile).
 */
export default function HoursChart({ days, className }: { days: { date: string; hours: number }[]; className?: string }) {
  const max = Math.max(0, ...days.map((day) => day.hours));
  const step = tickStep(max || 1);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks = Array.from({ length: top / step + 1 }, (_, index) => index * step);
  // Touch screens have no hover, so a tap pins a day's total until another tap
  const [tapped, setTapped] = useState<string | null>(null);

  return (
    // Y axis | plot on top, x axis under the plot
    <div className={cn("relative grid h-52 grid-cols-[2.25rem_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] gap-x-2", className)}>
      <div className="relative text-right text-[11px] text-muted-foreground tabular-nums" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick} className="absolute right-0 leading-none" style={{ bottom: `${(tick / top) * 100}%`, transform: "translateY(50%)" }}>
            {tick} j
          </span>
        ))}
      </div>

      {/* Plot: hairline gridlines, then one column per day */}
      <div className="relative" aria-hidden="true">
        {ticks.map((tick) => (
          <div key={tick} className="absolute inset-x-0 h-px bg-border" style={{ bottom: `${(tick / top) * 100}%` }} />
        ))}
        <div className="absolute inset-0 flex items-end gap-0.5">
          {days.map((day, index) => {
            const label = dayLabel(day.date);
            const tooltipSide = index > days.length / 2 ? "right-0" : "left-0";
            return (
              <div
                key={day.date}
                onClick={() => setTapped((current) => (current === day.date ? null : day.date))}
                className="group relative flex h-full flex-1 items-end justify-center"
              >
                {day.hours > 0 && (
                  <div
                    className="w-full max-w-6 rounded-t-[4px] bg-chart-1 transition-opacity group-hover:opacity-80"
                    style={{ height: `${(day.hours / top) * 100}%` }}
                  />
                )}
                <div
                  className={`pointer-events-none absolute bottom-full mb-1.5 ${tooltipSide} z-10 rounded-md bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap text-popover-foreground shadow-md ring-1 ring-foreground/10 group-hover:block ${tapped === day.date ? "block" : "hidden"}`}
                >
                  <span className="block text-muted-foreground">{label.full}</span>
                  <span className="block font-medium text-foreground tabular-nums">
                    {day.hours > 0 ? formatDuration(day.hours) : "Belum ada jam yang disetujui"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* X axis: day of month; month name where it changes */}
      <div className="col-start-2 mt-1.5 flex gap-0.5 text-[11px] text-muted-foreground tabular-nums" aria-hidden="true">
        {days.map((day, index) => {
          const label = dayLabel(day.date);
          const showMonth = index === 0 || label.day === "1";
          return (
            <div key={day.date} className="flex-1 text-center leading-tight">
              {label.day}
              <span className="block h-3.5">{showMonth ? label.month : ""}</span>
            </div>
          );
        })}
      </div>

      {/* A table can't be squeezed to 1px, so the wrapper is what hides it */}
      <div className="sr-only">
        <table>
          <caption>Jam live yang disetujui per hari</caption>
          <thead>
            <tr>
              <th>Hari</th>
              <th>Jam</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date}>
                <td>{dayLabel(day.date).full}</td>
                <td>{formatDuration(day.hours)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
