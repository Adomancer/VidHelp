"use client";

import HostTable from "@/components/HostTable";

export default function AdminHostsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Hosts</h1>
        <p className="text-sm text-gray-400 mt-1">Open a host to see KTP and bank details, set their join date or rate level.</p>
      </div>
      <HostTable detailHref={(host) => `/admin/hosts/${host.id}`} />
    </div>
  );
}
