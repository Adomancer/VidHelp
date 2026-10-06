import type { Metadata } from "next";
import SidebarLayout from "@/components/SidebarLayout";
import type { SidebarGroup } from "@/components/SidebarLayout";

export const metadata: Metadata = {
  title: "VidHelp Finance",
  description: "Penggajian dan kasbon VidHelp",
};

const links: SidebarGroup[] = [
  {
    group: "Keuangan",
    items: [{ href: "/finance/payroll", label: "Penggajian & Kasbon", icon: "payroll" }],
  },
  {
    group: "Akun",
    items: [{ href: "/finance/security", label: "Keamanan", icon: "security" }],
  },
];

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarLayout panel="Panel Finance" roles={["finance", "admin"]} links={links}>
      {children}
    </SidebarLayout>
  );
}
