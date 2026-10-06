"use client";

import Link from "next/link";
import { useAuth } from "./AuthProvider";
import { useHostEvents } from "./EventClaimBoard";

/** The badge checks less often than the board itself. */
const BADGE_REFRESH_MS = 60_000;

/** The host menu's "Event" item, with how many blocks I could still grab. */
export default function HostEventNavLink() {
  const { user } = useAuth();
  const isHost = user.roles.some((role) => role.name === "host");
  const { claimable } = useHostEvents(isHost, BADGE_REFRESH_MS);

  return (
    <Link href="/host/events" className="relative flex flex-col items-center gap-1 text-gray-400 hover:text-white transition-colors px-2 py-1">
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"
        />
      </svg>
      <span className="text-xs">Event</span>
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
