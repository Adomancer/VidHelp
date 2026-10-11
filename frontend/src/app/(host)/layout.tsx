import type { Metadata } from "next";
import { RequireAuth } from "@/components/AuthProvider";
import HostShell from "@/components/HostShell";

export const metadata: Metadata = {
  title: "VidHelp Host",
  description: "Aplikasi host VidHelp",
};

export default function HostLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth roles={["host", "operator", "admin"]}>
      <HostShell>{children}</HostShell>
    </RequireAuth>
  );
}
