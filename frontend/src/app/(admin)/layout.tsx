import type { Metadata } from "next";
import SidebarLayout from "@/components/SidebarLayout";
import type { SidebarGroup } from "@/components/SidebarLayout";

export const metadata: Metadata = {
  title: "VidHelp Admin",
  description: "VidHelp Agency Admin Dashboard",
};

const links: SidebarGroup[] = [
  {
    group: "Overview",
    items: [{ href: "/admin/dashboard", label: "Dashboard" }],
  },
  {
    group: "Manajemen",
    items: [
      { href: "/admin/users", label: "Users" },
      { href: "/admin/hosts", label: "Hosts" },
      { href: "/admin/brands", label: "Brands" },
      { href: "/admin/rates", label: "Rate Levels" },
    ],
  },
  {
    group: "Operasional",
    items: [
      { href: "/admin/schedules", label: "Schedules" },
      { href: "/admin/events", label: "Events" },
      { href: "/admin/backups", label: "Backups" },
    ],
  },
  {
    group: "Monitoring",
    items: [
      { href: "/admin/reports", label: "Live Reports" },
      { href: "/admin/points", label: "Points & SP" },
      { href: "/admin/ratings", label: "Ratings" },
    ],
  },
  {
    group: "Keuangan",
    items: [{ href: "/admin/payroll", label: "Payroll" }],
  },
  {
    group: "Sistem",
    items: [
      { href: "/admin/audit", label: "Audit Log" },
      { href: "/admin/settings", label: "Settings" },
      { href: "/admin/security", label: "Security" },
    ],
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarLayout panel="Admin Panel" accentClass="text-purple-400" roles={["admin"]} links={links}>
      {children}
    </SidebarLayout>
  );
}

