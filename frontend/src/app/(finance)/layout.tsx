import type { Metadata } from "next";
import SidebarLayout from "@/components/SidebarLayout";

export const metadata: Metadata = {
  title: "VidHelp Finance",
  description: "Penggajian dan kasbon VidHelp",
};

const links = [
  { href: "/finance/payroll", label: "Penggajian & Kasbon" },
  { href: "/finance/security", label: "Keamanan" },
];

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarLayout panel="Panel Finance" accentClass="text-emerald-400" roles={["finance", "admin"]} links={links}>
      {children}
    </SidebarLayout>
  );
}
