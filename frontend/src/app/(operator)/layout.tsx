import type { Metadata } from "next";
import SidebarLayout from "@/components/SidebarLayout";

export const metadata: Metadata = {
  title: "VidHelp Operator",
  description: "Dashboard operator VidHelp",
};

const links = [
  { href: "/operator/dashboard", label: "Dashboard" },
  { href: "/operator/schedules", label: "Jadwal" },
  { href: "/operator/events", label: "Event" },
  { href: "/operator/backups", label: "Backup" },
  { href: "/operator/reports", label: "Laporan Live" },
  { href: "/operator/hosts", label: "Host" },
  { href: "/operator/points", label: "Poin & SP" },
];

export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarLayout panel="Panel Operator" accentClass="text-blue-400" roles={["operator", "admin"]} links={links}>
      {children}
    </SidebarLayout>
  );
}
