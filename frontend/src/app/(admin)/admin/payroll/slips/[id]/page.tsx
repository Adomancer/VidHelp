"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { payrollApi } from "@/lib/api";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "@/components/AuthProvider";
import FormAlert from "@/components/FormAlert";
import SlipView from "@/components/SlipView";

export default function AdminSlipPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const slip = useApiData(`slip-${id}`, () => payrollApi.slip(token, id));

  return (
    <div className="space-y-4">
      <Link href="/admin/payroll" className="text-sm text-purple-300 hover:text-white print:hidden">
        ← Payroll
      </Link>
      {slip.error && <FormAlert tone="error">{slip.error}</FormAlert>}
      {slip.data && <SlipView slip={slip.data.slip} />}
    </div>
  );
}
