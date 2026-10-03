"use client";

import { Fragment, useState } from "react";
import { adminApi, type AuditFilters, type AuditLogEntry } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "@/components/AuthProvider";
import FormAlert from "@/components/FormAlert";

const actionLabels: Record<string, string> = {
  create: "Dibuat",
  update: "Diubah",
  delete: "Dihapus",
  approve: "Disetujui",
  role_change: "Peran diubah",
  login: "Masuk",
  login_failed: "Gagal masuk",
  logout: "Keluar",
  two_factor_enabled: "2FA diaktifkan",
  two_factor_disabled: "2FA dimatikan",
  two_factor_reset: "2FA direset",
  two_factor_failed: "Kode 2FA salah",
  recovery_code_used: "Kode pemulihan dipakai",
  recovery_codes_regenerated: "Kode pemulihan baru",
};

const tableLabels: Record<string, string> = {
  users: "Pengguna",
  host_profiles: "Profil host",
  host_sensitive_data: "Data KTP & bank",
  host_rate_categories: "Level tarif",
  brands: "Brand",
  host_brand_assignments: "Penugasan brand",
  schedule_slots: "Slot jadwal",
  special_events: "Event khusus",
  event_slot_claims: "Blok event",
  backup_requests: "Permintaan backup",
  attendances: "Absensi",
  live_reports: "Laporan live",
  point_logs: "Catatan poin",
  warning_letters: "Surat peringatan",
  violation_types: "Jenis pelanggaran",
  brand_complaints: "Komplain brand",
  host_ratings: "Rating host",
  payment_periods: "Periode pembayaran",
  payment_requests: "Pengajuan pembayaran",
  hour_adjustments: "Penyesuaian jam",
  salary_slips: "Slip gaji",
  cash_advances: "Kasbon",
  discord_links: "Akun Discord",
  system_settings: "Pengaturan",
};

const tableLabel = (table: string) => tableLabels[table] ?? humanize(table);

function actionTone(action: string): string {
  if (action === "delete" || action.endsWith("_failed") || action === "two_factor_reset" || action === "two_factor_disabled") {
    return "bg-red-500/15 text-red-300";
  }
  if (action === "create" || action === "approve" || action === "login") return "bg-green-500/15 text-green-300";
  if (action.startsWith("two_factor") || action.startsWith("recovery")) return "bg-purple-500/15 text-purple-200";
  return "bg-slate-700 text-gray-200";
}

const actionLabel = (action: string) => actionLabels[action] ?? humanize(action);

