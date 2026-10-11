"use client";

import { useParams } from "next/navigation";
import { payApi } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import SlipPage from "@/components/SlipPage";

export default function HostSlipPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();

  return <SlipPage cacheKey={`my-slip-${id}`} load={() => payApi.slip(token, id)} back={{ href: "/host/pay", label: "Gaji saya" }} />;
}
