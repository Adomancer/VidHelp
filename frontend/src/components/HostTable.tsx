"use client";

import { Fragment, useState } from "react";
import { errorMessage, operatorApi, type HostListItem } from "@/lib/api";
import { formatTenure } from "@/lib/format";
import { statusLabel } from "@/lib/labels";
import { useApiData } from "@/lib/useApiData";
import AssignmentEditor from "./AssignmentEditor";
import { useAuth } from "./AuthProvider";
import FormAlert from "./FormAlert";
import HostSearch, { type SearchChip } from "./HostSearch";
import UserAvatar from "./UserAvatar";

interface HostTableProps {
  /** Admin: clicking a row (anywhere on it) opens the host. */
  onSelect?: (host: HostListItem) => void;
  /** Change it to load the list again (e.g. after a host was edited). */
  refreshKey?: number;
  /** Operator: expand a row to manage the host's brands in place. */
  editableBrands?: boolean;
}

/** Searchable, brand-filterable host list shared by the operator and admin panels. */
export default function HostTable({ onSelect, refreshKey = 0, editableBrands = false }: HostTableProps) {
  const { token } = useAuth();
  const [chips, setChips] = useState<SearchChip[]>([]);
  const [brandId, setBrandId] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const filters = {
    search: chips.flatMap((chip) => (chip.kind === "text" ? [chip.text] : [])),
    host_ids: chips.flatMap((chip) => (chip.kind === "host" ? [chip.id] : [])),
    brand_id: brandId,
  };

  async function exportExcel() {
    setExporting(true);
    setExportError(null);
    try {
      await operatorApi.exportHosts(token, filters);
    } catch (caught) {
      setExportError(errorMessage(caught));
    } finally {
      setExporting(false);
    }
  }

  const brands = useApiData("brands", () => operatorApi.brands(token));
  const hosts = useApiData(JSON.stringify({ filters, page, refreshKey }), () => operatorApi.hosts(token, { ...filters, page }));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <HostSearch
          value={chips}
          onChange={(next) => {
            setChips(next);
            setPage(1);
          }}
        />
        <select
          value={brandId}
          onChange={(event) => {
            setBrandId(event.target.value);
            setPage(1);
          }}
          aria-label="Filter brand"
          className="sm:w-56 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white"
        >
          <option value="">Semua brand</option>
          {brands.data?.brands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={exportExcel}
          disabled={exporting}
          title="Semua host yang cocok dengan pencarian dan filter brand"
          className="px-4 py-2 rounded-lg border border-slate-700 text-gray-200 text-sm whitespace-nowrap hover:bg-slate-800 disabled:opacity-40"
        >
          {exporting ? "Mengekspor…" : "Ekspor Excel"}
        </button>
      </div>

      {exportError && <FormAlert tone="error">{exportError}</FormAlert>}
      {hosts.error && <FormAlert tone="error">{hosts.error}</FormAlert>}

      <div className={`bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto ${hosts.loading ? "opacity-60" : ""}`}>
        <table className="w-full text-sm">
          <thead className="text-left text-gray-400 border-b border-slate-800">
            <tr>
              <th className="px-4 py-3 font-medium">Host</th>
              <th className="px-4 py-3 font-medium">Level tarif</th>
              <th className="px-4 py-3 font-medium">Brand</th>
              <th className="px-4 py-3 font-medium">Status</th>
              {editableBrands && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {hosts.data?.data.map((host) => {
              const active = host.assignments.filter((assignment) => assignment.status === "active");
              const open = openId === host.id;

              return (
                <Fragment key={host.id}>
                  <tr
                    className={`text-gray-200 align-top ${
                      onSelect ? "cursor-pointer transition-colors hover:bg-slate-800/60 focus-visible:outline-none focus-visible:bg-slate-800/60" : ""
                    }`}
                    {...(onSelect && {
                      tabIndex: 0,
                      title: `Buka ${host.user.name}`,
                      onClick: () => onSelect(host),
                      onKeyDown: (event: React.KeyboardEvent) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelect(host);
                        }
                      },
                    })}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <UserAvatar user={host.user} />
                        <div className="min-w-0">
                          <p className="text-white">{host.user.name}</p>
                          <p className="text-gray-400 truncate">{host.user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {host.rate_category?.name ?? "—"}
                      <span className="block text-xs text-gray-400">
                        {formatTenure(host.join_date)}
                        {host.rate_category_overridden && " · diatur admin"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {active.length === 0 && <span className="text-gray-500">—</span>}
                        {active.map((assignment) => (
                          <span key={assignment.id} className="px-2 py-0.5 rounded-md bg-slate-800 text-xs">
                            {assignment.brand.name}
                            {assignment.is_leader && <span className="text-yellow-300"> ★</span>}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">{statusLabel(host.status)}</td>
                    {editableBrands && (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setOpenId(open ? null : host.id)}
                          className="px-3 py-1.5 rounded-md border border-slate-700 text-gray-300 hover:bg-slate-800"
                        >
                          {open ? "Tutup" : "Brand"}
                        </button>
                      </td>
                    )}
                  </tr>
                  {open && brands.data && (
                    <tr>
                      <td colSpan={5} className="px-4 pb-4">
                        <AssignmentEditor
                          hostId={host.id}
                          assignments={host.assignments}
                          brands={brands.data.brands}
                          onChanged={() => {
                            hosts.reload();
                            brands.reload();
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        {hosts.data?.data.length === 0 && (
          <p className="px-4 py-8 text-center text-gray-400">
            Tidak ada host. Host muncul di sini setelah admin menyetujui akunnya.
          </p>
        )}
      </div>

      {hosts.data && hosts.data.last_page > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-400">
          <span>
            Halaman {hosts.data.current_page} dari {hosts.data.last_page} · {hosts.data.total} host
          </span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 rounded-md bg-slate-900 disabled:opacity-40">
              Sebelumnya
            </button>
            <button
              type="button"
              disabled={page >= hosts.data.last_page}
              onClick={() => setPage(page + 1)}
              className="px-3 py-1.5 rounded-md bg-slate-900 disabled:opacity-40"
            >
              Berikutnya
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
