"use client";

import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import HostDetailDialog from "@/components/HostDetailDialog";
import HostTable from "@/components/HostTable";
import Toast, { useToast } from "@/components/Toast";

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
  const { toast, show, dismiss } = useToast();

  const open = (id: string | null) => router.replace(id ? `${pathname}?host=${id}` : pathname, { scroll: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Host</h1>
        <p className="text-sm text-gray-400 mt-1">
          Klik baris host untuk melihat data KTP dan bank, serta mengatur kontak, tanggal bergabung, level tarif, dan brand.
        </p>
      </div>
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
      <Toast toast={toast} onDismiss={dismiss} />
    </div>
  );
}
