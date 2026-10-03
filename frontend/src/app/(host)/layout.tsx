import type { Metadata } from "next";
import Link from "next/link";
import { RequireAuth } from "@/components/AuthProvider";
import HostEventNavLink from "@/components/HostEventNavLink";
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
        <main className="flex-1 p-4 pb-20 overflow-auto md:p-8 md:pb-8">
          {children}
        </main>
  
        {/* Bottom navigation — mobile-first (hidden on desktop) */}
        <nav className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 flex items-center justify-around py-2 md:hidden z-50 print:hidden">
          <Link href="/host/live" className="flex flex-col items-center gap-1 text-gray-400 hover:text-white transition-colors px-2 py-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            <span className="text-xs">Live</span>
          </Link>
          <Link href="/host/schedule" className="flex flex-col items-center gap-1 text-gray-400 hover:text-white transition-colors px-2 py-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <span className="text-xs">Jadwal</span>
          </Link>
          <HostEventNavLink />
          <Link href="/host/brands" className="flex flex-col items-center gap-1 text-gray-400 hover:text-white transition-colors px-2 py-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
            <span className="text-xs">Brand</span>
          </Link>
          <Link href="/host/backups" className="flex flex-col items-center gap-1 text-gray-400 hover:text-white transition-colors px-2 py-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
            <span className="text-xs">Backup</span>
          </Link>
          <Link href="/host/rating" className="flex flex-col items-center gap-1 text-gray-400 hover:text-white transition-colors px-2 py-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
            <span className="text-xs">Skor</span>
          </Link>
          <Link href="/host/pay" className="flex flex-col items-center gap-1 text-gray-400 hover:text-white transition-colors px-2 py-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            <span className="text-xs">Gaji</span>
          </Link>
        </nav>
      </div>
    </RequireAuth>
  );
}
