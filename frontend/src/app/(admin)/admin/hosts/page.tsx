"use client";

import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import HostDetailDialog from "@/components/HostDetailDialog";
import HostTable from "@/components/HostTable";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";

export default function AdminHostsPage() {
  // The open host is in the URL (?host=…), which isn't known while prerendering
  return (
    <Suspense>
      <HostsPage />
    </Suspense>
  );
}

function HostsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const openId = useSearchParams().get("host");
  const [refreshKey, setRefreshKey] = useState(0);
  const { show } = useToast();

  const open = (id: string | null) => router.replace(id ? `${pathname}?host=${id}` : pathname, { scroll: false });

  return (
    <div className="space-y-6">
      <PageHeader title="Host" description="Klik host untuk melihat data KTP dan bank, serta mengatur kontak, tanggal bergabung, level tarif, dan brand." />
      <HostTable onSelect={(host) => open(host.id)} refreshKey={refreshKey} />

      {openId && (
        <HostDetailDialog
          key={openId}
          hostId={openId}
          onClose={() => open(null)}
          onChanged={(message) => {
            setRefreshKey((key) => key + 1);
            if (message) show({ text: message });
          }}
        />
      )}
    </div>
  );
}
