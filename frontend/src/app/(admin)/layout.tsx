import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "VidHelp Admin",
  description: "VidHelp Agency Admin Dashboard",
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-950 flex">
      {/* Sidebar — desktop full sidebar */}
      <aside className="hidden md:flex md:w-64 flex-col bg-slate-900 border-r border-slate-800 p-6">
        <div className="mb-8">
          <h2 className="text-xl font-bold text-white">VidHelp</h2>
          <span className="text-xs text-purple-400 font-medium">Admin Panel</span>
        </div>
        <nav className="flex-1 space-y-2">
          <a href="/admin/dashboard" className="block px-4 py-2 rounded-lg text-gray-300 hover:bg-slate-800 hover:text-white transition-colors">Dashboard</a>
          <a href="/admin/users" className="block px-4 py-2 rounded-lg text-gray-300 hover:bg-slate-800 hover:text-white transition-colors">Users</a>
          <a href="/admin/schedules" className="block px-4 py-2 rounded-lg text-gray-300 hover:bg-slate-800 hover:text-white transition-colors">Schedules</a>
          <a href="/admin/finance" className="block px-4 py-2 rounded-lg text-gray-300 hover:bg-slate-800 hover:text-white transition-colors">Finance</a>
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-6 md:p-8 overflow-auto">
        {children}
      </main>
    </div>
  );
}
