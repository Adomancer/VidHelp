"use client";

import Link from "next/link";
import { useAuth } from "./AuthProvider";
import { useHostEvents } from "./EventClaimBoard";

/** The badge checks less often than the board itself. */
const BADGE_REFRESH_MS = 60_000;

/** The host menu's "Event" item, with how many blocks I could still grab. */
export default function HostEventNavLink({ className, active, children }: { className: string; active: boolean; children: React.ReactNode }) {
  const { user } = useAuth();
  const isHost = user.roles.some((role) => role.name === "host");
  const { claimable } = useHostEvents(isHost, BADGE_REFRESH_MS);

  return (
    <Link href="/host/events" aria-current={active ? "page" : undefined} className={className}>
      {children}
      {claimable > 0 && (
        <span
          aria-label={`${claimable} blok bisa diambil`}
          className="absolute -top-1 right-0 min-w-4 h-4 rounded-full bg-pink-500 px-1 text-[10px] font-semibold leading-4 text-white text-center"
        >
          {claimable > 99 ? "99+" : claimable}
        </span>
      )}
    </Link>
  );
}
