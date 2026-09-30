import Link from "next/link";
import type { RoleName } from "@/lib/api";
import { RequireAuth } from "./AuthProvider";
import NotificationBell from "./NotificationBell";
import SidebarAccount from "./SidebarAccount";
import SidebarNav from "./SidebarNav";

export interface SidebarLink {
  href: string;
  label: string;
}

export interface SidebarGroup {
  group: string;
  items: SidebarLink[];
}

interface SidebarLayoutProps {
  panel: string;
  accentClass: string;
  roles: RoleName[];
  links: SidebarLink[] | SidebarGroup[];
  children: React.ReactNode;
}

/** Desktop sidebar shell shared by the admin and operator panels. */
export default function SidebarLayout({ panel, accentClass, roles, links, children }: SidebarLayoutProps) {
  return (
    <RequireAuth roles={roles}>
      <div className="min-h-screen bg-slate-950 flex">
        <aside className="hidden md:flex md:w-64 flex-col bg-slate-900 border-r border-slate-800 p-6 print:hidden">
          <div className="mb-8 flex items-start justify-between gap-2">
            <div>
              <h2 className="text-xl font-bold text-white">VidHelp</h2>
              <span className={`text-xs font-medium ${accentClass}`}>{panel}</span>
            </div>
            <NotificationBell align="left" />
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto">
            <SidebarNav links={links} />
          </nav>

          <SidebarAccount />
        </aside>

        <main className="flex-1 p-6 md:p-8 overflow-auto">{children}</main>
      </div>
    </RequireAuth>
  );
}

