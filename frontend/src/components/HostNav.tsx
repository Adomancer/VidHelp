"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import HostEventNavLink from "./HostEventNavLink";
import NavIcon, { type NavIconName } from "./NavIcon";

/** The host menu, shared by the desktop header and the phone tab bar (HostBottomNav). */
export const hostMenuItems: { href: string; label: string; icon: NavIconName }[] = [
  { href: "/host/live", label: "Live", icon: "host" },
  { href: "/host/schedule", label: "Jadwal", icon: "calendar" },
  { href: "/host/events", label: "Event", icon: "event" },
  { href: "/host/brands", label: "Brand", icon: "brand" },
  { href: "/host/backups", label: "Backup", icon: "backup" },
  { href: "/host/rating", label: "Skor", icon: "rating" },
  { href: "/host/pay", label: "Gaji", icon: "payroll" },
];

/**
 * Host menu. `bottom`: fixed tab bar on phones. `top`: inline links in the desktop header.
 */
export default function HostNav({ variant }: { variant: "bottom" | "top" }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  const linkClass = (active: boolean) =>
    variant === "bottom"
      ? `relative flex flex-col items-center gap-1 rounded-lg px-2 py-1 transition-colors ${active ? "text-accent" : "text-muted hover:text-heading"}`
      : `relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          active ? "bg-primary/10 text-accent" : "text-body hover:bg-surface-2 hover:text-heading"
        }`;

  const links = hostMenuItems.map((item) => {
    const active = isActive(item.href);
    const content = (
      <>
        <NavIcon name={item.icon} className={variant === "bottom" ? "w-5 h-5" : "w-4 h-4"} />
        <span className={variant === "bottom" ? "text-xs" : undefined}>{item.label}</span>
      </>
    );
    if (item.href === "/host/events") {
      return (
        <HostEventNavLink key={item.href} className={linkClass(active)} active={active}>
          {content}
        </HostEventNavLink>
      );
    }
    return (
      <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={linkClass(active)}>
        {content}
      </Link>
    );
  });

  if (variant === "top") return <nav className="hidden lg:flex items-center gap-1">{links}</nav>;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-stroke bg-surface py-2 shadow-card lg:hidden print:hidden">
      {links}
    </nav>
  );
}
