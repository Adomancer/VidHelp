"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "./AuthProvider";
import NavIcon, { type NavIconName } from "./NavIcon";
import { ThemeSwitcher } from "./ThemeToggle";
import UserAvatar from "./UserAvatar";

interface TabItem {
  href: string;
  label: string;
  icon: NavIconName;
}

/** Always one tap away: the overview and the things with a time limit (the dashboard shows open backups). */
const tabs: TabItem[] = [
  { href: "/host/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/host/live", label: "Live", icon: "live" },
  { href: "/host/schedule", label: "Jadwal", icon: "calendar" },
  { href: "/host/events", label: "Event", icon: "event" },
];

/** In the "Lainnya" sheet. */
const more: (TabItem & { description: string })[] = [
  { href: "/host/backups", label: "Backup", icon: "backup", description: "Minta pengganti atau gantikan host lain" },
  { href: "/host/pay", label: "Gaji", icon: "payroll", description: "Perkiraan, slip dan kasbon" },
  { href: "/host/rating", label: "Skor", icon: "rating", description: "Poin, SP dan rating" },
  { href: "/host/brands", label: "Brand", icon: "brand", description: "Product knowledge" },
  { href: "/host/profile", label: "Profil", icon: "profile", description: "Data diri dan keamanan" },
];

const isAt = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/**
 * The host menu on phones (from `md` the sidebar takes over): four tabs and "Lainnya",
 * which opens the rest as a sheet. Event shows how many blocks I could still take.
 */
export default function HostBottomNav({ claimable = 0 }: { claimable?: number }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [sheetOpen, setSheetOpen] = useState(false);
  const moreActive = more.some((item) => isAt(pathname, item.href));
  const badge = claimable > 0 ? (claimable > 99 ? "99+" : String(claimable)) : null;

  return (
    <>
      <nav
        aria-label="Menu host"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden print:hidden"
      >
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {tabs.map((item) => {
            const active = isAt(pathname, item.href);
            const itemBadge = item.href === "/host/events" ? badge : null;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={itemBadge ? `${item.label}, ${itemBadge} blok bisa diambil` : item.label}
                  className="group flex h-16 flex-col items-center justify-center gap-1 outline-none"
                >
                  <TabIcon icon={item.icon} active={active} badge={itemBadge} />
                  <TabLabel active={active}>{item.label}</TabLabel>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              className="group flex h-16 w-full flex-col items-center justify-center gap-1 outline-none"
            >
              <TabIcon icon="more" active={moreActive} />
              <TabLabel active={moreActive}>Lainnya</TabLabel>
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] gap-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)] md:hidden">
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border" aria-hidden="true" />
          <SheetHeader className="flex-row items-center gap-3 px-5 pt-3 pb-4">
            <UserAvatar size="size-10 text-sm" />
            <div className="min-w-0">
              <SheetTitle className="truncate text-base font-semibold">{user.name}</SheetTitle>
              <SheetDescription className="truncate">{user.email}</SheetDescription>
            </div>
          </SheetHeader>

          <div className="space-y-5 overflow-y-auto px-5 pb-5">
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {more.map((item) => {
                const active = isAt(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setSheetOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-14 items-center gap-3 px-4 py-3 transition-colors outline-none active:bg-muted focus-visible:bg-muted",
                        active && "bg-primary/[0.06]"
                      )}
                    >
                      <span className={cn("flex size-9 items-center justify-center rounded-lg", active ? "bg-primary/10 text-brand" : "bg-muted text-muted-foreground")}>
                        <NavIcon name={item.icon} className="size-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-sm font-medium", active ? "text-brand" : "text-foreground")}>{item.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
                      </span>
                      <ChevronRight className="size-4 text-faint" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Tema</p>
              <ThemeSwitcher />
            </div>

            <Button type="button" variant="outline" size="lg" onClick={() => void logout()} className="w-full text-destructive hover:text-destructive">
              <LogOut aria-hidden="true" />
              Keluar
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** The open tab gets a soft pill behind its icon. */
function TabIcon({ icon, active, badge }: { icon: NavIconName; active: boolean; badge?: string | null }) {
  return (
    <span
      className={cn(
        "relative flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200 group-focus-visible:ring-3 group-focus-visible:ring-ring/50",
        active ? "bg-primary/12 text-brand" : "text-muted-foreground group-active:bg-muted"
      )}
    >
      <NavIcon name={icon} className="size-5" />
      {badge && (
        <span className="absolute -top-0.5 right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground ring-2 ring-background tabular-nums">
          {badge}
        </span>
      )}
    </span>
  );
}

function TabLabel({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <span className={cn("text-[11px] leading-none", active ? "font-semibold text-brand" : "font-medium text-muted-foreground")}>{children}</span>;
}
