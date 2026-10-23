"use client";

import { useSyncExternalStore } from "react";
import { Globe } from "lucide-react";
import { deviceOutsideAppTimeZone } from "@/lib/format";

const subscribe = () => () => {};

/**
 * Only on devices whose clock isn't WIB (e.g. a host in Bali): every time on screen is WIB, like the
 * schedule, so it can differ from the phone's own clock.
 */
export default function TimeZoneNote() {
  const outside = useSyncExternalStore(subscribe, deviceOutsideAppTimeZone, () => false);
  if (!outside) return null;

  return (
    <p className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      <Globe className="size-3.5 shrink-0" aria-hidden="true" />
      Semua jam di aplikasi ini dalam WIB (waktu Jakarta), bukan jam di perangkatmu.
    </p>
  );
}
