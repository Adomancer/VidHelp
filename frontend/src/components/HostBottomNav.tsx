"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useHostEvents } from "./EventClaimBoard";

/** The Event badge checks less often than the event board itself. */
const BADGE_REFRESH_MS = 60_000;

const ITEMS = [
  {
    href: "/host/live",
    label: "Live",
    icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z",
  },
  {
    href: "/host/schedule",
    label: "Jadwal",
    icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  },
  {
    href: "/host/events",
    label: "Event",
    icon: "M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z",
  },
  {
    href: "/host/brands",
    label: "Brand",
    icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253",
  },
  {
    href: "/host/backups",
    label: "Backup",
    icon: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4",
  },
  {
    href: "/host/rating",
    label: "Skor",
    icon: "M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z",
  },
  {
    href: "/host/pay",
    label: "Gaji",
    icon: "M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z",
  },
] as const;

/**
 * The host app's menu on phones. The open page's item rises out of the bar as a
 * purple bubble; Event shows how many blocks I could still grab.
 */
export default function HostBottomNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const isHost = user.roles.some((role) => role.name === "host");
  const { claimable } = useHostEvents(isHost, BADGE_REFRESH_MS);

  return (
    <nav
      aria-label="Menu host"
      className="fixed inset-x-0 bottom-0 z-50 md:hidden print:hidden rounded-t-3xl border-t border-slate-800 bg-slate-900/95 backdrop-blur shadow-[0_-8px_24px_rgba(0,0,0,0.45)] pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid grid-cols-7 px-1">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const badge = item.href === "/host/events" && claimable > 0 ? (claimable > 99 ? "99+" : String(claimable)) : null;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-label={badge ? `${item.label}, ${badge} blok bisa diambil` : item.label}
                className="group relative flex h-16 flex-col items-center justify-end pb-2 outline-none"
              >
                {/* The bubble: rises above the bar for the open page, ringed in the page colour */}
                <span
                  className={`relative flex items-center justify-center rounded-full transition-all duration-300 ease-out ${
                    active
                      ? "-translate-y-4 h-12 w-12 bg-gradient-to-br from-purple-500 to-purple-700 text-white ring-4 ring-slate-950 shadow-lg shadow-purple-600/40"
                      : "h-8 w-8 text-gray-400 group-hover:text-white group-focus-visible:ring-2 group-focus-visible:ring-purple-500"
                  }`}
                >
                  <svg className={active ? "h-6 w-6" : "h-5 w-5"} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                  </svg>
                  {badge && (
                    <span className="absolute -right-1.5 -top-1 min-w-4 h-4 rounded-full bg-pink-500 px-1 text-center text-[10px] font-semibold leading-4 text-white ring-2 ring-slate-900">
                      {badge}
                    </span>
                  )}
                </span>
                <span
                  className={`text-[11px] leading-none transition-colors ${
                    active ? "-mt-2.5 font-semibold text-purple-300" : "mt-1 text-gray-400 group-hover:text-white"
                  }`}
                >
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
