import type { Metadata } from "next";
import SidebarLayout from "@/components/SidebarLayout";

export const metadata: Metadata = {
  title: "VidHelp Operator",
  description: "VidHelp Agency Operator Dashboard",
};

const links = [
  { href: "/operator/dashboard", label: "Dashboard" },
  { href: "/operator/schedules", label: "Schedules" },
  { href: "/operator/backups", label: "Backups" },
  { href: "/operator/reports", label: "Live Reports" },
  { href: "/operator/hosts", label: "Hosts" },
  { href: "/operator/ratings", label: "Ratings" },
];

export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarLayout panel="Operator Panel" accentClass="text-blue-400" roles={["operator", "admin"]} links={links}>
      {children}
    </SidebarLayout>
  );
}
