"use client";

import HostTable from "@/components/HostTable";

export default function AdminHostsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Host</h1>
        <p className="text-sm text-gray-400 mt-1">Buka host untuk melihat data KTP dan bank, serta mengatur tanggal bergabung atau level tarifnya.</p>
      </div>
      <HostTable detailHref={(host) => `/admin/hosts/${host.id}`} />
    </div>
  );
}
