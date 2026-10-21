"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ClipboardList, Search, X } from "lucide-react";
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs";
import { adminApi, type AuditFilters, type AuditLogEntry } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { inputClass } from "@/lib/ui";
import { useApiData } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import DatePicker from "@/components/DatePicker";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import FormAlert from "@/components/FormAlert";
import { RefreshBar, TableSkeleton } from "@/components/Loading";
import PageHeader from "@/components/PageHeader";
import Pagination from "@/components/Pagination";
import { NativeSelect } from "@/components/SelectField";
import StatusBadge, { type Tone } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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

function actionTone(action: string): Tone {
  if (action === "delete" || action.endsWith("_failed") || action === "two_factor_reset" || action === "two_factor_disabled") return "danger";
  if (action === "create" || action === "approve" || action === "login") return "success";
  if (action.startsWith("two_factor") || action.startsWith("recovery")) return "brand";
  return "neutral";
}

const actionLabel = (action: string) => actionLabels[action] ?? humanize(action);

/** "host_sensitive_data" → "Host sensitive data" */
function humanize(value: string): string {
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const filterKeys = ["action", "target_table", "target_id", "user_id", "search", "from", "to"] as const satisfies readonly (keyof AuditFilters)[];

/** Filters and page live in the URL, so a refresh or a shared link shows the same records. */
const urlState = {
  ...(Object.fromEntries(filterKeys.map((key) => [key, parseAsString])) as Record<(typeof filterKeys)[number], typeof parseAsString>),
  page: parseAsInteger.withDefault(1),
};

function showValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "–";
  if (typeof value === "boolean") return value ? "ya" : "tidak";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function AuditLogPage() {
  const { token } = useAuth();
  const [{ page, ...params }, setUrlState] = useQueryStates(urlState);
  const [openId, setOpenId] = useState<string | null>(null);
  const filters: AuditFilters = {};
  for (const key of filterKeys) if (params[key]) filters[key] = params[key];

  const result = useApiData(`audit-${JSON.stringify(filters)}-${page}`, () => adminApi.auditLogs(token, { ...filters, page }));
  const logs = result.data?.logs;

  function applyFilters(next: AuditFilters) {
    void setUrlState({ ...Object.fromEntries(filterKeys.map((key) => [key, next[key] || null])), page: null });
    setOpenId(null);
  }

  const change = (key: keyof AuditFilters, value: string) => applyFilters({ ...filters, [key]: value || undefined });
  const scoped = filters.target_id || filters.user_id;
  const filtered = Object.values(filters).some(Boolean);
  const toggle = (id: string) => setOpenId(openId === id ? null : id);

  const who = (log: AuditLogEntry) =>
    log.user ? (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          applyFilters({ ...filters, user_id: log.user!.id });
        }}
        className="max-w-full min-w-0 rounded text-left outline-none hover:text-brand focus-visible:ring-3 focus-visible:ring-ring/50"
        title="Tampilkan semua yang dilakukan orang ini"
      >
        <span className="block truncate font-medium text-foreground">{log.user.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{log.user.email}</span>
      </button>
    ) : (
      <span className="text-muted-foreground">{log.action === "login_failed" ? "Tidak dikenal" : "Sistem"}</span>
    );

  const target = (log: AuditLogEntry) =>
    log.target_table ? (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (log.target_id) applyFilters({ ...filters, target_table: log.target_table!, target_id: log.target_id });
        }}
        className="rounded text-left outline-none hover:text-brand focus-visible:ring-3 focus-visible:ring-ring/50"
        title="Tampilkan riwayat data ini"
      >
        <span className="block text-xs text-muted-foreground">{tableLabel(log.target_table)}</span>
        <span className="block text-foreground">{log.target_label ?? log.target_id?.slice(0, 8)}</span>
      </button>
    ) : (
      <span className="text-faint">–</span>
    );

  return (
    <div className="space-y-6">
      <PageHeader title="Log audit" description="Setiap aktivitas masuk dan setiap perubahan data penting: siapa, kapan, apa yang berubah, dan dari mana." />

      <div className="grid gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
        <form
          className="relative sm:col-span-2 lg:w-60"
          onSubmit={(event) => {
            event.preventDefault();
            change("search", String(new FormData(event.currentTarget).get("search") ?? "").trim());
          }}
        >
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            key={filters.search ?? ""}
            name="search"
            type="search"
            defaultValue={filters.search}
            placeholder="Cari orang, data, atau IP…"
            aria-label="Cari"
            className={cn(inputClass, "pl-9")}
          />
        </form>
        <NativeSelect wrapperClassName="lg:w-44" value={filters.action ?? ""} onChange={(event) => change("action", event.target.value)} aria-label="Aksi">
          <option value="">Semua aksi</option>
          {result.data?.actions.map((action) => (
            <option key={action} value={action}>
              {actionLabel(action)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect wrapperClassName="lg:w-48" value={filters.target_table ?? ""} onChange={(event) => change("target_table", event.target.value)} aria-label="Jenis data">
          <option value="">Semua data</option>
          {result.data?.target_tables.map((table) => (
            <option key={table} value={table}>
              {tableLabel(table)}
            </option>
          ))}
        </NativeSelect>
        <div className="space-y-1 text-xs text-muted-foreground lg:w-40">
          <span id="audit-from">Dari</span>
          <DatePicker value={filters.from ?? ""} onChange={(value) => change("from", value)} max={filters.to} placeholder="Awal" clearable aria-describedby="audit-from" />
        </div>
        <div className="space-y-1 text-xs text-muted-foreground lg:w-40">
          <span id="audit-to">Sampai</span>
          <DatePicker value={filters.to ?? ""} onChange={(value) => change("to", value)} min={filters.from} placeholder="Hari ini" clearable aria-describedby="audit-to" />
        </div>
        {filtered && (
          <Button type="button" variant="ghost" onClick={() => applyFilters({})} className="text-muted-foreground">
            <X aria-hidden="true" />
            Hapus filter
          </Button>
        )}
      </div>

      {scoped && (
        <FormAlert tone="info">
          Hanya menampilkan riwayat {filters.target_id ? "satu data" : "satu orang"}.{" "}
          <button type="button" onClick={() => applyFilters({ ...filters, target_id: undefined, user_id: undefined })} className="font-medium underline underline-offset-2">
            Tampilkan semua
          </button>
        </FormAlert>
      )}
      {result.error && <ErrorState message={result.error} onRetry={result.reload} />}

      <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-xs dark:shadow-none">
        <RefreshBar active={result.loading && Boolean(logs)} />
        {!logs && !result.error && <TableSkeleton rows={8} columns={5} />}
        {logs?.data.length === 0 && <EmptyState icon={ClipboardList} title="Tidak ada catatan" description="Tidak ada aktivitas yang cocok dengan filter ini." />}

        {logs && logs.data.length > 0 && (
          <>
            <Table containerClassName="hidden md:block">
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Siapa</TableHead>
                  <TableHead>Aksi</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">Detail</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.data.map((log) => {
                  const open = openId === log.id;
                  return (
                    <Fragment key={log.id}>
                      <TableRow onClick={() => toggle(log.id)} className={cn("cursor-pointer text-body hover:bg-muted/40", open && "bg-muted/40")} aria-expanded={open}>
                        <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">{formatDateTime(log.created_at)}</TableCell>
                        <TableCell>{who(log)}</TableCell>
                        <TableCell>
                          <StatusBadge tone={actionTone(log.action)}>{actionLabel(log.action)}</StatusBadge>
                        </TableCell>
                        <TableCell>{target(log)}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{log.ip_address ?? "–"}</TableCell>
                        <TableCell className="text-right">
                          <ChevronDown className={cn("ml-auto size-4 text-faint transition-transform", open && "rotate-180")} aria-hidden="true" />
                        </TableCell>
                      </TableRow>
                      {open && (
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={6} className="py-4">
                            <Details log={log} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>

            <ul className="divide-y divide-border md:hidden">
              {logs.data.map((log) => {
                const open = openId === log.id;
                return (
                  <li key={log.id} className={cn("space-y-3 p-4", open && "bg-muted/30")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 text-sm">{who(log)}</div>
                      <StatusBadge tone={actionTone(log.action)}>{actionLabel(log.action)}</StatusBadge>
                    </div>
                    <div className="text-sm">{target(log)}</div>
                    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span className="tabular-nums">
                        {formatDateTime(log.created_at)}
                        {log.ip_address && ` · ${log.ip_address}`}
                      </span>
                      <Button type="button" variant="ghost" size="xs" className="max-md:h-10 max-md:px-3" onClick={() => toggle(log.id)} aria-expanded={open}>
                        Detail
                        <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
                      </Button>
                    </div>
                    {open && <Details log={log} />}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {logs && <Pagination page={logs.current_page} lastPage={logs.last_page} total={logs.total} unit="catatan" onChange={(next) => void setUrlState({ page: next })} />}
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
        <Table containerClassName="rounded-lg border border-border bg-card">
          <TableHeader className="bg-transparent">
            <TableRow>
              <TableHead className="px-3 py-2">Kolom</TableHead>
              {showBefore && <TableHead className="px-3 py-2">Sebelum</TableHead>}
              {showAfter && <TableHead className="px-3 py-2">{showBefore ? "Sesudah" : "Nilai"}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((field) => {
              const before = showValue(log.old_value?.[field]);
              const after = showValue(log.new_value?.[field]);
              const changed = showBefore && showAfter && before !== after;
              return (
                <TableRow key={field}>
                  <TableCell className="px-3 py-1.5 align-top font-mono text-xs text-muted-foreground">{field}</TableCell>
                  {showBefore && (
                    <TableCell className="px-3 py-1.5 align-top break-all">
                      <span className={cn(changed && "rounded bg-destructive/10 px-1 text-destructive line-through decoration-destructive/40")}>{before}</span>
                    </TableCell>
                  )}
                  {showAfter && (
                    <TableCell className="px-3 py-1.5 align-top break-all">
                      <span className={cn(changed ? "rounded bg-success/10 px-1 text-success" : "text-foreground")}>{after}</span>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">Tidak ada detail kolom untuk catatan ini.</p>
      )}
      <p className="text-xs text-muted-foreground">
        {log.target_id && (
          <>
            ID data <span className="font-mono">{log.target_id}</span> ·{" "}
          </>
        )}
        {log.user_agent ?? "Browser tidak dikenal"}
      </p>
      <p className="text-xs text-faint">&quot;[hidden]&quot; berarti kolom itu berubah, tapi nilainya (kata sandi, KTP, nomor rekening) tidak pernah disimpan di log.</p>
    </div>
  );
}
