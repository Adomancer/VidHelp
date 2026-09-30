import type { Metadata } from "next";
import SidebarLayout from "@/components/SidebarLayout";

export const metadata: Metadata = {
  title: "VidHelp Finance",
  description: "VidHelp payroll and kasbon",
};

const links = [{ href: "/finance/payroll", label: "Payroll & Kasbon" }];

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarLayout panel="Finance Panel" accentClass="text-emerald-400" roles={["finance", "admin"]} links={links}>
      {children}
    </SidebarLayout>
  );
}
