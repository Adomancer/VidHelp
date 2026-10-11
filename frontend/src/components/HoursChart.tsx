"use client";

import { formatDuration } from "@/lib/format";

const PLOT_HEIGHT = 160;

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
 * Approved live hours per day, one bar per day. Hover a day for its exact total;
 * the same numbers are in a table for screen readers.
 */
export default function HoursChart({ days }: { days: { date: string; hours: number }[] }) {
  const max = Math.max(0, ...days.map((day) => day.hours));
  const step = tickStep(max || 1);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks = Array.from({ length: top / step + 1 }, (_, index) => index * step);

  return (
    <div>
      <div className="flex gap-2" aria-hidden="true">
        {/* Y axis */}
        <div className="relative w-9 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums" style={{ height: PLOT_HEIGHT }}>
          {ticks.map((tick) => (
            <span key={tick} className="absolute right-0 leading-none" style={{ bottom: `${(tick / top) * 100}%`, transform: "translateY(50%)" }}>
              {tick} j
            </span>
          ))}
        </div>

        <div className="flex-1 min-w-0">
          {/* Plot: hairline gridlines, then one column per day */}
          <div className="relative" style={{ height: PLOT_HEIGHT }}>
            {ticks.map((tick) => (
              <div key={tick} className="absolute inset-x-0 h-px bg-border" style={{ bottom: `${(tick / top) * 100}%` }} />
            ))}
            <div className="absolute inset-0 flex items-end gap-0.5">
              {days.map((day, index) => {
                const label = dayLabel(day.date);
                const tooltipSide = index > days.length / 2 ? "right-0" : "left-0";
                return (
                  <div key={day.date} className="group relative flex-1 h-full flex items-end justify-center">
                    {day.hours > 0 && (
                      <div
                        className="w-full max-w-6 rounded-t-[4px] bg-chart-1 transition-opacity group-hover:opacity-80"
                        style={{ height: `${(day.hours / top) * 100}%` }}
                      />
                    )}
                    <div
                      className={`pointer-events-none absolute bottom-full mb-1.5 ${tooltipSide} z-10 hidden whitespace-nowrap rounded-md bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 group-hover:block`}
                    >
                      <span className="block text-muted-foreground">{label.full}</span>
                      <span className="block font-medium text-foreground tabular-nums">{day.hours > 0 ? formatDuration(day.hours) : "Belum ada jam yang disetujui"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* X axis: day of month; month name where it changes */}
          <div className="mt-1.5 flex gap-0.5 text-[11px] text-muted-foreground tabular-nums">
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
        </div>
      </div>

      <table className="sr-only">
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
  );
}
