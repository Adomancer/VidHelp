import type { EventBlock } from "./api";
import { appDate } from "./format";

/** Event blocks grouped by the (WIB) day they start on, in order. */
export function groupByDay(blocks: EventBlock[]): [string, EventBlock[]][] {
  const days = new Map<string, EventBlock[]>();
  for (const block of blocks) {
    const day = appDate(block.start_at);
    days.set(day, [...(days.get(day) ?? []), block]);
  }
  return [...days.entries()];
}
