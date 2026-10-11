"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, ViewTransition, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useIsTablet } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup as SidebarSection,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import CommandMenu from "./CommandMenu";
import NavIcon from "./NavIcon";
import NotificationBell from "./NotificationBell";
import type { SidebarGroup, SidebarLink } from "./SidebarLayout";
import ThemeToggle from "./ThemeToggle";
import UserAvatar from "./UserAvatar";
import UserMenu, { type AccountLink } from "./UserMenu";

export interface AppShellProps {
  /** "Panel Admin", "Host"… */
  panel: string;
  /** Where the logo goes. */
  homeHref: string;
  links: SidebarGroup[];
  /** A count on a menu item, by its href (e.g. event blocks still open). */
  badges?: Record<string, number>;
  /** Links in the account menu (profile, security). */
  accountLinks?: AccountLink[];
  /** The ⌘K palette in the header. */
  search?: boolean;
  /** With search: picked hosts open at `${hostSearchPath}${id}`. */
  hostSearchPath?: string;
  /** Shown above the account block while the sidebar is expanded. */
  sidebarExtra?: ReactNode;
  /** A bottom tab bar for phones, in place of the slide-out menu (host app). */
  mobileNav?: ReactNode;
  /** Profile link for the avatar in the phone header (with mobileNav). */
  profileHref?: string;
  children: ReactNode;
}

const COOKIE = "sidebar_state";

/** The laptop sidebar state saved by SidebarProvider; expanded unless collapsed last time. */
function savedOpen(): boolean {
  return !document.cookie.split("; ").includes(`${COOKIE}=false`);
}

/** The menu link for the page that is open (the longest matching href wins). */
function currentLink(links: SidebarGroup[], pathname: string): SidebarLink | undefined {
  return links
    .flatMap((group) => group.items)
    .filter((link) => pathname === link.href || pathname.startsWith(`${link.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/**
 * The frame around every signed-in page: a sidebar (full on laptops, an icon rail on tablets,
 * a slide-out menu or a bottom tab bar on phones), a sticky header and the page content.
 */
export default function AppShell(props: AppShellProps) {
  const isTablet = useIsTablet();
  const [laptopOpen, setLaptopOpen] = useState(savedOpen);
  const [tabletOpen, setTabletOpen] = useState(false);

  return (
    <SidebarProvider open={isTablet ? tabletOpen : laptopOpen} onOpenChange={isTablet ? setTabletOpen : setLaptopOpen}>
      <ShellSidebar {...props} />
      <SidebarInset className="min-w-0">
        <ShellHeader {...props} />
        <ShellContent mobileNav={Boolean(props.mobileNav)}>{props.children}</ShellContent>
      </SidebarInset>
      {props.mobileNav}
    </SidebarProvider>
  );
}

function Logo({ panel, compact = false }: { panel: string; compact?: boolean }) {
  return (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground shadow-xs">V</span>
      {!compact && (
        <span className="grid min-w-0 leading-tight">
          <span className="truncate text-[15px] font-semibold tracking-tight text-foreground">VidHelp</span>
          <span className="truncate text-xs text-muted-foreground">{panel}</span>
        </span>
      )}
    </>
  );
}

function ShellSidebar({ panel, homeHref, links, badges = {}, accountLinks, sidebarExtra }: AppShellProps) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile, state } = useSidebar();
  const active = currentLink(links, pathname);
  const closeOnPhone = () => isMobile && setOpenMobile(false);

  return (
    <Sidebar collapsible="icon" className="print:hidden">
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border px-3 group-data-[collapsible=icon]:px-2">
        <Link
          href={homeHref}
          onClick={closeOnPhone}
          className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <Logo panel={panel} compact={state === "collapsed" && !isMobile} />
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-0 py-2">
        {links.map((section) => (
          <SidebarSection key={section.group} className="py-1.5">
            <SidebarGroupLabel className="text-[11px] font-semibold tracking-wider text-faint uppercase">{section.group}</SidebarGroupLabel>
            <SidebarMenu className="gap-0.5">
              {section.items.map((link) => {
                const isActive = active?.href === link.href;
                const badge = badges[link.href] ?? 0;
                return (
                  <SidebarMenuItem key={link.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={badge > 0 ? `${link.label} (${badge})` : link.label}
                      className="h-9 text-sidebar-foreground data-active:bg-primary/10 data-active:font-medium data-active:text-brand data-active:hover:bg-primary/15 data-active:hover:text-brand [&>svg]:text-muted-foreground data-active:[&>svg]:text-brand"
                    >
                      <Link href={link.href} onClick={closeOnPhone} aria-current={isActive ? "page" : undefined}>
                        <NavIcon name={link.icon} className="size-4" />
                        <span>{link.label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {badge > 0 && (
                      <SidebarMenuBadge className="top-2! rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground peer-hover/menu-button:text-primary-foreground peer-data-active/menu-button:text-primary-foreground">
                        {badge > 99 ? "99+" : badge}
                      </SidebarMenuBadge>
                    )}
                    {badge > 0 && state === "collapsed" && !isMobile && (
                      <span className="pointer-events-none absolute top-1 right-1 size-2 rounded-full bg-primary ring-2 ring-sidebar" aria-hidden="true" />
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarSection>
        ))}
      </SidebarContent>

      <SidebarFooter className="gap-2 border-t border-sidebar-border">
        {sidebarExtra && <div className="group-data-[collapsible=icon]:hidden">{sidebarExtra}</div>}
        <UserMenu links={accountLinks} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function ShellHeader({ panel, homeHref, links, search, hostSearchPath, mobileNav, profileHref }: AppShellProps) {
  const pathname = usePathname();
  const current = currentLink(links, pathname);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur-md md:px-5 print:hidden">
      {/* Phones with a tab bar get the logo; everyone else the menu button */}
      {mobileNav && (
        <Link href={homeHref} className="flex items-center gap-2 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:hidden" aria-label="VidHelp">
          <Logo panel={panel} compact />
        </Link>
      )}
      <SidebarTrigger className={cn("size-9 text-muted-foreground hover:text-foreground", mobileNav && "hidden md:inline-flex")} />
      <Separator orientation="vertical" className={cn("mx-1 h-5 data-vertical:self-center", mobileNav && "hidden md:block")} />

      <nav aria-label="Lokasi halaman" className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
        <span className="hidden shrink-0 text-muted-foreground sm:inline">{panel}</span>
        {current && (
          <>
            <ChevronRight className="hidden size-3.5 shrink-0 text-faint sm:inline" aria-hidden="true" />
            <span className="truncate font-medium text-foreground">{current.label}</span>
          </>
        )}
      </nav>

      <div className="flex items-center gap-1">
        {search && <CommandMenu links={links} hostSearchPath={hostSearchPath} />}
        <ThemeToggle />
        <NotificationBell />
        {mobileNav && profileHref && (
          <Link href={profileHref} aria-label="Profil saya" className="ml-1 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:hidden">
            <UserAvatar size="size-8 text-xs" />
          </Link>
        )}
      </div>
    </header>
  );
}

/** The page under the header; each page change fades in (React ViewTransition, see globals.css). */
function ShellContent({ mobileNav, children }: { mobileNav: boolean; children: ReactNode }) {
  const pathname = usePathname();

  return (
    <ViewTransition key={pathname} enter="page-enter" exit="page-exit" default="none">
      <div className={cn("mx-auto w-full max-w-screen-2xl flex-1 p-4 md:p-6 2xl:p-8", mobileNav && "pb-28 md:pb-6")}>{children}</div>
    </ViewTransition>
  );
}
