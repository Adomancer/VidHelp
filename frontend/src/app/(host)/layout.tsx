import type { Metadata } from "next";
import Link from "next/link";
import { RequireAuth } from "@/components/AuthProvider";
import HostNav from "@/components/HostNav";
import NotificationBell from "@/components/NotificationBell";
import ThemeToggle from "@/components/ThemeToggle";
import UserAvatar from "@/components/UserAvatar";

export const metadata: Metadata = {
  title: "VidHelp Host",
  description: "Aplikasi host VidHelp",
};

export default function HostLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RequireAuth roles={["host", "operator", "admin"]}>
      <div className="min-h-screen bg-canvas flex flex-col">
        {/* Top bar; menu links show here on desktop, in the bottom bar on phones */}
        <header className="sticky top-0 z-40 bg-surface border-b border-stroke shadow-card print:hidden">
          <div className="mx-auto max-w-6xl h-14 px-4 md:px-8 flex items-center justify-between gap-4">
            <Link href="/host/live" className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-xs font-bold text-white">V</span>
              <span className="text-lg font-bold text-heading">VidHelp</span>
            </Link>
            <HostNav variant="top" />
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <NotificationBell />
              <Link href="/host/profile" aria-label="Profil saya" className="ml-1">
                <UserAvatar />
              </Link>
            </div>
          </div>
        </header>

        <main className="flex-1 w-full mx-auto max-w-6xl p-4 pb-24 md:p-8 lg:pb-8">{children}</main>

        <HostNav variant="bottom" />
      </div>
    </RequireAuth>
  );
}
