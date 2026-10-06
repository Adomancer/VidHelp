import type { Metadata } from "next";
import Link from "next/link";
import { RequireAuth } from "@/components/AuthProvider";
import HostBottomNav from "@/components/HostBottomNav";
import NotificationBell from "@/components/NotificationBell";
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
      <div className="min-h-screen bg-slate-950 flex flex-col">
        {/* Top header — mobile */}
        <header className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between md:px-8 print:hidden">
          <h2 className="text-lg font-bold text-white">VidHelp</h2>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <Link href="/host/profile" aria-label="Profil saya">
              <UserAvatar />
            </Link>
          </div>
        </header>
  
        {/* Main content — scrollable */}
        <main className="flex-1 p-4 pb-28 overflow-auto md:p-8 md:pb-8">
          {children}
        </main>
  
        {/* Bottom navigation — phones only */}
        <HostBottomNav />
      </div>
    </RequireAuth>
  );
}
