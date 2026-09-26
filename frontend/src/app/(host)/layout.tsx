import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "VidHelp Host",
  description: "VidHelp Host Dashboard",
};

export default function HostLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      {/* Top header — mobile */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between md:px-8">
        <h2 className="text-lg font-bold text-white">VidHelp</h2>
        <a href="/host/profile" className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-white text-sm font-bold">
          H
        </a>
      </header>

      {/* Main content — scrollable */}
      <main className="flex-1 p-4 pb-20 overflow-auto md:p-8 md:pb-8">
        {children}
      </main>

      {/* Bottom navigation — mobile-first (hidden on desktop) */}
      <nav className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 flex items-center justify-around py-2 md:hidden z-50">
        <a href="/host/schedule" className="flex flex-col items-center gap-1 text-gray-400 hover:text-white transition-colors px-4 py-1">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          <span className="text-xs">Schedule</span>
        </a>
        <a href="/host/rating" className="flex flex-col items-center gap-1 text-gray-400 hover:text-white transition-colors px-4 py-1">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
          <span className="text-xs">Rating</span>
        </a>
        <a href="/host/profile" className="flex flex-col items-center gap-1 text-gray-400 hover:text-white transition-colors px-4 py-1">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
          <span className="text-xs">Profile</span>
        </a>
      </nav>
    </div>
  );
}
