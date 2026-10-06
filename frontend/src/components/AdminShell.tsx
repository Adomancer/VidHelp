"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import NotificationBell from "./NotificationBell";
import type { SidebarGroup } from "./SidebarLayout";
import SidebarNav from "./SidebarNav";
import ThemeToggle from "./ThemeToggle";
import UserMenu from "./UserMenu";

/**
 * Fixed sidebar on desktop (lg+), slide-over drawer on smaller screens,
 * and a sticky header with the page title, theme toggle, notifications and account menu.
 */
export default function AdminShell({ panel, links, children }: { panel: string; links: SidebarGroup[]; children: React.ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const current = links
    .flatMap((group) => group.items)
    .find((link) => pathname === link.href || pathname.startsWith(link.href + "/"));

  return (
    <div className="min-h-screen bg-canvas">
      {drawerOpen && (
        <div aria-hidden="true" className="fixed inset-0 z-40 bg-black/50 lg:hidden print:hidden" onClick={() => setDrawerOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[290px] flex-col border-r border-stroke bg-surface transition-transform duration-300 lg:translate-x-0 print:hidden ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">V</span>
            <div className="leading-tight">
              <p className="text-lg font-bold text-heading">VidHelp</p>
              <p className="text-[11px] font-medium text-muted">{panel}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Tutup menu"
            className="lg:hidden rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-heading"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-4 pb-6 pt-2">
          <SidebarNav links={links} onNavigate={() => setDrawerOpen(false)} />
        </nav>
      </aside>

      <div className="lg:pl-[290px]">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-stroke bg-surface px-4 shadow-card md:px-6 2xl:px-10 print:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Buka menu"
            className="lg:hidden rounded-lg border border-stroke p-1.5 text-body hover:bg-surface-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <nav aria-label="Lokasi halaman" className="min-w-0 flex-1 truncate text-sm">
            <span className="text-muted">{panel}</span>
            {current && (
              <>
                <span className="mx-2 text-faint">/</span>
                <span className="font-medium text-heading">{current.label}</span>
              </>
            )}
          </nav>

          <div className="flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
            <NotificationBell />
            <UserMenu />
          </div>
        </header>

        <main className="mx-auto max-w-screen-2xl p-4 md:p-6 2xl:p-10">{children}</main>
      </div>
    </div>
  );
}
