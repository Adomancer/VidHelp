import type { Metadata } from "next";
import SidebarLayout from "@/components/SidebarLayout";
import type { SidebarGroup } from "@/components/SidebarLayout";

export const metadata: Metadata = {
  title: "VidHelp Operator",
  description: "Dashboard operator VidHelp",
};

const links: SidebarGroup[] = [
  {
    group: "Ringkasan",
    items: [{ href: "/operator/dashboard", label: "Dashboard", icon: "dashboard" }],
  },
  {
    group: "Operasional",
    items: [
      { href: "/operator/schedules", label: "Jadwal", icon: "calendar" },
      { href: "/operator/events", label: "Event", icon: "event" },
      { href: "/operator/backups", label: "Backup", icon: "backup" },
    ],
  },
  {
    group: "Monitoring",
    items: [
      { href: "/operator/reports", label: "Laporan Live", icon: "report" },
      { href: "/operator/hosts", label: "Host", icon: "host" },
      { href: "/operator/points", label: "Poin & SP", icon: "points" },
    ],
  },
];

export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarLayout panel="Panel Operator" roles={["operator", "admin"]} links={links} homeHref="/operator/dashboard" search>
      {children}
    </SidebarLayout>
  );
}
