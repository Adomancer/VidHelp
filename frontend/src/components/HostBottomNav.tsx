"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useHostEvents } from "./EventClaimBoard";
import { hostMenuItems } from "./HostNav";
import NavIcon from "./NavIcon";

/** The Event badge checks less often than the event board itself. */
const BADGE_REFRESH_MS = 60_000;

/**
 * The host menu on phones and tablets (the desktop header has it from `lg`). The open
 * page's item rises out of the bar as a brand-colored bubble; Event shows how many
 * blocks I could still grab. Follows the light/dark theme tokens.
 */
export default function HostBottomNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const isHost = user.roles.some((role) => role.name === "host");
  const { claimable } = useHostEvents(isHost, BADGE_REFRESH_MS);

  return (
    <nav
      aria-label="Menu host"
      className="fixed inset-x-0 bottom-0 z-50 lg:hidden print:hidden rounded-t-3xl border-t border-stroke bg-surface/95 backdrop-blur shadow-[0_-6px_20px_rgb(17_25_40/0.08)] dark:shadow-[0_-8px_24px_rgb(0_0_0/0.45)] pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-7 px-1">
        {hostMenuItems.map((item) => {
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
                {/* The bubble: rises above the bar for the open page, ringed in the page color */}
                <span
                  className={`relative flex items-center justify-center rounded-full transition-all duration-300 ease-out ${
                    active
                      ? "-translate-y-4 h-12 w-12 bg-gradient-to-br from-primary to-primary-hover text-white ring-4 ring-canvas shadow-lg shadow-primary/35"
                      : "h-8 w-8 text-muted group-hover:text-heading group-focus-visible:ring-2 group-focus-visible:ring-primary"
                  }`}
                >
                  <NavIcon name={item.icon} className={active ? "h-6 w-6" : "h-5 w-5"} />
                  {badge && (
                    <span className="absolute -right-1.5 -top-1 min-w-4 h-4 rounded-full bg-pink-500 px-1 text-center text-[10px] font-semibold leading-4 text-white ring-2 ring-surface">
                      {badge}
                    </span>
                  )}
                </span>
                <span
                  className={`text-[11px] leading-none transition-colors ${
                    active ? "-mt-2.5 font-semibold text-accent" : "mt-1 text-muted group-hover:text-heading"
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
