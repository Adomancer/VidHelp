import type { RoleName } from "@/lib/api";
import { RequireAuth } from "./AuthProvider";
import AdminShell from "./AdminShell";
import type { NavIconName } from "./NavIcon";

export interface SidebarLink {
  href: string;
  label: string;
  icon: NavIconName;
}

export interface SidebarGroup {
  group: string;
  items: SidebarLink[];
}

interface SidebarLayoutProps {
  panel: string;
  roles: RoleName[];
  links: SidebarGroup[];
  children: React.ReactNode;
}

/** Sidebar + top header shell shared by the admin, operator and finance panels. */
export default function SidebarLayout({ panel, roles, links, children }: SidebarLayoutProps) {
  return (
    <RequireAuth roles={roles}>
      <AdminShell panel={panel} links={links}>
        {children}
      </AdminShell>
    </RequireAuth>
  );
}
