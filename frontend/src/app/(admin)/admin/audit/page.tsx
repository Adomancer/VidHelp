"use client";

import { useEffect, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, ClipboardList, X } from "lucide-react";
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs";
import { adminApi, type AuditFilters, type AuditLogEntry } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import DataTable from "@/components/DataTable";
import DatePicker from "@/components/DatePicker";
import EmptyState from "@/components/EmptyState";
import FormAlert from "@/components/FormAlert";
import PageHeader from "@/components/PageHeader";
import Pagination from "@/components/Pagination";
import SearchInput from "@/components/SearchInput";
import { NativeSelect } from "@/components/SelectField";
import StatusBadge, { type Tone } from "@/components/StatusBadge";
import { DensityToggle, TableFilterDrawer, useTableDensity } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
  const [density, setDensity] = useTableDensity();
  const filters: AuditFilters = {};
  for (const key of filterKeys) if (params[key]) filters[key] = params[key];
  const [searchDraft, setSearchDraft] = useState(filters.search ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(debounce.current), []);

  const result = useApiData(`audit-${JSON.stringify(filters)}-${page}`, () => adminApi.auditLogs(token, { ...filters, page }), { keepPrevious: true });
  const logs = result.data?.logs;

  function applyFilters(next: AuditFilters) {
    void setUrlState({ ...Object.fromEntries(filterKeys.map((key) => [key, next[key] || null])), page: null });
    setOpenId(null);
  }

  function resetAllFilters() {
    clearTimeout(debounce.current);
    setSearchDraft("");
    applyFilters({});
  }

  function handleSearchChange(next: string) {
    setSearchDraft(next);
    clearTimeout(debounce.current);
    const trimmed = next.trim();
    if (!trimmed) {
      applyFilters({ ...filters, search: undefined });
      return;
    }
    debounce.current = setTimeout(() => {
      applyFilters({ ...filters, search: trimmed });
    }, 300);
  }

  const change = (key: keyof AuditFilters, value: string) => applyFilters({ ...filters, [key]: value || undefined });
  const scoped = filters.target_id || filters.user_id;
  const filtered = Object.values(filters).some(Boolean);
  const drawerFilterCount = [filters.action, filters.target_table, filters.from, filters.to].filter(Boolean).length;
  const toggle = (id: string) => setOpenId(openId === id ? null : id);

  const who = (log: AuditLogEntry) =>
    log.user ? (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          applyFilters({ ...filters, user_id: log.user!.id });
        }}
        className="max-w-full min-w-0 rounded text-left transition-colors duration-150 outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring/50 max-md:inline-flex max-md:min-h-11 max-md:flex-col max-md:justify-center"
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
        className="rounded text-left transition-colors duration-150 outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring/50 max-md:inline-flex max-md:min-h-11 max-md:flex-col max-md:justify-center"
        title="Tampilkan riwayat data ini"
      >
        <span className="block text-xs text-muted-foreground">{tableLabel(log.target_table)}</span>
        <span className="block text-foreground">{log.target_label ?? log.target_id?.slice(0, 8)}</span>
      </button>
    ) : (
      <span className="text-faint">–</span>
    );

  const columns: ColumnDef<AuditLogEntry>[] = [
    {
      id: "created_at",
      enableSorting: false,
      header: "Waktu",
      meta: { cellClassName: "whitespace-nowrap text-muted-foreground tabular-nums" },
      cell: ({ row }) => formatDateTime(row.original.created_at),
    },
    {
      id: "actor",
      enableSorting: false,
      header: "Siapa",
      cell: ({ row }) => who(row.original),
    },
    {
      id: "action",
      enableSorting: false,
      header: "Aksi",
      cell: ({ row }) => <StatusBadge tone={actionTone(row.original.action)}>{actionLabel(row.original.action)}</StatusBadge>,
    },
    {
      id: "target",
      enableSorting: false,
      header: "Data",
      cell: ({ row }) => target(row.original),
    },
    {
      id: "ip",
      enableSorting: false,
      header: "IP",
      meta: { cellClassName: "font-mono text-xs text-muted-foreground tabular-nums" },
      cell: ({ row }) => row.original.ip_address ?? "–",
    },
    {
      id: "expand",
      enableSorting: false,
      header: () => <span className="sr-only">Detail</span>,
      meta: { align: "right", headClassName: "w-10" },
      cell: ({ row }) => (
        <ChevronDown
          className={cn("ml-auto size-4 text-faint transition-transform duration-150", openId === row.original.id && "rotate-180")}
          aria-hidden="true"
        />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Log audit" description="Setiap aktivitas masuk dan setiap perubahan data penting: siapa, kapan, apa yang berubah, dan dari mana." />

      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:justify-between">
        <div className="flex flex-1 flex-wrap items-end gap-2">
          <SearchInput
            value={searchDraft}
            onChange={handleSearchChange}
            placeholder="Cari orang, data, atau IP…"
            aria-label="Cari log audit"
            className="min-w-0 flex-1 md:w-60 md:flex-none"
          />

          <div className="md:hidden">
            <TableFilterDrawer
              title="Filter log audit"
              activeCount={drawerFilterCount}
              onReset={() => applyFilters({ ...filters, action: undefined, target_table: undefined, from: undefined, to: undefined })}
            >
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="mobile-audit-action">Aksi</Label>
                  <NativeSelect id="mobile-audit-action" value={filters.action ?? ""} onChange={(event) => change("action", event.target.value)}>
                    <option value="">Semua aksi</option>
                    {result.data?.actions.map((action) => (
                      <option key={action} value={action}>
                        {actionLabel(action)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mobile-audit-table">Jenis data</Label>
                  <NativeSelect id="mobile-audit-table" value={filters.target_table ?? ""} onChange={(event) => change("target_table", event.target.value)}>
                    <option value="">Semua data</option>
                    {result.data?.target_tables.map((table) => (
                      <option key={table} value={table}>
                        {tableLabel(table)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mobile-audit-from">Dari</Label>
                  <DatePicker
                    id="mobile-audit-from"
                    value={filters.from ?? ""}
                    onChange={(value) => change("from", value)}
                    max={filters.to}
                    placeholder="Awal"
                    clearable
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mobile-audit-to">Sampai</Label>
                  <DatePicker
                    id="mobile-audit-to"
                    value={filters.to ?? ""}
                    onChange={(value) => change("to", value)}
                    min={filters.from}
                    placeholder="Hari ini"
                    clearable
                  />
                </div>
              </div>
            </TableFilterDrawer>
          </div>

          <div className="hidden md:flex md:flex-wrap md:items-end md:gap-2">
            <NativeSelect wrapperClassName="w-44" value={filters.action ?? ""} onChange={(event) => change("action", event.target.value)} aria-label="Aksi">
              <option value="">Semua aksi</option>
              {result.data?.actions.map((action) => (
                <option key={action} value={action}>
                  {actionLabel(action)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              wrapperClassName="w-48"
              value={filters.target_table ?? ""}
              onChange={(event) => change("target_table", event.target.value)}
              aria-label="Jenis data"
            >
              <option value="">Semua data</option>
              {result.data?.target_tables.map((table) => (
                <option key={table} value={table}>
                  {tableLabel(table)}
                </option>
              ))}
            </NativeSelect>
            <div className="w-40 space-y-1 text-xs text-muted-foreground">
              <span id="audit-from">Dari</span>
              <DatePicker
                value={filters.from ?? ""}
                onChange={(value) => change("from", value)}
                max={filters.to}
                placeholder="Awal"
                clearable
                aria-describedby="audit-from"
              />
            </div>
            <div className="w-40 space-y-1 text-xs text-muted-foreground">
              <span id="audit-to">Sampai</span>
              <DatePicker
                value={filters.to ?? ""}
                onChange={(value) => change("to", value)}
                min={filters.from}
                placeholder="Hari ini"
                clearable
                aria-describedby="audit-to"
              />
            </div>
            {filtered && (
              <Button type="button" variant="ghost" onClick={resetAllFilters} className="text-muted-foreground">
                <X aria-hidden="true" />
                Hapus filter
              </Button>
            )}
          </div>
        </div>

        <DensityToggle density={density} onChange={setDensity} className="hidden md:inline-flex" />
      </div>

      {scoped && (
        <FormAlert tone="info">
          Hanya menampilkan riwayat {filters.target_id ? "satu data" : "satu orang"}.{" "}
          <button
            type="button"
            onClick={() => applyFilters({ ...filters, target_id: undefined, user_id: undefined })}
            className="font-medium underline underline-offset-2"
          >
            Tampilkan semua
          </button>
        </FormAlert>
      )}

      <DataTable<AuditLogEntry>
        framed
        columns={columns}
        data={logs?.data ?? []}
        getRowId={(log) => log.id}
        density={density}
        stickyHeader
        stickyFirstColumn
        loading={!logs && !result.error}
        reloading={result.loading && Boolean(logs)}
        error={result.error}
        onRetry={result.reload}
        onRowClick={(log) => toggle(log.id)}
        renderExpanded={(log) => <Details log={log} />}
        isRowExpanded={(log) => openId === log.id}
        rowClassName={(log) => cn("text-body", openId === log.id && "bg-muted/40")}
        empty={<EmptyState icon={ClipboardList} title="Tidak ada catatan" description="Tidak ada aktivitas yang cocok dengan filter ini." />}
        renderMobile={(log) => {
          const open = openId === log.id;
          return (
            <div className={cn("space-y-3 p-4", open && "bg-muted/30")}>
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
                <Button type="button" variant="ghost" size="xs" onClick={() => toggle(log.id)} aria-expanded={open}>
                  Detail
                  <ChevronDown className={cn("transition-transform duration-150", open && "rotate-180")} aria-hidden="true" />
                </Button>
              </div>
              {open && <Details log={log} />}
            </div>
          );
        }}
      />

      {logs && (
        <Pagination
          page={logs.current_page}
          lastPage={logs.last_page}
          total={logs.total}
          pageSize={logs.per_page}
          unit="catatan"
          onChange={(next) => void setUrlState({ page: next })}
        />
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
                      <span className={cn(changed && "rounded bg-destructive-subtle px-1 text-destructive line-through decoration-destructive/40")}>
                        {before}
                      </span>
                    </TableCell>
                  )}
                  {showAfter && (
                    <TableCell className="px-3 py-1.5 align-top break-all">
                      <span className={cn(changed ? "rounded bg-success-subtle px-1 text-success" : "text-foreground")}>{after}</span>
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
      <p className="text-xs text-faint">
        &quot;[hidden]&quot; berarti kolom itu berubah, tapi nilainya (kata sandi, KTP, nomor rekening) tidak pernah disimpan di log.
      </p>
    </div>
  );
}