/** "host_sensitive_data" → "Host sensitive data" */
function humanize(value: string): string {
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function showValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "ya" : "tidak";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function AuditLogPage() {
  const { token } = useAuth();
  const [filters, setFilters] = useState<AuditFilters>({});
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const result = useApiData(`audit-${JSON.stringify(filters)}-${page}`, () => adminApi.auditLogs(token, { ...filters, page }));
  const logs = result.data?.logs;

  function applyFilters(next: AuditFilters) {
    setFilters(next);
    setPage(1);
    setOpenId(null);
  }

  const change = (key: keyof AuditFilters, value: string) => applyFilters({ ...filters, [key]: value || undefined });
  const scoped = filters.target_id || filters.user_id;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Log Audit</h1>
        <p className="text-sm text-gray-400 mt-1">Setiap aktivitas masuk dan setiap perubahan data penting: siapa, kapan, apa yang berubah, dan dari mana.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            change("search", String(new FormData(event.currentTarget).get("search") ?? "").trim());
          }}
        >
          <input
            key={filters.search ?? ""}
            name="search"
            type="search"
            defaultValue={filters.search}
            placeholder="Cari orang, data, atau IP…"
            className="w-64 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-purple-500"
          />
        </form>
        <select
          value={filters.action ?? ""}
          onChange={(event) => change("action", event.target.value)}
          className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-white"
          aria-label="Aksi"
        >
          <option value="">Semua aksi</option>
          {result.data?.actions.map((action) => (
            <option key={action} value={action}>
              {actionLabel(action)}
            </option>
          ))}
        </select>
        <select
          value={filters.target_table ?? ""}
          onChange={(event) => change("target_table", event.target.value)}
          className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-white"
          aria-label="Jenis data"
        >
          <option value="">Semua data</option>
          {result.data?.target_tables.map((table) => (
            <option key={table} value={table}>
              {tableLabel(table)}
            </option>
          ))}
        </select>
        <label className="text-xs text-gray-400">
          Dari
          <input
            type="date"
            value={filters.from ?? ""}
            onChange={(event) => change("from", event.target.value)}
            className="block mt-1 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-sm text-white [color-scheme:dark]"
          />
        </label>
        <label className="text-xs text-gray-400">
          Sampai
          <input
            type="date"
            value={filters.to ?? ""}
            onChange={(event) => change("to", event.target.value)}
            className="block mt-1 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-sm text-white [color-scheme:dark]"
          />
        </label>
        {Object.values(filters).some(Boolean) && (
          <button type="button" onClick={() => applyFilters({})} className="px-3 py-2 text-sm text-purple-300 hover:text-white">
            Hapus filter
          </button>
        )}
      </div>

      {scoped && (
        <FormAlert tone="warning">
          Hanya menampilkan riwayat {filters.target_id ? "satu data" : "satu orang"}.{" "}
          <button type="button" onClick={() => applyFilters({ ...filters, target_id: undefined, user_id: undefined })} className="underline">
            Tampilkan semua
          </button>
        </FormAlert>
      )}
      {result.error && <FormAlert tone="error">{result.error}</FormAlert>}

      <div className={`bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto ${result.loading ? "opacity-60" : ""}`}>
        <table className="w-full text-sm">
          <thead className="text-left text-gray-400 border-b border-slate-800">
            <tr>
              <th className="px-4 py-3 font-medium">Waktu</th>
              <th className="px-4 py-3 font-medium">Siapa</th>
              <th className="px-4 py-3 font-medium">Aksi</th>
              <th className="px-4 py-3 font-medium">Data</th>
              <th className="px-4 py-3 font-medium">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {logs?.data.map((log) => (
              <Fragment key={log.id}>
                <tr
                  onClick={() => setOpenId(openId === log.id ? null : log.id)}
                  className={`text-gray-200 cursor-pointer hover:bg-slate-800/50 ${openId === log.id ? "bg-slate-800/50" : ""}`}
                >
                  <td className="px-4 py-3 whitespace-nowrap text-gray-400">{formatDateTime(log.created_at)}</td>
                  <td className="px-4 py-3">
                    {log.user ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          applyFilters({ ...filters, user_id: log.user!.id });
                        }}
                        className="text-left hover:text-purple-300"
                        title="Tampilkan semua yang dilakukan orang ini"
                      >
                        <span className="block text-white">{log.user.name}</span>
                        <span className="block text-xs text-gray-400">{log.user.email}</span>
                      </button>
                    ) : (
                      <span className="text-gray-400">{log.action === "login_failed" ? "Tidak dikenal" : "Sistem"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-md text-xs whitespace-nowrap ${actionTone(log.action)}`}>{actionLabel(log.action)}</span>
                  </td>
                  <td className="px-4 py-3">
                    {log.target_table ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (log.target_id) applyFilters({ ...filters, target_table: log.target_table!, target_id: log.target_id });
                        }}
                        className="text-left hover:text-purple-300"
                        title="Tampilkan riwayat data ini"
                      >
                        <span className="block text-gray-400 text-xs">{tableLabel(log.target_table)}</span>
                        <span className="block text-white">{log.target_label ?? log.target_id?.slice(0, 8)}</span>
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs">{log.ip_address ?? "—"}</td>
                </tr>
                {openId === log.id && (
                  <tr className="bg-slate-950/60">
                    <td colSpan={5} className="px-4 py-4">
                      <Details log={log} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>

        {logs && logs.data.length === 0 && <p className="px-4 py-8 text-center text-gray-400">Tidak ada catatan untuk filter ini.</p>}
      </div>

      {logs && logs.last_page > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-400">
          <span>
            Halaman {logs.current_page} dari {logs.last_page} · {logs.total} catatan
          </span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 rounded-md bg-slate-900 disabled:opacity-40">
              Sebelumnya
            </button>
            <button type="button" disabled={page >= logs.last_page} onClick={() => setPage(page + 1)} className="px-3 py-1.5 rounded-md bg-slate-900 disabled:opacity-40">
              Berikutnya
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Field-by-field before/after, plus the browser that made the request. */
function Details({ log }: { log: AuditLogEntry }) {
  const fields = [...new Set([...Object.keys(log.old_value ?? {}), ...Object.keys(log.new_value ?? {})])];
  const showBefore = log.old_value !== null;
  const showAfter = log.new_value !== null;

  return (
    <div className="space-y-3">
      {fields.length > 0 ? (
        <table className="text-sm">
          <thead className="text-left text-xs text-gray-400">
            <tr>
              <th className="pr-6 pb-1 font-medium">Kolom</th>
              {showBefore && <th className="pr-6 pb-1 font-medium">Sebelum</th>}
              {showAfter && <th className="pb-1 font-medium">{showBefore ? "Sesudah" : "Nilai"}</th>}
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field} className="align-top">
                <td className="pr-6 py-0.5 text-gray-400 font-mono text-xs">{field}</td>
                {showBefore && <td className="pr-6 py-0.5 text-red-200 break-all">{showValue(log.old_value?.[field])}</td>}
                {showAfter && <td className="py-0.5 text-green-200 break-all">{showValue(log.new_value?.[field])}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-gray-400">Tidak ada detail kolom untuk catatan ini.</p>
      )}
      <p className="text-xs text-gray-500">
        {log.target_id && <>ID data {log.target_id} · </>}
        {log.user_agent ?? "Browser tidak dikenal"}
      </p>
      <p className="text-xs text-gray-500">&quot;[hidden]&quot; berarti kolom itu berubah, tapi nilainya (kata sandi, KTP, nomor rekening) tidak pernah disimpan di log.</p>
    </div>
  );
}
