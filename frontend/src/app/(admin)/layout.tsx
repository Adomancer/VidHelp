import type { Metadata } from "next";
import SidebarLayout from "@/components/SidebarLayout";

export const metadata: Metadata = {
  title: "VidHelp Admin",
  description: "VidHelp Agency Admin Dashboard",
};

const links = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/schedules", label: "Schedules" },
  { href: "/admin/finance", label: "Finance" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarLayout panel="Admin Panel" accentClass="text-purple-400" roles={["admin"]} links={links}>
      {children}
    </SidebarLayout>
  );
}
