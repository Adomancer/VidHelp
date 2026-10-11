"use client";

import { useEffect, useState } from "react";

/** The current time, updated every `intervalMs`, so countdowns and "opens at" buttons change on their own. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}

/** "25 menit lagi", "1 jam 10 menit lagi", "2 hari 3 jam lagi" */
export function timeUntil(target: Date, now: Date): string {
  const minutes = Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 60_000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  // A day or more away: minutes are noise
  if (d > 0) return h === 0 ? `${d} hari lagi` : `${d} hari ${h} jam lagi`;
  if (h === 0) return `${m} menit lagi`;
  return m === 0 ? `${h} jam lagi` : `${h} jam ${m} menit lagi`;
}
