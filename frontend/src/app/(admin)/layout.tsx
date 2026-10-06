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
    items: [{ href: "/admin/dashboard", label: "Dashboard" }],
  },
  {
    group: "Manajemen",
    items: [
      { href: "/admin/users", label: "Pengguna" },
      { href: "/admin/hosts", label: "Host" },
      { href: "/admin/brands", label: "Brand" },
      { href: "/admin/rates", label: "Level Tarif" },
    ],
  },
  {
    group: "Operasional",
    items: [
      { href: "/admin/schedules", label: "Jadwal" },
      { href: "/admin/events", label: "Event" },
      { href: "/admin/backups", label: "Backup" },
    ],
  },
  {
    group: "Monitoring",
    items: [
      { href: "/admin/reports", label: "Laporan Live" },
      { href: "/admin/points", label: "Poin & SP" },
      { href: "/admin/ratings", label: "Rating" },
    ],
  },
  {
    group: "Keuangan",
    items: [{ href: "/admin/payroll", label: "Penggajian" }],
  },
  {
    group: "Sistem",
    items: [
      { href: "/admin/audit", label: "Log Audit" },
      { href: "/admin/settings", label: "Pengaturan" },
      { href: "/admin/security", label: "Keamanan" },
    ],
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarLayout panel="Panel Admin" accentClass="text-purple-400" roles={["admin"]} links={links}>
      {children}
    </SidebarLayout>
  );
}

