"use client";

import { type BrandHost, type EventBlock, type SpecialEvent } from "@/lib/api";
import { formatClock, formatDay, formatShortDate } from "@/lib/format";

/** Main controls are 44px high, for tablets and phones. */
export const TALL = "h-11 md:h-11";

/** taken: someone holds it · open: can be given · regular: the brand's own schedule runs · past: over */
export type BlockStatus = "taken" | "open" | "regular" | "past";

export function statusOf(block: EventBlock, now: Date): BlockStatus {
  if (new Date(block.end_at) <= now) return "past";
  if (block.claim) return "taken";
  if (block.state === "unavailable") return "regular";
  return "open";
}

export const blockTime = (block: EventBlock) => `${formatClock(block.start_at)}–${formatClock(block.end_at)}`;
export const dayOf = (iso: string) => formatDay(`${iso.slice(0, 10)}T00:00`);
export const dateRange = (event: SpecialEvent) => {
  const start = event.start_date.slice(0, 10);
  const end = event.end_date.slice(0, 10);
  return start === end ? formatShortDate(start) : `${formatShortDate(start)} – ${formatShortDate(end)}`;
};

export interface HostLite {
  id: string;
  name: string;
}

/** A brand's active hosts, by name. */
export function activeHosts(assignments: BrandHost[]): HostLite[] {
  return assignments
    .filter((assignment) => assignment.status === "active")
    .map((assignment) => ({ id: assignment.host_id, name: assignment.host.user.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "id"));
}
