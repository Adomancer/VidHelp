import type { RoleName } from "@/lib/api";
import AppShell from "./AppShell";
import { RequireAuth } from "./AuthProvider";
import type { NavIconName } from "./NavIcon";
import type { AccountLink } from "./UserMenu";

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
  /** Where the logo goes. */
  homeHref: string;
  accountLinks?: AccountLink[];
  /** The ⌘K palette; with `hostSearchPath` it also finds hosts. */
  search?: boolean;
  hostSearchPath?: string;
  children: React.ReactNode;
}

/** Sidebar + header shell shared by the admin, operator and finance panels. */
export default function SidebarLayout({ panel, roles, links, homeHref, accountLinks, search, hostSearchPath, children }: SidebarLayoutProps) {
  return (
    <RequireAuth roles={roles}>
      <AppShell panel={panel} homeHref={homeHref} links={links} accountLinks={accountLinks} search={search} hostSearchPath={hostSearchPath}>
        {children}
      </AppShell>
    </RequireAuth>
  );
}
