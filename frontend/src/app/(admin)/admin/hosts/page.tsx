"use client";

import { useQueryState } from "nuqs";
import { useInvalidate } from "@/lib/useApiData";
import HostDetailDialog from "@/components/HostDetailDialog";
import HostTable from "@/components/HostTable";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";

export default function AdminHostsPage() {
  // The open host is in the URL (?host=…) next to the list's brand filter and page
  const [openId, setOpenId] = useQueryState("host");
  const invalidate = useInvalidate();
  const { show } = useToast();

  const open = (id: string | null) => void setOpenId(id);

  return (
    <div className="space-y-6">
      <PageHeader title="Host" description="Klik host untuk melihat data KTP dan bank, serta mengatur kontak, tanggal bergabung, level tarif, dan brand." />
      <HostTable onSelect={(host) => open(host.id)} />

      {openId && (
        <HostDetailDialog
          key={openId}
          hostId={openId}
          onClose={() => open(null)}
          onChanged={(message) => {
            void invalidate("hosts-");
            void invalidate("brands");
            if (message) show({ text: message });
          }}
        />
      )}
    </div>
  );
}
