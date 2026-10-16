"use client";

import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { liveApi, type LiveSession } from "@/lib/api";
import { dayWord, formatClock } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import AppShell from "./AppShell";
import { useAuth } from "./AuthProvider";
import { useHostEvents } from "./EventClaimBoard";
import HostBottomNav from "./HostBottomNav";
import type { SidebarGroup } from "./SidebarLayout";

/** The Event badge checks less often than the event board itself. */
const BADGE_REFRESH_MS = 60_000;
const NEXT_SESSION_REFRESH_MS = 60_000;

const links: SidebarGroup[] = [
  {
    group: "Hari ini",
    items: [
      { href: "/host/dashboard", label: "Dashboard", icon: "dashboard" },
      { href: "/host/live", label: "Live", icon: "live" },
      { href: "/host/schedule", label: "Jadwal", icon: "calendar" },
    ],
  },
  {
    group: "Peluang",
    items: [
      { href: "/host/events", label: "Event", icon: "event" },
      { href: "/host/backups", label: "Backup", icon: "backup" },
    ],
  },
  {
    group: "Saya",
    items: [
      { href: "/host/pay", label: "Gaji", icon: "payroll" },
      { href: "/host/rating", label: "Skor", icon: "rating" },
      { href: "/host/brands", label: "Brand", icon: "brand" },
      { href: "/host/profile", label: "Profil", icon: "profile" },
    ],
  },
];

/** The host app frame: sidebar from `md`, bottom tabs on phones. */
export default function HostShell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const isHost = user.roles.some((role) => role.name === "host");
  const { claimable } = useHostEvents(isHost, BADGE_REFRESH_MS);

  return (
    <AppShell
      panel="Host"
      homeHref="/host/dashboard"
      links={links}
      badges={{ "/host/events": claimable }}
      sidebarExtra={isHost ? <NextSession /> : undefined}
      mobileNav={<HostBottomNav claimable={claimable} />}
      profileHref="/host/profile"
    >
      {children}
    </AppShell>
  );
}

/** The session going on now, or the next one today. */
function upcoming(sessions: LiveSession[], now: Date): { session: LiveSession; live: boolean } | null {
  const mine = sessions.filter((session) => session.role !== "off" && new Date(session.end_at) > now);
  const live = mine.find((session) => session.attendance && !session.attendance.check_out_at);
  if (live) return { session: live, live: true };
  const next = [...mine].sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
  return next ? { session: next, live: false } : null;
}

/** Sidebar card: what's next today, one click from the Live page. */
function NextSession() {
  const { token } = useAuth();
  // Same data as the Live page, so both share one request
  const today = useApiData("live-today", () => liveApi.today(token), { refetchInterval: NEXT_SESSION_REFRESH_MS });

  if (!today.data) return null;
  const next = upcoming(today.data.sessions, new Date());

  return (
    <Link
      href={next ? "/host/live" : "/host/schedule"}
      className="block rounded-lg border border-sidebar-border bg-background/60 p-3 transition-colors outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
    >
      {next ? (
        <>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-faint uppercase">
            {next.live && (
              <span className="relative flex size-1.5" aria-hidden="true">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-success" />
              </span>
            )}
            {next.live ? "Sedang live" : "Sesi berikutnya"}
          </p>
          <p className="mt-1.5 truncate text-sm font-medium text-foreground">{next.session.brand.name}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {next.live
              ? `sampai ${formatClock(next.session.end_at)}`
              : `${dayWord(next.session.start_at)} · ${formatClock(next.session.start_at)}–${formatClock(next.session.end_at)}`}
          </p>
        </>
      ) : (
        <span className="flex items-center gap-2.5 text-xs text-muted-foreground">
          <CalendarCheck className="size-4 shrink-0 text-faint" aria-hidden="true" />
          Tidak ada sesi lagi hari ini
        </span>
      )}
    </Link>
  );
}
