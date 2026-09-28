import type { EventBlock } from "./api";
import { toDateInput } from "./format";

/** Event blocks grouped by the (local) day they start on, in order. */
export function groupByDay(blocks: EventBlock[]): [string, EventBlock[]][] {
  const days = new Map<string, EventBlock[]>();
  for (const block of blocks) {
    const day = toDateInput(new Date(block.start_at));
    days.set(day, [...(days.get(day) ?? []), block]);
  }
  return [...days.entries()];
}
