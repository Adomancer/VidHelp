import type { PeriodStatus } from "@/lib/api";
import StatusBadge, { type Tone } from "./StatusBadge";

const statusStyles: Record<PeriodStatus, [string, Tone]> = {
  in_progress: ["Berjalan", "info"],
  waiting_payment: ["Menunggu PIC", "warning"],
  requested: ["Menunggu brand", "brand"],
  paid: ["Lunas", "success"],
};

/** A pay period's status: running to its target, waiting for the brand's PIC to request, waiting for the brand, paid. */
export default function PeriodBadge({ status }: { status: PeriodStatus }) {
  const [label, tone] = statusStyles[status];
  return (
    <StatusBadge tone={tone} dot>
      {label}
    </StatusBadge>
  );
}
