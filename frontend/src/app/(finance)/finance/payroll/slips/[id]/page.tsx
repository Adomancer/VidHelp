"use client";

import { useParams } from "next/navigation";
import { payrollApi } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import SlipPage from "@/components/SlipPage";

export default function FinanceSlipPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();

  return <SlipPage cacheKey={`slip-${id}`} load={() => payrollApi.slip(token, id)} back={{ href: "/finance/payroll", label: "Penggajian" }} />;
}
