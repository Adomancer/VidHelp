import type { Metadata } from "next";
import SidebarLayout from "@/components/SidebarLayout";
import type { SidebarGroup } from "@/components/SidebarLayout";

export const metadata: Metadata = {
  title: "VidHelp Admin",
  description: "Dashboard admin VidHelp",
};

const links: SidebarGroup[] = [
  {
    group: "Ringkasan",
    items: [{ href: "/admin/dashboard", label: "Dashboard", icon: "dashboard" }],
  },
  {
    group: "Manajemen",
    items: [
      { href: "/admin/users", label: "Pengguna", icon: "users" },
      { href: "/admin/hosts", label: "Host", icon: "host" },
      { href: "/admin/brands", label: "Brand", icon: "brand" },
      { href: "/admin/rates", label: "Level Tarif", icon: "rates" },
    ],
  },
  {
    group: "Operasional",
    items: [
      { href: "/admin/schedules", label: "Jadwal", icon: "calendar" },
      { href: "/admin/events", label: "Event", icon: "event" },
      { href: "/admin/backups", label: "Backup", icon: "backup" },
    ],
  },
  {
    group: "Monitoring",
    items: [
      { href: "/admin/reports", label: "Laporan Live", icon: "report" },
      { href: "/admin/points", label: "Poin & SP", icon: "points" },
      { href: "/admin/ratings", label: "Rating", icon: "rating" },
    ],
  },
  {
    group: "Keuangan",
    items: [{ href: "/admin/payroll", label: "Penggajian", icon: "payroll" }],
  },
  {
    group: "Sistem",
    items: [
      { href: "/admin/audit", label: "Log Audit", icon: "audit" },
      { href: "/admin/settings", label: "Pengaturan", icon: "settings" },
      { href: "/admin/notifications", label: "Notifikasi", icon: "notifications" },
      { href: "/admin/security", label: "Keamanan", icon: "security" },
    ],
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarLayout
      panel="Panel Admin"
      roles={["admin", "finance"]}
      links={links}
      homeHref="/admin/dashboard"
      accountLinks={[{ href: "/admin/security", label: "Keamanan akun", icon: "security" }]}
      search
      hostSearchPath="/admin/hosts?host="
    >
      {children}
    </SidebarLayout>
  );
}
