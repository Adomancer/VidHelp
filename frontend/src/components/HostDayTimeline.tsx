"use client";

import { useRef } from "react";
import { fromMinutes } from "@/lib/schedule";

const DAY_MINUTES = 24 * 60;

/** A stretch of the day in minutes from 00:00 (end ≤ 1440). */
export interface DayBlock {
  start: number;
  end: number;
  label: string;
}

interface HostDayTimelineProps {
  /** When the host is already live (any brand). */
  busy: DayBlock[];
  /** When the host said they're usually free. */
  available: DayBlock[];
  /** The slot being filled in, if its times are valid. */
  selection: { start: number; end: number } | null;
  /** A click on a free part of the day, in minutes from 00:00. */
  onPick: (minute: number) => void;
  disabled?: boolean;
}

const percent = (minutes: number) => `${(minutes / DAY_MINUTES) * 100}%`;

/** One day, 00:00–24:00: busy blocks, usual free hours, and the slot being added. Click a gap to use it. */
export default function HostDayTimeline({ busy, available, selection, onPick, disabled = false }: HostDayTimelineProps) {
  const barRef = useRef<HTMLDivElement>(null);

  function minuteAt(clientX: number): number {
    const rect = barRef.current!.getBoundingClientRect();
    return Math.min(DAY_MINUTES - 1, Math.max(0, ((clientX - rect.left) / rect.width) * DAY_MINUTES));
  }

  const isBusy = (minute: number) => busy.some((block) => block.start <= minute && minute < block.end);
  // A selection past midnight shows up to 24:00 here
  const shown = selection && { start: selection.start, end: Math.min(selection.end, DAY_MINUTES) };

  return (
    <div className="space-y-1.5">
      <div
        ref={barRef}
        role="presentation"
        onClick={(event) => {
          if (disabled) return;
          const minute = minuteAt(event.clientX);
          if (!isBusy(minute)) onPick(minute);
        }}
        className={`relative h-10 rounded-lg bg-surface-2 border border-stroke-strong overflow-hidden ${disabled ? "" : "cursor-copy"}`}
      >
        {/* Hour grid */}
        {Array.from({ length: 23 }, (_, index) => (
          <span
            key={index}
            aria-hidden="true"
            className={`absolute inset-y-0 w-px ${(index + 1) % 6 === 0 ? "bg-surface-3" : "bg-stroke"}`}
            style={{ left: percent((index + 1) * 60) }}
          />
        ))}

        {available.map((block, index) => (
          <span
            key={`free-${index}`}
            title={`Biasanya bisa: ${block.label}`}
            className="absolute inset-y-0 bg-green-500/15 border-x border-green-400/30"
            style={{ left: percent(block.start), width: percent(block.end - block.start) }}
          />
        ))}

        {busy.map((block, index) => (
          <span
            key={`busy-${index}`}
            title={block.label}
            className="absolute inset-y-1 rounded bg-slate-500/80 text-[10px] leading-8 px-1 text-white truncate cursor-not-allowed"
            style={{ left: percent(block.start), width: percent(block.end - block.start) }}
          >
            {block.label}
          </span>
        ))}

        {shown && shown.end > shown.start && (
          <span
            aria-hidden="true"
            className="absolute inset-y-0.5 rounded-md border-2 border-primary bg-primary/25 pointer-events-none"
            style={{ left: percent(shown.start), width: percent(shown.end - shown.start) }}
          />
        )}
      </div>

      <div className="relative h-3 text-[10px] text-faint tabular-nums" aria-hidden="true">
        {[0, 6, 12, 18, 24].map((hour) => (
          <span
            key={hour}
            className={`absolute ${hour === 0 ? "" : hour === 24 ? "-translate-x-full" : "-translate-x-1/2"}`}
            style={{ left: percent(hour * 60) }}
          >
            {hour === 24 ? "24:00" : fromMinutes(hour * 60)}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2.5 rounded-sm bg-slate-500/80" /> Sudah live
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2.5 rounded-sm bg-green-500/25 border border-green-400/40" /> Biasanya bisa
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2.5 rounded-sm border-2 border-primary" /> Slot ini
        </span>
        {!disabled && <span className="text-faint">Klik area kosong untuk mengisi jam.</span>}
      </div>
    </div>
  );
}
