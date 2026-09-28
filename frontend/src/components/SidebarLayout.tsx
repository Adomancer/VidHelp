import Link from "next/link";
import type { RoleName } from "@/lib/api";
import { RequireAuth } from "./AuthProvider";
import SidebarAccount from "./SidebarAccount";

interface SidebarLayoutProps {
  panel: string;
  accentClass: string;
  roles: RoleName[];
  links: { href: string; label: string }[];
  children: React.ReactNode;
}

/** Desktop sidebar shell shared by the admin and operator panels. */
export default function SidebarLayout({ panel, accentClass, roles, links, children }: SidebarLayoutProps) {
  return (
    <RequireAuth roles={roles}>
      <div className="min-h-screen bg-slate-950 flex">
        <aside className="hidden md:flex md:w-64 flex-col bg-slate-900 border-r border-slate-800 p-6 print:hidden">
          <div className="mb-8">
            <h2 className="text-xl font-bold text-white">VidHelp</h2>
            <span className={`text-xs font-medium ${accentClass}`}>{panel}</span>
          </div>
          <nav className="flex-1 space-y-2">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block px-4 py-2 rounded-lg text-gray-300 hover:bg-slate-800 hover:text-white transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <SidebarAccount />
        </aside>

        <main className="flex-1 p-6 md:p-8 overflow-auto">{children}</main>
      </div>
    </RequireAuth>
  );
}
