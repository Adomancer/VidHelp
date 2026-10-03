"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { payApi } from "@/lib/api";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "@/components/AuthProvider";
import FormAlert from "@/components/FormAlert";
import SlipView from "@/components/SlipView";

export default function HostSlipPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const slip = useApiData(`my-slip-${id}`, () => payApi.slip(token, id));

  return (
    <div className="space-y-4">
      <Link href="/host/pay" className="text-sm text-purple-300 hover:text-white print:hidden">
        ← Gaji saya
      </Link>
      {slip.error && <FormAlert tone="error">{slip.error}</FormAlert>}
      {slip.data && <SlipView slip={slip.data.slip} />}
    </div>
  );
}
